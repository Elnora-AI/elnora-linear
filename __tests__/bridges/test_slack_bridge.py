"""Tests for bridges/slack/bridge.py.

Run with: python3 -m pytest __tests__/bridges -q

bridge.py imports slack_sdk lazily and calls Jev with urllib, so these
tests need nothing but the standard library and pytest. Every Slack and Jev
call is stubbed — nothing here touches the network.

The focus is the one irreversible operation the bridge performs: expiring
a pending question. Expiry deletes it from `pending_questions` AND records
its thread_key in `processed_thread_keys`, which the curator treats as
"already handled" forever. It may therefore only ever follow a successful
read that showed no reply.
"""
from __future__ import annotations

import importlib.util
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

BRIDGE_PATH = Path(__file__).resolve().parents[2] / "bridges" / "slack" / "bridge.py"
THREAD_KEY = "ENG-880:is-this-done"


@pytest.fixture
def bridge(tmp_path, monkeypatch):
    """A fresh bridge module bound to a throwaway state directory.

    bridge.py resolves its paths into module-level constants at import
    time, so the env has to be set before the module is executed and the
    module has to be re-executed per test.
    """
    state_dir = tmp_path / "state"
    refs_dir = tmp_path / "refs"
    state_dir.mkdir()
    refs_dir.mkdir()
    monkeypatch.setenv("LINEAR_CURATOR_STATE_DIR", str(state_dir))
    monkeypatch.setenv("LINEAR_REFERENCES_DIR", str(refs_dir))
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-key")
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)

    spec = importlib.util.spec_from_file_location("bridge_under_test", BRIDGE_PATH)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    # Never construct a real WebClient: the tests stub the read helper and
    # only need a non-None sentinel to get past the "no client" branch.
    monkeypatch.setattr(mod, "_slack_client", lambda: object())
    return mod


def seed_question(mod, *, age_days: float, thread_key: str = THREAD_KEY, last_follow_up_ts: str | None = None) -> None:
    """One pending question, DM'd `age_days` ago."""
    posted_at = (datetime.now(timezone.utc) - timedelta(days=age_days)).isoformat().replace("+00:00", "Z")
    mod.UPSTREAM_STATE.write_text(
        json.dumps(
            {
                "version": 1,
                "pending_questions": [
                    {
                        "thread_key": thread_key,
                        "issue_id": "ENG-880",
                        "question_text": "Is this done?",
                    }
                ],
                "processed_thread_keys": [],
                "out_of_band_queue": [],
                "last_run_ended_at": None,
                "stats": [],
            }
        ),
        encoding="utf-8",
    )
    mod.BRIDGE_STATE.write_text(
        json.dumps(
            {
                "version": 1,
                "posted": {
                    thread_key: {
                        "dm_channel": "D0000000000",
                        "dm_ts": "1700000000.000100",
                        "recipient_user_id": "U0000000000",
                        "recipient_name": "recipient",
                        "posted_at": posted_at,
                        "bridge_posted_at": posted_at,
                        **({"last_follow_up_ts": last_follow_up_ts} if last_follow_up_ts else {}),
                    }
                },
            }
        ),
        encoding="utf-8",
    )


def upstream(mod) -> dict:
    return json.loads(mod.UPSTREAM_STATE.read_text(encoding="utf-8"))


class FakeSlack:
    """Minimal conversations.replies stand-in."""

    def __init__(self, messages=None, raises: Exception | None = None):
        self._messages = messages
        self._raises = raises

    def conversations_replies(self, **_kwargs):
        if self._raises is not None:
            raise self._raises
        return type("Res", (), {"data": {"messages": self._messages}})()


# ---------------------------------------------------------------------------
# _slack_thread_replies: None (failed) vs [] (no reply yet)
# ---------------------------------------------------------------------------

def test_replies_excludes_the_parent_message(bridge):
    client = FakeSlack(messages=[{"text": "question"}, {"text": "yes done"}])
    assert bridge._slack_thread_replies(client, "D1", "1.0") == [{"text": "yes done"}]


def test_replies_is_empty_list_when_nobody_answered(bridge):
    client = FakeSlack(messages=[{"text": "question"}])
    assert bridge._slack_thread_replies(client, "D1", "1.0") == []


def test_replies_is_none_when_the_read_fails(bridge, capsys):
    client = FakeSlack(raises=RuntimeError("fetch failed"))
    assert bridge._slack_thread_replies(client, "D1", "1.0") is None
    captured = capsys.readouterr()
    assert "fetch failed" in captured.err
    assert captured.out == ""


# ---------------------------------------------------------------------------
# cmd_resolve: expiry only after a successful read
# ---------------------------------------------------------------------------

def test_expired_question_is_dropped_after_a_successful_empty_read(bridge, monkeypatch):
    seed_question(bridge, age_days=bridge.QUESTION_TIMEOUT_DAYS + 1)
    monkeypatch.setattr(bridge, "_slack_thread_replies", lambda *a, **k: [])

    assert bridge.cmd_resolve(dry_run=False) == 0
    state = upstream(bridge)
    assert state["pending_questions"] == []
    assert state["processed_thread_keys"] == [THREAD_KEY]


def test_expired_question_survives_a_failed_read(bridge, monkeypatch, capsys):
    seed_question(bridge, age_days=bridge.QUESTION_TIMEOUT_DAYS + 30)
    monkeypatch.setattr(bridge, "_slack_thread_replies", lambda *a, **k: None)

    # Non-zero: a tick that could not read the threads did not do its job.
    assert bridge.cmd_resolve(dry_run=False) == 5
    state = upstream(bridge)
    assert [q["thread_key"] for q in state["pending_questions"]] == [THREAD_KEY]
    assert state["processed_thread_keys"] == []
    assert "thread read failed" in capsys.readouterr().err


def test_expired_question_with_a_reply_is_resolved_not_dropped(bridge, monkeypatch):
    seed_question(bridge, age_days=bridge.QUESTION_TIMEOUT_DAYS + 1)
    monkeypatch.setattr(
        bridge,
        "_slack_thread_replies",
        lambda *a, **k: [{"ts": "2.0", "user": "U0000000000", "text": "yes, done"}],
    )
    seen: list[dict] = []

    def fake_batch_resolve(payload):
        seen.extend(payload)
        return {"resolutions": [], "out_of_band_mentions": []}

    monkeypatch.setattr(bridge, "_batch_resolve", fake_batch_resolve)

    assert bridge.cmd_resolve(dry_run=False) == 0
    assert [p["thread_key"] for p in seen] == [THREAD_KEY]
    # Deferred by the resolver, so it stays pending — but it was read, not lost.
    assert [q["thread_key"] for q in upstream(bridge)["pending_questions"]] == [THREAD_KEY]


def test_unexpired_question_without_replies_is_left_alone(bridge, monkeypatch):
    seed_question(bridge, age_days=1)
    monkeypatch.setattr(bridge, "_slack_thread_replies", lambda *a, **k: [])

    assert bridge.cmd_resolve(dry_run=False) == 0
    assert [q["thread_key"] for q in upstream(bridge)["pending_questions"]] == [THREAD_KEY]


def test_no_slack_client_never_expires_anything(bridge, monkeypatch):
    seed_question(bridge, age_days=bridge.QUESTION_TIMEOUT_DAYS + 1)
    monkeypatch.setattr(bridge, "_slack_client", lambda: None)

    assert bridge.cmd_resolve(dry_run=True) == 0
    assert [q["thread_key"] for q in upstream(bridge)["pending_questions"]] == [THREAD_KEY]


# ---------------------------------------------------------------------------
# Warnings are diagnostics: they belong on stderr
# ---------------------------------------------------------------------------

def test_warnings_go_to_stderr(bridge, capsys):
    bridge._warn("something degraded")
    captured = capsys.readouterr()
    assert "something degraded" in captured.err
    assert captured.out == ""


def test_dropping_a_question_is_reported_on_stderr(bridge, monkeypatch, capsys):
    seed_question(bridge, age_days=bridge.QUESTION_TIMEOUT_DAYS + 1)
    monkeypatch.setattr(bridge, "_slack_thread_replies", lambda *a, **k: [])

    bridge.cmd_resolve(dry_run=False)
    assert "ENG-880" in capsys.readouterr().err


# ---------------------------------------------------------------------------
# Reply judging by Jev: only a confident Jev answer may change Linear
# ---------------------------------------------------------------------------

JEV_VERSION = "typesafe/jev-1.13-20260917"
LABELS = ["apply", "skip", "cancel", "defer", "follow_up"]


def jev_answer(choice: str, confidence: float, *, model: str = JEV_VERSION) -> dict:
    rest = (1.0 - confidence) / (len(LABELS) - 1)
    probs = {label: (confidence if label == choice else rest) for label in LABELS}
    return {"model": model, "answers": {"q": {"choice": choice, "confidence": confidence, "probabilities": probs}}}


class FakeResponse:
    def __init__(self, body: bytes):
        self._body = body

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def read(self) -> bytes:
        return self._body


@pytest.fixture
def jev(bridge, monkeypatch):
    """Fake the Jev HTTP endpoint. Set `.answer` (a dict) or `.raises`."""

    class Jev:
        answer: object = None
        raises: Exception | None = None
        requests: list = []

    fake = Jev()
    fake.requests = []

    def urlopen(req, timeout=None):
        fake.requests.append((req, timeout))
        if fake.raises is not None:
            raise fake.raises
        return FakeResponse(json.dumps(fake.answer).encode("utf-8"))

    monkeypatch.setattr("urllib.request.urlopen", urlopen)
    return fake


@pytest.fixture
def effects(bridge, monkeypatch):
    """Record Linear state changes and Slack posts instead of making them."""
    seen = {"updates": [], "posts": []}

    def update(issue_id, state, *, dry_run):
        seen["updates"].append((issue_id, state))
        return True

    def post(client, channel, text, *, thread_ts=None, dry_run):
        seen["posts"].append(text)
        return "1700000100.000100"

    monkeypatch.setattr(bridge, "_linear_update_state", update)
    monkeypatch.setattr(bridge, "_linear_post_comment", lambda *a, **k: True)
    monkeypatch.setattr(bridge, "_slack_post", post)
    return seen


def reply_with(bridge, monkeypatch, text: str, ts: str = "1700000050.000100") -> None:
    monkeypatch.setattr(
        bridge,
        "_slack_thread_replies",
        lambda *a, **k: [{"ts": ts, "user": "U0000000000", "text": text}],
    )


def pending_keys(bridge) -> list[str]:
    return [q["thread_key"] for q in upstream(bridge)["pending_questions"]]


@pytest.mark.parametrize(
    "answer, raises",
    [
        (None, OSError("connection refused")),  # Jev down
        (jev_answer("apply", 0.6), None),  # Jev unsure
        (jev_answer("skip", 0.97), None),  # Jev confident, right answer
    ],
)
def test_no_not_done_yet_never_marks_the_issue_done(bridge, jev, effects, monkeypatch, answer, raises):
    # Regression: the old keyword fallback matched "done" before "no" and moved the issue to Done.
    seed_question(bridge, age_days=1)
    reply_with(bridge, monkeypatch, "no, not done yet")
    jev.answer, jev.raises = answer, raises

    bridge.cmd_resolve(dry_run=False)

    assert effects["updates"] == []


def test_confident_skip_closes_the_question_without_touching_linear(bridge, jev, effects, monkeypatch):
    seed_question(bridge, age_days=1)
    reply_with(bridge, monkeypatch, "no, not done yet")
    jev.answer = jev_answer("skip", 0.97)

    assert bridge.cmd_resolve(dry_run=False) == 0
    assert effects["updates"] == []
    assert pending_keys(bridge) == []
    assert upstream(bridge)["processed_thread_keys"] == [THREAD_KEY]


@pytest.mark.parametrize("choice, target", [("apply", "Done"), ("cancel", "Canceled")])
def test_state_change_applies_at_exactly_the_threshold(bridge, jev, effects, monkeypatch, choice, target):
    seed_question(bridge, age_days=1)
    reply_with(bridge, monkeypatch, "yes close it" if choice == "apply" else "cancel this one")
    jev.answer = jev_answer(choice, 0.95)

    assert bridge.cmd_resolve(dry_run=False) == 0
    assert effects["updates"] == [("ENG-880", target)]
    assert pending_keys(bridge) == []


@pytest.mark.parametrize("choice", ["apply", "cancel", "skip"])
def test_closing_decision_just_below_the_threshold_asks_again(bridge, jev, effects, monkeypatch, choice):
    seed_question(bridge, age_days=1)
    reply_with(bridge, monkeypatch, {"apply": "yes close it", "cancel": "cancel this one", "skip": "no"}[choice])
    jev.answer = jev_answer(choice, 0.9499)

    assert bridge.cmd_resolve(dry_run=False) == 0
    assert effects["updates"] == []
    assert len(effects["posts"]) == 1
    assert pending_keys(bridge) == [THREAD_KEY]


@pytest.mark.parametrize("model", ["openai/gpt-5", "typesafe/other-1.0", "jev-1.13"])
def test_confident_answer_from_a_non_jev_model_changes_nothing(bridge, jev, effects, monkeypatch, model):
    seed_question(bridge, age_days=1)
    reply_with(bridge, monkeypatch, "done!")
    jev.answer = jev_answer("apply", 0.99, model=model)

    bridge.cmd_resolve(dry_run=False)
    assert effects["updates"] == []
    assert pending_keys(bridge) == [THREAD_KEY]


def test_apply_moves_the_issue_to_the_proposed_state(bridge, jev, effects, monkeypatch):
    key = 'ENG-880:{"type":"set_state","from":"Todo","to":"In Progress"}'
    seed_question(bridge, age_days=1, thread_key=key)
    reply_with(bridge, monkeypatch, "yes")
    jev.answer = jev_answer("apply", 0.99)

    bridge.cmd_resolve(dry_run=False)
    assert effects["updates"] == [("ENG-880", "In Progress")]


def test_follow_up_is_not_repeated_until_the_person_replies_again(bridge, jev, effects, monkeypatch):
    seed_question(bridge, age_days=1, last_follow_up_ts="1700000060.000100")
    reply_with(bridge, monkeypatch, "hmm not sure", ts="1700000050.000100")
    jev.answer = jev_answer("follow_up", 0.9)

    bridge.cmd_resolve(dry_run=False)
    assert effects["posts"] == []
    assert pending_keys(bridge) == [THREAD_KEY]


def _bad(mutate):
    answer = jev_answer("apply", 0.97)
    mutate(answer)
    return answer


INVALID_ANSWERS = {
    "label outside criteria": _bad(lambda a: a["answers"]["q"].update(choice="close")),
    "confidence NaN": _bad(lambda a: a["answers"]["q"].update(confidence=float("nan"))),
    "confidence bool": _bad(lambda a: a["answers"]["q"].update(confidence=True)),
    "confidence string": _bad(lambda a: a["answers"]["q"].update(confidence="0.97")),
    "confidence above 1": _bad(lambda a: a["answers"]["q"].update(confidence=1.5)),
    "probability negative": _bad(lambda a: a["answers"]["q"]["probabilities"].update(skip=-0.1)),
    "probability string": _bad(lambda a: a["answers"]["q"]["probabilities"].update(skip="0.01")),
    "chosen label missing from probabilities": _bad(lambda a: a["answers"]["q"]["probabilities"].pop("apply")),
    "confidence disagrees with probabilities": _bad(
        lambda a: a["answers"]["q"]["probabilities"].update(apply=0.8)
    ),
    "no answers": {"model": JEV_VERSION},
    "no model": _bad(lambda a: a.pop("model")),
    "not an object": ["apply"],
}


@pytest.mark.parametrize("answer", INVALID_ANSWERS.values(), ids=INVALID_ANSWERS.keys())
def test_invalid_jev_answer_raises(bridge, jev, answer):
    jev.answer = answer
    with pytest.raises(bridge.JevError):
        bridge._jev_choice("state", "question", bridge.REPLY_CRITERIA)


@pytest.mark.parametrize("answer", INVALID_ANSWERS.values(), ids=INVALID_ANSWERS.keys())
def test_invalid_jev_answer_changes_nothing_and_asks_again(bridge, jev, effects, monkeypatch, answer):
    seed_question(bridge, age_days=1)
    reply_with(bridge, monkeypatch, "yes close it")
    jev.answer = answer

    assert bridge.cmd_resolve(dry_run=False) == 0
    assert effects["updates"] == []
    assert len(effects["posts"]) == 1
    assert pending_keys(bridge) == [THREAD_KEY]


def test_close_call_seen_live_asks_again(bridge, jev, effects, monkeypatch):
    # Recorded shape: on a mixed reply Jev's confidence (0.42) sits 0.12 off the chosen label's probability.
    seed_question(bridge, age_days=1)
    reply_with(bridge, monkeypatch, "it's done but reopen the other one")
    probs = {"skip": 0.01, "cancel": 0, "defer": 0, "apply": 0.45, "follow_up": 0.54}
    jev.answer = {"model": JEV_VERSION, "answers": {"q": {"choice": "follow_up", "confidence": 0.42, "probabilities": probs}}}

    bridge.cmd_resolve(dry_run=False)
    assert effects["updates"] == []
    assert len(effects["posts"]) == 1


@pytest.mark.parametrize("raises", [OSError("timed out"), TimeoutError("timed out")])
def test_jev_down_changes_nothing_and_keeps_the_question(bridge, jev, effects, monkeypatch, raises):
    seed_question(bridge, age_days=1)
    reply_with(bridge, monkeypatch, "done!")
    jev.raises = raises

    assert bridge.cmd_resolve(dry_run=False) == 0
    assert effects == {"updates": [], "posts": []}
    assert pending_keys(bridge) == [THREAD_KEY]


def test_missing_key_makes_no_request_and_changes_nothing(bridge, jev, effects, monkeypatch):
    monkeypatch.delenv("OPENROUTER_API_KEY")
    seed_question(bridge, age_days=1)
    reply_with(bridge, monkeypatch, "done!")

    bridge.cmd_resolve(dry_run=False)
    assert jev.requests == []
    assert effects == {"updates": [], "posts": []}


def test_jev_request_shape(bridge, jev, effects, monkeypatch):
    seed_question(bridge, age_days=1)
    reply_with(bridge, monkeypatch, "done!")
    jev.answer = jev_answer("apply", 0.99)

    bridge.cmd_resolve(dry_run=False)
    (req, timeout), = jev.requests
    body = json.loads(req.data)
    assert req.full_url == "https://openrouter.ai/api/v1/systemone"
    assert req.get_header("Authorization") == "Bearer test-key"
    assert timeout == 20
    assert body["model"] == "~typesafe/jev-latest"
    assert "done!" in body["state"]
    q = body["questions"]["q"]
    assert q["type"] == "choice"
    assert sorted(q["criteria"]) == sorted(LABELS)
