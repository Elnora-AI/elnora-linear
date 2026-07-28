"""Tests for bridges/slack/bridge.py.

Run with: python3 -m pytest __tests__/bridges -q

bridge.py imports slack_sdk and anthropic lazily, so these tests need
nothing but the standard library and pytest. Every Slack and Anthropic
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
THREAD_KEY = "ELN-880:is-this-done"


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

    spec = importlib.util.spec_from_file_location("bridge_under_test", BRIDGE_PATH)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    # Never construct a real WebClient: the tests stub the read helper and
    # only need a non-None sentinel to get past the "no client" branch.
    monkeypatch.setattr(mod, "_slack_client", lambda: object())
    return mod


def seed_question(mod, *, age_days: float) -> None:
    """One pending question, DM'd `age_days` ago."""
    posted_at = (datetime.now(timezone.utc) - timedelta(days=age_days)).isoformat().replace("+00:00", "Z")
    mod.UPSTREAM_STATE.write_text(
        json.dumps(
            {
                "version": 1,
                "pending_questions": [
                    {
                        "thread_key": THREAD_KEY,
                        "issue_id": "ELN-880",
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
                    THREAD_KEY: {
                        "dm_channel": "D0000000000",
                        "dm_ts": "1700000000.000100",
                        "recipient_user_id": "U0000000000",
                        "recipient_name": "recipient",
                        "posted_at": posted_at,
                        "bridge_posted_at": posted_at,
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
    assert "ELN-880" in capsys.readouterr().err
