/**
 * Reference webhook receiver for Linear's agent framework.
 *
 * This is a TEMPLATE — it ships with the plugin so operators can run their
 * own agent receiver wherever they want (Cloudflare Worker, Vercel function,
 * Fly machine, etc.). The plugin itself is a CLI; it does not host this
 * server for you.
 *
 *   1. Register a webhook in Linear pointing at this server's URL:
 *        linear webhooks create \
 *          --url https://your-host/linear/webhook \
 *          --resource-types AgentSessionEvent \
 *          --all-public-teams
 *      (Linear will return a signing secret — store as LINEAR_WEBHOOK_SECRET.)
 *
 *   2. Run this server with both env vars set:
 *        LINEAR_API_KEY=lin_api_... \
 *        LINEAR_WEBHOOK_SECRET=lin_wh_... \
 *        node server.example.js
 *
 *   3. Linear delivers `agentSessionEvent` POSTs to /linear/webhook. We
 *      verify the signature, then must emit a `thought` activity within
 *      10 seconds to acknowledge.
 *
 * The activity-create call shells out to the plugin's CLI so you don't end
 * up with two implementations. The signature verifier is inlined below so
 * this file works after `cp -r` out of the plugin tree — no relative
 * imports back into the plugin source.
 */

import http from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHmac, timingSafeEqual } from "node:crypto";

const execFileAsync = promisify(execFile);

/**
 * Verify a Linear webhook payload's HMAC-SHA256 signature AND its replay
 * window. Mirrors the implementation in the plugin's webhook-verify util —
 * kept inline so this template stands alone after copy.
 *
 * Replay protection: when `timestamp` (the `webhookTimestamp` field from the
 * parsed body, Unix ms) is provided, payloads older than `maxAgeMs` are
 * rejected. Without this, an attacker who captures a valid signed request
 * can replay it forever.
 */
// Linear recommends 60 s — see https://linear.app/developers/webhooks
const DEFAULT_WEBHOOK_MAX_AGE_MS = 60 * 1000;

function verifyLinearWebhook(opts: {
  rawBody: string | Buffer;
  signature: string;
  secret: string;
  timestamp?: number;
  maxAgeMs?: number;
}): boolean {
  if (!opts.signature || !opts.secret) return false;
  const body = typeof opts.rawBody === "string" ? Buffer.from(opts.rawBody, "utf-8") : opts.rawBody;
  const expectedHex = createHmac("sha256", opts.secret).update(body).digest("hex");
  const expected = Buffer.from(expectedHex, "hex");
  let received: Buffer;
  try {
    received = Buffer.from(opts.signature, "hex");
  } catch {
    return false;
  }
  if (received.length !== expected.length) return false;
  if (!timingSafeEqual(received, expected)) return false;

  if (typeof opts.timestamp === "number") {
    if (!Number.isFinite(opts.timestamp)) return false;
    const maxAgeMs = opts.maxAgeMs ?? DEFAULT_WEBHOOK_MAX_AGE_MS;
    if (Math.abs(Date.now() - opts.timestamp) > maxAgeMs) return false;
  }
  return true;
}

const PORT = Number(process.env.PORT ?? 8787);
const SECRET = process.env.LINEAR_WEBHOOK_SECRET;
const CLI_PATH = process.env.LINEAR_CLI_PATH ?? "../../cli/bin/linear.js";

if (!SECRET) {
  console.error("LINEAR_WEBHOOK_SECRET not set — refusing to start.");
  process.exit(1);
}
if (!process.env.LINEAR_API_KEY) {
  console.error("LINEAR_API_KEY not set — refusing to start.");
  process.exit(1);
}

interface AgentSessionEvent {
  type: "AgentSessionEvent";
  action: "created" | "prompted";
  agentSession?: { id: string; type?: string };
  promptContext?: string;
}

async function readBody(req: http.IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

/** Emit a thought activity via the CLI (one process per call — fine for ack). */
async function emitThought(sessionId: string, body: string): Promise<void> {
  await execFileAsync("node", [
    CLI_PATH,
    "agent-activities", "create", sessionId,
    "--type", "thought",
    "--body", body,
  ]);
}

const server = http.createServer(async (req, res) => {
  if (req.method !== "POST" || req.url !== "/linear/webhook") {
    res.writeHead(404);
    res.end();
    return;
  }
  const signature = req.headers["linear-signature"];
  if (typeof signature !== "string") {
    res.writeHead(400);
    res.end("Missing linear-signature header");
    return;
  }
  const rawBody = await readBody(req);
  // HMAC-verify on the raw bytes BEFORE touching JSON.parse — never let
  // unverified input reach the parser. Replay-window check happens after,
  // once we trust the body enough to read webhookTimestamp out of it.
  if (!verifyLinearWebhook({ rawBody, signature, secret: SECRET })) {
    res.writeHead(401);
    res.end("Invalid signature");
    return;
  }
  let parsedForTimestamp: { webhookTimestamp?: number } = {};
  try {
    parsedForTimestamp = JSON.parse(rawBody.toString("utf-8"));
  } catch {
    res.writeHead(400);
    res.end("Body is not valid JSON");
    return;
  }
  const timestamp = parsedForTimestamp.webhookTimestamp;
  if (typeof timestamp !== "number" || !Number.isFinite(timestamp)) {
    res.writeHead(401);
    res.end("Missing or invalid webhookTimestamp");
    return;
  }
  if (Math.abs(Date.now() - timestamp) > DEFAULT_WEBHOOK_MAX_AGE_MS) {
    res.writeHead(401);
    res.end("Expired payload");
    return;
  }
  // ACK Linear within 5s — non-200 triggers a retry and counts against agent
  // responsiveness. Do work async after responding.
  res.writeHead(200);
  res.end("ok");

  const payload = JSON.parse(rawBody.toString("utf-8")) as AgentSessionEvent;
  if (payload.type !== "AgentSessionEvent") return;
  if (payload.action !== "created") return;
  const sessionId = payload.agentSession?.id;
  if (!sessionId) return;

  // Linear requires a thought within 10s — emit immediately then start work.
  try {
    await emitThought(sessionId, "Got it — picking this up now.");
  } catch (e) {
    console.error("Failed to emit ack thought:", e);
    return;
  }

  // TODO: kick off whatever the agent actually does. Examples:
  //  - Run /linear-work as a subprocess (background coding agent)
  //  - Trigger your own task queue
  //  - Update the issue with progress via `linear issues update`
  console.log(`[agent] session ${sessionId} acknowledged`);
});

server.listen(PORT, () => {
  console.log(`Linear agent webhook receiver listening on :${PORT}/linear/webhook`);
});
