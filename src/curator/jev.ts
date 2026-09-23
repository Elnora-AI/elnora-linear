// TypeSafe Jev client: one choice question over fixed labels, answered with a
// calibrated probability per label. Called through OpenRouter.

const JEV_URL = "https://openrouter.ai/api/v1/systemone";
const JEV_MODEL = "~typesafe/jev-latest";
const JEV_TIMEOUT_MS = 20_000;

export interface JevAnswer {
	choice: string;
	confidence: number;
	/** The Jev version that answered, e.g. typesafe/jev-1.13-20260917. */
	model: string;
}

function isProbability(x: unknown): x is number {
	return typeof x === "number" && Number.isFinite(x) && x >= 0 && x <= 1;
}

/** Validate a Jev response body against the criteria that were asked. Throws on anything off. */
export function validateJevAnswer(data: unknown, criteria: Record<string, string>): JevAnswer {
	const body = data as { model?: unknown; answers?: { q?: Record<string, unknown> } } | null;
	const q = body?.answers?.q;
	if (typeof body?.model !== "string" || typeof q !== "object" || q === null) {
		throw new Error("Malformed Jev response");
	}
	const { choice, confidence, probabilities } = q as {
		choice?: unknown;
		confidence?: unknown;
		probabilities?: unknown;
	};
	if (typeof choice !== "string" || !Object.hasOwn(criteria, choice)) {
		throw new Error(`Jev chose a label outside the criteria: ${String(choice)}`);
	}
	if (!isProbability(confidence)) {
		throw new Error("Jev confidence is not a probability");
	}
	if (typeof probabilities !== "object" || probabilities === null) {
		throw new Error("Jev probabilities missing");
	}
	const probs = probabilities as Record<string, unknown>;
	if (!Object.values(probs).every(isProbability)) {
		throw new Error("Jev probabilities are not all probabilities");
	}
	const chosen = probs[choice];
	if (!isProbability(chosen) || Math.abs(chosen - confidence) > 0.1) {
		throw new Error("Jev confidence disagrees with its probabilities");
	}
	return { choice, confidence, model: body.model };
}

export async function jevChoice(
	state: string,
	instructions: string,
	criteria: Record<string, string>,
): Promise<JevAnswer> {
	const apiKey = process.env.OPENROUTER_API_KEY;
	if (!apiKey) throw new Error("OPENROUTER_API_KEY not set");
	const res = await fetch(JEV_URL, {
		method: "POST",
		headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
		body: JSON.stringify({
			model: JEV_MODEL,
			state,
			questions: { q: { type: "choice", instructions, criteria } },
		}),
		signal: AbortSignal.timeout(JEV_TIMEOUT_MS),
	});
	if (!res.ok) throw new Error(`Jev returned HTTP ${res.status}`);
	return validateJevAnswer(await res.json(), criteria);
}
