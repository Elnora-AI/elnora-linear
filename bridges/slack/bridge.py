#!/usr/bin/env python3
"""Slack bridge for the @elnora-ai/linear curator.

The curator (`elnora-linear curator-run`) stages MEDIUM-tier questions in
`~/.config/elnora-linear/state/curator-state.json` and writes LOW-tier
actions to `curator-report.jsonl`, but does not post anything to Slack by
design — the dispatcher leaves chat I/O to a downstream consumer of the
state file. This script is that consumer for Slack.

The bridge is intentionally silent unless the curator needs human input.
It DMs the assignee only when MEDIUM-tier asks a question, and follows up
in the same thread only when the user's reply was ambiguous. No daily
summaries, no per-action confirmations, no timeout pings — work that can
be done automatically already auto-applies upstream (HIGH tier), and
state changes are visible directly in Linear.

Modes
-----
  post-pending   Post unposted MEDIUM questions as DMs to the assignee.

  resolve        Poll Slack thread replies for each posted question, ask
                 TypeSafe Jev (via OpenRouter) to judge each free-form
                 reply, apply confident state changes back to Linear via
                 the elnora-linear CLI, and remove resolved questions from
                 upstream pending.

  tick           Run post-pending followed by resolve in one process —
                 the recommended mode for cron / launchd / systemd timers.

Environment
-----------
  SLACK_BOT_TOKEN          Required. Bot token with chat:write,
                           im:write, im:history, channels:history scopes.
  OPENROUTER_API_KEY       Required for `resolve` mode (reply judging by
                           TypeSafe Jev). Without it, or while Jev is down,
                           replies are left unjudged and retried next tick;
                           nothing in Linear changes. `post-pending` works
                           without it.
  LINEAR_REFERENCES_DIR    Path to the populated references directory
                           (teams.json, users.json, slack.json,
                           workspace.json). Defaults to
                           ~/.config/elnora-linear (matches the CLI's
                           default — same dir the CLI's `sync` writes to).
  LINEAR_CURATOR_STATE_DIR Path the upstream curator writes its state
                           to. Defaults to ~/.config/elnora-linear/state.
  ELNORA_LINEAR_BIN        Path to the elnora-linear binary. Defaults to
                           whatever PATH resolves "elnora-linear" to.

Configuration files (under LINEAR_REFERENCES_DIR)
-------------------------------------------------
  slack.json       Required. Standard upstream reference file. Required
                     fields: `channels`, `allowed_channels`,
                     `allowed_dm_users`. Optional bridge fields:
                       workspace_slug:    builds <linear.app/{slug}/…> URLs
                       fallback_dm_user:  user key to DM when an issue has
                                          no assignee, or the assignee
                                          isn't in allowed_dm_users.
                                          Defaults to allowed_dm_users[0].
                       max_new_dms_per_tick: cap on NEW question DMs posted
                                          per tick (default 10) so a backlog
                                          drains gradually.
  users.json       Required. Each user object needs `name`; optionally
                     `key` and `slack_user_id`. The bridge matches the
                     Linear `assignee` display string against `name`.

Both files follow the standard placeholder → sync → populated pattern as
the rest of the CLI. Adopters' private populated copies live outside the
public package; the bundled placeholders ship blank.

Run modes accept --dry-run and --verbose.

See bridges/slack/README.md for setup + scheduling examples.
"""
from __future__ import annotations

import argparse
import json
import math
import os
import shutil
import subprocess
import sys
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

# ---------------------------------------------------------------------------
# Path resolution
# ---------------------------------------------------------------------------

def _default_state_dir() -> Path:
    env = os.environ.get("LINEAR_CURATOR_STATE_DIR")
    if env:
        return Path(env)
    return Path.home() / ".config" / "elnora-linear" / "state"


def _default_refs_dir() -> Path:
    env = os.environ.get("LINEAR_REFERENCES_DIR")
    if env:
        return Path(env)
    # Matches the CLI's resolveReferencesDir default (src/config/loader.ts:91).
    # The CLI writes slack.json / users.json directly under ~/.config/elnora-linear/,
    # not in a references/ subdir.
    return Path.home() / ".config" / "elnora-linear"


def _elnora_linear_bin() -> str:
    explicit = os.environ.get("ELNORA_LINEAR_BIN")
    if explicit:
        return explicit
    resolved = shutil.which("elnora-linear")
    if resolved:
        return resolved
    return "elnora-linear"  # let exec fail with a clear error if missing


STATE_DIR = _default_state_dir()
REFS_DIR = _default_refs_dir()
UPSTREAM_STATE = STATE_DIR / "curator-state.json"
UPSTREAM_LOCK = STATE_DIR / "curator-state.json.lock"
REPORT_LOG = STATE_DIR / "curator-report.jsonl"
BRIDGE_STATE = STATE_DIR / "slack-bridge-state.json"

LINEAR_CLI = _elnora_linear_bin()

QUESTION_TIMEOUT_DAYS = 7
LOCK_RETRY_SECONDS = 5

CURATOR_MARKER = "*[Linear Curator]*"


# ---------------------------------------------------------------------------
# Console helpers
# ---------------------------------------------------------------------------

VERBOSE = False


def _info(msg: str) -> None:
    print(msg, flush=True)


def _warn(msg: str) -> None:
    # stderr, not stdout: every _warn site is a degraded outcome (a Slack call
    # that failed, a DM that was not delivered, a CLI that exited non-zero).
    # On stdout those lines land in the run log next to normal progress and
    # are invisible to anything watching the error log.
    print(f"[warn] {msg}", file=sys.stderr, flush=True)


def _err(msg: str) -> None:
    print(f"[error] {msg}", file=sys.stderr, flush=True)


def _v(msg: str) -> None:
    if VERBOSE:
        print(f"  {msg}", flush=True)


# ---------------------------------------------------------------------------
# Reference loaders
# ---------------------------------------------------------------------------

def _load_json(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as e:
        _err(f"failed to read {path}: {e}")
        return default


SLACK_REF = _load_json(REFS_DIR / "slack.json", {})
USERS_REF = _load_json(REFS_DIR / "users.json", {"users": []})

ALLOWED_CHANNELS = set(SLACK_REF.get("allowed_channels") or [])
ALLOWED_DM_USERS_LIST = list(SLACK_REF.get("allowed_dm_users") or [])
ALLOWED_DM_USERS = set(ALLOWED_DM_USERS_LIST)
WORKSPACE_SLUG = SLACK_REF.get("workspace_slug")
FALLBACK_DM_USER = SLACK_REF.get("fallback_dm_user")
# Cap on NEW question DMs posted per tick, so a backlog (e.g. a fallback user
# becoming DM-able) drains gradually instead of flooding one person's DMs.
MAX_NEW_DMS_PER_TICK = int(SLACK_REF.get("max_new_dms_per_tick") or 10)

USERS_BY_NAME: dict[str, dict] = {
    u["name"]: u for u in USERS_REF.get("users", []) if u.get("name")
}
USERS_BY_KEY: dict[str, dict] = {
    u["key"]: u for u in USERS_REF.get("users", []) if u.get("key")
}
ALLOWED_SLACK_IDS: set[str] = {
    u["slack_user_id"]
    for k, u in USERS_BY_KEY.items()
    if k in ALLOWED_DM_USERS and u.get("slack_user_id")
}


# ---------------------------------------------------------------------------
# Slack client
# ---------------------------------------------------------------------------

def _slack_client():
    """Return a slack_sdk WebClient, or None if not configured."""
    token = os.environ.get("SLACK_BOT_TOKEN")
    if not token:
        _err("SLACK_BOT_TOKEN env var is not set; cannot reach Slack")
        return None
    try:
        from slack_sdk import WebClient
    except ImportError:
        _err("slack_sdk not installed. Run: pip install slack-sdk")
        return None
    return WebClient(token=token, timeout=30)


def _slack_open_dm(client, slack_user_id: str) -> str | None:
    if slack_user_id not in ALLOWED_SLACK_IDS:
        _err(f"DM to non-allowlisted user {slack_user_id} blocked")
        return None
    try:
        res = client.conversations_open(users=slack_user_id)
        return (res.data.get("channel") or {}).get("id")
    except Exception as e:
        _warn(f"conversations.open failed: {e}")
        return None


def _slack_post(client, channel: str, text: str, *, thread_ts: str | None = None, dry_run: bool) -> str | None:
    is_dm = channel.startswith("D")
    if not is_dm and channel not in ALLOWED_CHANNELS:
        _err(f"post to non-allowlisted channel {channel} blocked")
        return None
    if dry_run:
        _info(f"  [dry-run] slack post -> {channel}: {text[:120]}")
        return "dry-run-ts"
    try:
        kwargs: dict[str, Any] = {"channel": channel, "text": text}
        if thread_ts:
            kwargs["thread_ts"] = thread_ts
        res = client.chat_postMessage(**kwargs)
        return res.data.get("ts") if res.data.get("ok") else None
    except Exception as e:
        _warn(f"chat.postMessage failed: {e}")
        return None


def _slack_thread_replies(client, channel: str, parent_ts: str) -> list[dict] | None:
    """Replies in a thread, excluding the parent message.

    Returns `None` when the read FAILED and `[]` when it succeeded and nobody
    has replied yet. The distinction is load-bearing: `[]` lets a question age
    toward its timeout, and an expired question is deleted from
    `pending_questions` and recorded in `processed_thread_keys`, which the
    curator never re-asks. Collapsing a failed read into `[]` therefore turns
    a Slack outage into permanent loss of a reply nobody ever read.
    """
    try:
        res = client.conversations_replies(channel=channel, ts=parent_ts, limit=50)
        msgs = res.data.get("messages") or []
        return msgs[1:] if msgs else []
    except Exception as e:
        _err(f"conversations.replies failed for {channel}/{parent_ts}: {e}")
        return None


# ---------------------------------------------------------------------------
# elnora-linear CLI wrappers
# ---------------------------------------------------------------------------

def _run(cmd: list[str], *, timeout: int = 120) -> tuple[int, str, str]:
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        return r.returncode, r.stdout, r.stderr
    except subprocess.TimeoutExpired:
        return 124, "", f"timeout after {timeout}s"
    except FileNotFoundError as e:
        return 127, "", str(e)


def _linear_get_issue(issue_id: str) -> dict | None:
    code, out, err = _run([LINEAR_CLI, "issues", "get", issue_id])
    if code != 0:
        _warn(f"elnora-linear issues get {issue_id} exited {code}: {err.strip()[:200]}")
        return None
    if not out.strip():
        return None
    try:
        return json.loads(out)
    except json.JSONDecodeError:
        return None


def _linear_update_state(issue_id: str, state: str, *, dry_run: bool) -> bool:
    if dry_run:
        _info(f"  [dry-run] elnora-linear issues update {issue_id} --state '{state}'")
        return True
    code, _, err = _run([LINEAR_CLI, "issues", "update", issue_id, "--state", state])
    if code != 0:
        _err(f"update {issue_id} failed: {err.strip()[:200]}")
        return False
    return True


def _linear_post_comment(issue_id: str, body: str, *, dry_run: bool) -> bool:
    if dry_run:
        _info(f"  [dry-run] elnora-linear comments create {issue_id} --body '{body[:80]}'")
        return True
    code, _, err = _run([LINEAR_CLI, "comments", "create", issue_id, "--body", body])
    if code != 0:
        _err(f"comment {issue_id} failed: {err.strip()[:200]}")
        return False
    return True


def _apply_state_change(issue_id: str, target: str, reasoning: str, *, dry_run: bool) -> bool:
    """Apply a state change and (best-effort) attach a rationale comment.

    State change comes first — a failed update must not leave a stray
    "curator auto-applied" comment on an issue that didn't actually move.
    """
    if not _linear_update_state(issue_id, target, dry_run=dry_run):
        return False
    comment = (
        f"Curator auto-applied via Slack reply: {reasoning}\n\n"
        "_Posted by the elnora-linear Slack bridge._"
    )
    # Comment is informational; we don't unwind the state change if it fails.
    _linear_post_comment(issue_id, comment, dry_run=dry_run)
    return True


# ---------------------------------------------------------------------------
# State I/O
# ---------------------------------------------------------------------------

def _acquire_upstream_lock() -> int | None:
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    for attempt in range(2):
        try:
            return os.open(str(UPSTREAM_LOCK), os.O_CREAT | os.O_EXCL | os.O_WRONLY)
        except FileExistsError:
            if attempt == 0:
                _v(f"upstream lock held; retrying in {LOCK_RETRY_SECONDS}s")
                time.sleep(LOCK_RETRY_SECONDS)
                continue
            _err(
                f"upstream lock {UPSTREAM_LOCK} held; abandoning. "
                "Delete the lock file manually if no curator is running."
            )
            return None
    return None


def _release_upstream_lock(fd: int | None) -> None:
    if fd is None:
        return
    try:
        os.close(fd)
    finally:
        try:
            UPSTREAM_LOCK.unlink()
        except FileNotFoundError:
            pass


def _load_upstream_state() -> dict:
    if not UPSTREAM_STATE.exists():
        return {
            "version": 1,
            "pending_questions": [],
            "processed_thread_keys": [],
            "out_of_band_queue": [],
            "last_run_ended_at": None,
            "stats": [],
        }
    return json.loads(UPSTREAM_STATE.read_text(encoding="utf-8"))


def _save_upstream_state(state: dict) -> None:
    tmp = UPSTREAM_STATE.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(state, indent=2) + "\n", encoding="utf-8")
    os.chmod(tmp, 0o600)
    tmp.replace(UPSTREAM_STATE)


def _load_bridge_state() -> dict:
    if not BRIDGE_STATE.exists():
        return {"version": 1, "posted": {}}
    return json.loads(BRIDGE_STATE.read_text(encoding="utf-8"))


def _save_bridge_state(state: dict) -> None:
    BRIDGE_STATE.parent.mkdir(parents=True, exist_ok=True)
    tmp = BRIDGE_STATE.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(state, indent=2) + "\n", encoding="utf-8")
    tmp.replace(BRIDGE_STATE)


# ---------------------------------------------------------------------------
# Assignee resolution
# ---------------------------------------------------------------------------

def _fallback_slack_id() -> tuple[str | None, str | None]:
    candidate = FALLBACK_DM_USER
    if not candidate:
        # First entry in allowed_dm_users (in declared order) that has a
        # slack_user_id wins. Iterating the list, not the set, keeps the
        # fallback deterministic across runs.
        for key in ALLOWED_DM_USERS_LIST:
            u = USERS_BY_KEY.get(key)
            if u and u.get("slack_user_id"):
                candidate = key
                break
    user = USERS_BY_KEY.get(candidate or "") or {}
    sid = user.get("slack_user_id")
    if sid in ALLOWED_SLACK_IDS:
        name = user.get("name") or user.get("key")
        return sid, f"{name} (fallback)" if name else None
    return None, None


def _resolve_assignee_slack_id(issue_id: str) -> tuple[str | None, str | None]:
    """Return (slack_user_id, display_name) for the issue's assignee.

    Falls back to the configured fallback_dm_user (or the first entry in
    allowed_dm_users) when:
      - the issue has no assignee
      - the assignee isn't in users.json
      - the assignee has no slack_user_id
      - the assignee isn't in allowed_dm_users

    Returns (None, None) only when no DM-able fallback exists either.
    """
    issue = _linear_get_issue(issue_id)
    assignee_name = (issue or {}).get("assignee")
    if isinstance(assignee_name, str) and assignee_name in USERS_BY_NAME:
        u = USERS_BY_NAME[assignee_name]
        sid = u.get("slack_user_id")
        if sid and sid in ALLOWED_SLACK_IDS:
            return sid, u.get("name") or u.get("key")
    return _fallback_slack_id()


# ---------------------------------------------------------------------------
# Message formatting
# ---------------------------------------------------------------------------

def _question_text(q: dict) -> str:
    """Return the question text, tolerating entries staged without one.

    pending_questions entries written by curator builds before the
    missing_question_text guard can lack the field entirely; synthesize a
    usable question from the thread_key so the entry can still be posted
    and resolved instead of crashing the tick.
    """
    text = (q.get("question_text") or "").strip()
    if text:
        return text
    key = q.get("thread_key") or ""
    try:
        proposed = json.loads(key.split(":", 1)[1])
        return (
            f"The curator proposed: {proposed.get('type')} "
            f"{proposed.get('from')} → {proposed.get('to')} "
            "(no question text was recorded). Apply it?"
        )
    except (IndexError, json.JSONDecodeError):
        return "The curator proposed a state change (no question text was recorded). Apply it?"


def _format_dm_question(issue_id: str, question_text: str) -> str:
    if WORKSPACE_SLUG:
        link = f"<https://linear.app/{WORKSPACE_SLUG}/issue/{issue_id}|{issue_id}>"
    else:
        link = issue_id
    # CURATOR_MARKER prefix lets downstream chat-bots (e.g. a general-purpose
    # agent that shares the same Slack identity) skip auto-responding to
    # these DMs by filtering on the prefix.
    return (
        f"{CURATOR_MARKER} {link}: {question_text}\n\n"
        "Reply here with what you want to do (e.g., 'done', 'cancel', 'wait')."
    )


# ---------------------------------------------------------------------------
# Mode: post-pending
# ---------------------------------------------------------------------------

def cmd_post_pending(*, dry_run: bool) -> int:
    client = _slack_client()
    if client is None and not dry_run:
        return 2

    lock_fd = _acquire_upstream_lock()
    if lock_fd is None:
        return 4
    try:
        upstream = _load_upstream_state()
        bridge = _load_bridge_state()
        posted = bridge.get("posted", {})
        pending = upstream.get("pending_questions", [])

        pending_by_key = {q["thread_key"]: q for q in pending}
        upstream_keys = set(pending_by_key.keys())
        side_keys = set(posted.keys())

        # GC: drop side-state entries for thread_keys upstream no longer cares about
        for k in list(side_keys - upstream_keys):
            _v(f"GC: removing posted entry for resolved thread_key {k}")
            posted.pop(k, None)

        # Post unposted upstream questions
        new_post_count = 0
        for k in sorted(upstream_keys - side_keys):
            if new_post_count >= MAX_NEW_DMS_PER_TICK:
                _info(
                    f"post-pending: hit max_new_dms_per_tick={MAX_NEW_DMS_PER_TICK}; "
                    "remaining questions post on later ticks"
                )
                break
            q = pending_by_key[k]
            issue_id = q["issue_id"]
            question_text = _question_text(q)
            posted_at = q.get("posted_at")

            slack_id, display = _resolve_assignee_slack_id(issue_id)
            if not slack_id:
                _warn(f"{issue_id}: no DM-able assignee or fallback; skipping")
                continue

            dm_channel = _slack_open_dm(client, slack_id) if client else "DRYRUN"
            if not dm_channel:
                _warn(f"{issue_id}: could not open DM with {slack_id}; skipping")
                continue

            body = _format_dm_question(issue_id, question_text)
            ts = _slack_post(client, dm_channel, body, dry_run=dry_run)
            if not ts:
                _warn(f"{issue_id}: DM post failed; will retry next run")
                continue

            posted[k] = {
                "issue_id": issue_id,
                "thread_key": k,
                "recipient_user_id": slack_id,
                "recipient_name": display,
                "dm_channel": dm_channel,
                "dm_ts": ts,
                "posted_at": posted_at,
                "bridge_posted_at": datetime.now(timezone.utc).isoformat(),
            }
            new_post_count += 1
            _info(f"  posted DM -> {display}: {issue_id} ({question_text[:60]})")

        bridge["posted"] = posted
        if not dry_run:
            _save_bridge_state(bridge)

        _info(
            f"post-pending: {new_post_count} new DM(s), "
            f"{len(side_keys - upstream_keys)} GC'd, {len(posted)} still tracked"
        )
        return 0
    finally:
        _release_upstream_lock(lock_fd)


# ---------------------------------------------------------------------------
# Mode: resolve
# ---------------------------------------------------------------------------

# Reply interpretation: TypeSafe Jev, a classifier that answers one choice
# question over fixed labels with a calibrated probability per label.
JEV_URL = "https://openrouter.ai/api/v1/systemone"
JEV_MODEL = "~typesafe/jev-latest"
JEV_TIMEOUT_S = 20
# Jev answers at >= 0.9 are right about 99% of the time. A decision that
# closes the question (skip) or also moves the issue (apply, cancel) takes
# 0.95 from a Jev model; anything weaker asks the person again.
CLOSE_CONFIDENCE = 0.95
CLOSING_DECISIONS = ("apply", "skip", "cancel")

REPLY_QUESTION = (
    "The assignee of a Linear issue was asked the curator question below and replied "
    "in Slack. What does the reply tell the curator to do with the proposed change?"
)
REPLY_CRITERIA = {
    "apply": "The reply clearly confirms the proposed change: yes, it is done, close it, ship it.",
    "skip": (
        "The reply declines the proposed change and wants the issue left as it is: no, "
        "not yet, keep it, hold, leave it, still working on it, wait."
    ),
    "cancel": "The reply explicitly asks to cancel the issue: cancel, won't fix, abandon, kill, drop it.",
    "defer": "The reply is about something else or gives no answer yet, so wait for a further reply.",
    "follow_up": (
        "The reply is ambiguous, unsure, mixes several instructions, asks a question, or "
        "contradicts the proposal, so the curator should ask a clarifying question."
    ),
}
FOLLOW_UP_TEXT = (
    "I could not tell what you want for this one. Reply 'yes' to apply the proposed change, "
    "'no' to leave the issue as it is, or 'cancel' to cancel the issue."
)


class JevError(Exception):
    """Jev was unreachable or returned an answer that fails validation."""


class JevInvalid(JevError):
    """Jev answered, but the answer fails validation (in practice: a close call)."""


def _is_probability(x: Any) -> bool:
    return (
        isinstance(x, (int, float))
        and not isinstance(x, bool)
        and math.isfinite(x)
        and 0.0 <= x <= 1.0
    )


def _validate_jev(data: Any, criteria: dict[str, str]) -> tuple[str, float, str]:
    """Return (choice, confidence, model) from a Jev response, or raise JevError."""
    try:
        model = data["model"]
        answer = data["answers"]["q"]
        choice = answer["choice"]
        confidence = answer["confidence"]
        probabilities = answer["probabilities"]
    except (KeyError, TypeError) as e:
        raise JevInvalid(f"malformed Jev response: missing {e}") from None
    if not isinstance(model, str):
        raise JevInvalid("Jev response has no model string")
    if not isinstance(choice, str) or choice not in criteria:
        raise JevInvalid(f"Jev chose a label outside the criteria: {choice!r}")
    if not _is_probability(confidence):
        raise JevInvalid(f"Jev confidence is not a probability: {confidence!r}")
    if not isinstance(probabilities, dict) or not all(_is_probability(p) for p in probabilities.values()):
        raise JevInvalid("Jev probabilities are not all probabilities")
    if choice not in probabilities or abs(probabilities[choice] - confidence) > 0.1:
        raise JevInvalid("Jev confidence disagrees with its probabilities")
    return choice, float(confidence), model


def _jev_choice(state: str, question: str, criteria: dict[str, str]) -> tuple[str, float, str]:
    key = os.environ.get("OPENROUTER_API_KEY")
    if not key:
        raise JevError("OPENROUTER_API_KEY not set")
    body = json.dumps({
        "model": JEV_MODEL,
        "state": state,
        "questions": {"q": {"type": "choice", "instructions": question, "criteria": criteria}},
    }).encode("utf-8")
    req = urllib.request.Request(
        JEV_URL,
        data=body,
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=JEV_TIMEOUT_S) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except (OSError, ValueError) as e:  # URLError, HTTPError and timeouts are OSErrors
        raise JevError(f"Jev request failed: {e}") from None
    return _validate_jev(data, criteria)


def _proposed_target(thread_key: str) -> str:
    """The state the curator proposed, read from the thread_key; Done if absent."""
    try:
        proposed = json.loads(thread_key.split(":", 1)[1])
        return proposed.get("to") or "Done"
    except (IndexError, ValueError, AttributeError):
        return "Done"


def _reply_state(p: dict) -> str:
    replies = "\n".join(f"- {r.get('text', '')}" for r in p.get("replies") or [])
    return (
        f"Curator question about {p.get('issue_id', '?')}: {p.get('question_text', '')}\n\n"
        f"Replies from the assignee, oldest first:\n{replies}"
    )


def _resolve_one(p: dict) -> dict:
    """Decide one thread. Only a confident Jev answer may close it or move the issue."""
    k = p["thread_key"]
    try:
        choice, confidence, model = _jev_choice(_reply_state(p), REPLY_QUESTION, REPLY_CRITERIA)
        decision = choice
        if choice in CLOSING_DECISIONS and not (
            confidence >= CLOSE_CONFIDENCE and model.startswith("typesafe/jev-")
        ):
            decision = "follow_up"
        reasoning = f"Jev read the reply as {choice} ({confidence:.2f}, {model})"
    except JevInvalid as e:
        # Jev answered but the answer does not hold together; seen live on
        # replies that mix two instructions. Ask the person, change nothing.
        _warn(f"{p.get('issue_id', '?')}: Jev answer rejected ({e}); asking again")
        decision, reasoning = "follow_up", str(e)
    except JevError as e:
        # Jev unreachable: touch nothing, read the thread again next tick.
        _err(f"{p.get('issue_id', '?')}: reply not judged ({e}); question retained")
        return {"thread_key": k, "decision": "defer", "reasoning": str(e)}
    if decision == "follow_up":
        # Ask once per reply: if the last follow-up is newer than the latest
        # reply, the person has not answered it yet.
        last_fu = p.get("last_follow_up_ts")
        latest = (p.get("replies") or [{}])[-1].get("ts")
        try:
            if last_fu and latest and float(last_fu) >= float(latest):
                decision = "defer"
        except ValueError:
            pass
    target = {"apply": _proposed_target(k), "cancel": "Canceled"}.get(decision)
    return {
        "thread_key": k,
        "decision": decision,
        "target_state": target,
        "reasoning": reasoning,
        "follow_up_text": FOLLOW_UP_TEXT,
    }


def _batch_resolve(payload: list[dict]) -> dict:
    return {"resolutions": [_resolve_one(p) for p in payload]}


def cmd_resolve(*, dry_run: bool) -> int:
    client = _slack_client()
    if client is None and not dry_run:
        return 2

    lock_fd = _acquire_upstream_lock()
    if lock_fd is None:
        return 4
    try:
        upstream = _load_upstream_state()
        bridge = _load_bridge_state()
        posted = bridge.get("posted", {})
        pending = upstream.get("pending_questions", [])
        pending_by_key = {q["thread_key"]: q for q in pending}

        now_unix = time.time()
        timeout_s = QUESTION_TIMEOUT_DAYS * 86400
        payload: list[dict] = []
        timed_out: list[str] = []
        unreadable: list[str] = []

        for k, post in list(posted.items()):
            if k not in pending_by_key:
                # Upstream already removed this thread_key.
                continue
            q = pending_by_key[k]

            # Read BEFORE evaluating expiry. Dropping a question is
            # irreversible (see `_remove_from_upstream`), so it may only
            # happen on the strength of a successful read that showed no
            # reply — never on a tick where Slack was unreachable and the
            # only thing we know is that we know nothing.
            if client is None:
                _info(f"  no Slack client — cannot read {q.get('issue_id', '?')}; question retained")
                continue
            replies = _slack_thread_replies(client, post["dm_channel"], post["dm_ts"])
            if replies is None:
                unreadable.append(k)
                _err(
                    f"{q.get('issue_id', '?')}: thread read failed; question retained "
                    "and not considered for timeout this tick"
                )
                continue

            # Only count replies from the recipient (not the bot itself).
            replies = [r for r in replies if r.get("user") == post["recipient_user_id"]]
            if not replies:
                # Confirmed: no reply. Time out from when the DM was actually
                # posted, not from when the curator staged the question — a
                # backlog question staged weeks ago would otherwise be DM'd
                # and instantly dropped.
                try:
                    posted_at_unix = datetime.fromisoformat(
                        (post.get("bridge_posted_at") or post["posted_at"]).replace("Z", "+00:00")
                    ).timestamp()
                except (ValueError, KeyError, AttributeError, TypeError):
                    posted_at_unix = now_unix
                if now_unix - posted_at_unix > timeout_s:
                    timed_out.append(k)
                continue

            payload.append({
                "thread_key": k,
                "issue_id": q["issue_id"],
                "question_text": _question_text(q),
                "posted_at": post["posted_at"],
                "last_follow_up_ts": post.get("last_follow_up_ts"),
                "replies": [
                    {
                        "ts": r.get("ts"),
                        "user": post.get("recipient_name"),
                        "text": (r.get("text") or "")[:1000],
                    }
                    for r in replies[-10:]
                ],
            })

        for k in timed_out:
            posted.pop(k, None)
            q = pending_by_key.get(k, {})
            # The question is gone for good after this — the curator will not
            # re-ask a thread_key in processed_thread_keys — so say so on
            # stderr rather than burying it in the run log.
            _warn(
                f"timeout: {q.get('issue_id', '?')} — "
                f"{QUESTION_TIMEOUT_DAYS} days without reply, dropping question permanently"
            )
            upstream["pending_questions"] = [
                pq for pq in upstream["pending_questions"] if pq["thread_key"] != k
            ]
            if k not in upstream.get("processed_thread_keys", []):
                upstream.setdefault("processed_thread_keys", []).append(k)

        applied_count = 0
        skipped_count = 0
        followed_up_count = 0

        if payload:
            _info(f"  judging replies in {len(payload)} thread(s) with Jev")
            result = _batch_resolve(payload)
            for r in result.get("resolutions") or []:
                k = r.get("thread_key")
                q = pending_by_key.get(k)
                post = posted.get(k)
                if not q or not post:
                    continue
                decision = r.get("decision", "defer")
                reasoning = r.get("reasoning", "")
                issue_id = q["issue_id"]

                if decision == "apply":
                    target = r.get("target_state") or "Done"
                    if _apply_state_change(issue_id, target, reasoning, dry_run=dry_run):
                        applied_count += 1
                        _remove_from_upstream(upstream, k)
                        if not dry_run:
                            posted.pop(k, None)
                elif decision == "cancel":
                    target = r.get("target_state") or "Canceled"
                    if _apply_state_change(issue_id, target, reasoning, dry_run=dry_run):
                        applied_count += 1
                        _remove_from_upstream(upstream, k)
                        if not dry_run:
                            posted.pop(k, None)
                elif decision == "skip":
                    skipped_count += 1
                    _remove_from_upstream(upstream, k)
                    if not dry_run:
                        posted.pop(k, None)
                elif decision == "follow_up":
                    fu = r.get("follow_up_text") or "Could you clarify?"
                    if client:
                        ts = _slack_post(
                            client,
                            post["dm_channel"],
                            f"{CURATOR_MARKER} {fu}",
                            thread_ts=post["dm_ts"],
                            dry_run=dry_run,
                        )
                        if ts and not dry_run:
                            post["last_follow_up_ts"] = ts
                    followed_up_count += 1
                # "defer" → do nothing; will retry next tick

        bridge["posted"] = posted
        if not dry_run:
            _save_bridge_state(bridge)
            _save_upstream_state(upstream)

        deferred = max(
            0, len(payload) - applied_count - skipped_count - followed_up_count
        )
        _info(
            f"resolve: {applied_count} applied, {skipped_count} skipped, "
            f"{followed_up_count} followed up, {len(timed_out)} timed out, "
            f"{deferred} deferred, {len(unreadable)} unreadable"
        )
        if unreadable:
            # A tick that could not read part of the thread set did not do its
            # job. Exiting 0 would tell the scheduler otherwise.
            _err(f"{len(unreadable)} thread(s) could not be read this tick; questions retained")
            return 5
        return 0
    finally:
        _release_upstream_lock(lock_fd)


def _remove_from_upstream(upstream: dict, thread_key: str) -> None:
    upstream["pending_questions"] = [
        q for q in upstream.get("pending_questions", []) if q["thread_key"] != thread_key
    ]
    if thread_key not in upstream.get("processed_thread_keys", []):
        upstream.setdefault("processed_thread_keys", []).append(thread_key)


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main(argv: list[str]) -> int:
    global VERBOSE
    parser = argparse.ArgumentParser(
        description="Slack bridge for the @elnora-ai/linear curator.",
    )
    parser.add_argument("mode", choices=["post-pending", "resolve", "tick"])
    parser.add_argument("--dry-run", action="store_true", help="Log intended actions without performing them")
    parser.add_argument("-v", "--verbose", action="store_true")
    args = parser.parse_args(argv)

    VERBOSE = args.verbose

    if args.mode == "post-pending":
        return cmd_post_pending(dry_run=args.dry_run)
    if args.mode == "resolve":
        return cmd_resolve(dry_run=args.dry_run)
    # tick
    rc1 = cmd_post_pending(dry_run=args.dry_run)
    rc2 = cmd_resolve(dry_run=args.dry_run)
    return rc1 or rc2


if __name__ == "__main__":
    try:
        sys.exit(main(sys.argv[1:]))
    except KeyboardInterrupt:
        sys.exit(130)
    except Exception as e:
        _err(f"unhandled: {e}")
        sys.exit(1)
