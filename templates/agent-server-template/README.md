# Agent webhook receiver — reference template

This directory is **a template, not a running server**. The Linear plugin is a CLI; it doesn't host long-running HTTP listeners. If you want the plugin to act as a Linear agent (the `actor=app` model where users `@mention` it or assign issues to it), you need to host this receiver somewhere — copy `server.example.ts` into your own project and adapt.

## What it does

1. Listens for `POST /linear/webhook` from Linear.
2. Verifies the `linear-signature` HMAC-SHA256 header against the body using your stored signing secret.
3. On `agentSessionEvent.created`, emits a `thought` activity within 10 seconds via the plugin's CLI to ack the session.
4. Hands off to your actual agent logic (which you write).

## Where to host

| Host | Notes |
|---|---|
| Cloudflare Workers | Linear's own `linear/linear-agent-demo` uses Workers. Edit the example to use the Fetch API runtime. |
| Vercel / Netlify functions | Fine for low traffic. Same Fetch API edits. |
| Fly.io / Railway / Render | Run the example mostly as-is on Node. |
| Local + ngrok | For dev only — Linear retries 3× on failure (1 min / 1 hr / 6 hr). |

## Setup

```bash
# 1. Build the plugin CLI so the template can call it.
npm install -g @elnora-ai/linear

# 2. Copy this template into your own project.
cp -r templates/agent-server-template /path/to/your/agent-server

# 3. Register the webhook with Linear.
linear webhooks create \
  --url https://your-public-url/linear/webhook \
  --resource-types AgentSessionEvent \
  --all-public-teams
# Save the secret it returns into LINEAR_WEBHOOK_SECRET.

# 4. Run the receiver.
LINEAR_API_KEY=lin_api_... \
LINEAR_WEBHOOK_SECRET=lin_wh_... \
node server.example.js
```

## What you fill in

The template stops after acking the session. The real agent logic — running Claude Code, opening a PR, posting back to Linear — goes in the `// TODO` block. Common patterns:

- **Quick echo bot:** emit a `response` activity with whatever you want to say.
- **Coding agent:** `child_process.spawn` your dev workflow (e.g. `claude` + a prompt that includes the issue context).
- **Triage routing:** read the issue, decide if it's for the bot, otherwise emit a `response` and exit.

Use the CLI for everything Linear-side:

```bash
linear agent-activities create <sessionId> --type thought --body "Working on it"
linear agent-activities create <sessionId> --type response --body "Done. PR: <url>"
linear agent-sessions update-external-url <sessionId> --add https://github.com/.../pull/42
```

## Security notes

- **Always** verify the signature before reading the body. The template ships an inline `verifyLinearWebhook` helper (HMAC-SHA256 + `timingSafeEqual`) — don't bypass it.
- **Never** commit `LINEAR_WEBHOOK_SECRET` or `LINEAR_API_KEY`. Use your host's secret store.
- **Rotate** the webhook secret with `linear webhooks rotate-secret <id> --yes` if you suspect a leak. The new secret is shown ONCE.
- **Respond fast.** Linear retries on non-200 or >5s. ACK within 200ms by responding `200 ok` immediately, then doing the work async.

## Activity types & lifecycle

| Type | Body | When to use |
|---|---|---|
| `thought` | text | Internal narration, including the mandatory 10s ack |
| `action` | `{action, parameter, result}` | Tool call summary (e.g. "ran `gh pr create`") |
| `elicitation` | text + `signal` (`select` / `auth`) | Ask the user (multi-choice or auth URL) |
| `response` | text | Final visible answer |
| `error` | text | Visible failure message |

The session is considered "stale" after 30 minutes of inactivity but is recoverable — emit any activity to revive.

## Troubleshooting

- **401 in your logs**: signature mismatch. Check `LINEAR_WEBHOOK_SECRET` matches what `linear webhooks list` shows.
- **No webhook delivered**: confirm `agentSessionEvent` is in the webhook's `resourceTypes`.
- **"Agent unresponsive" in Linear UI**: you took longer than 10s to emit a thought. Move the ack BEFORE any expensive work.

## See also

- Plugin CLI: `linear webhooks --help`, `linear agent-sessions --help`, `linear agent-activities --help`
- Linear's official agent docs: https://linear.app/developers/agents
- Linear's reference Cloudflare-Worker demo: https://github.com/linear/linear-agent-demo
