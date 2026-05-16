// Mapping from Linear's project status `type` to a sensible default issue
// state for new issues filed in that project. Used by `projects get` and
// `context` so agents don't have to encode this mapping themselves.
//
// Conservative: paused/completed/canceled return null with a warning so the
// agent flags it instead of silently dropping the issue into a closed project.

export interface RecommendedState {
	state: string | null;
	warning?: string;
}

export function recommendedStateForStatus(type: string | null | undefined): RecommendedState {
	switch (type) {
		case "backlog":
			return { state: "Backlog" };
		case "planned":
		case "started":
			return { state: "Todo" };
		case "paused":
			return {
				state: null,
				warning: "project is paused; confirm with the project lead before filing",
			};
		case "completed":
			return {
				state: null,
				warning: "project is completed; pick a different project for new work",
			};
		case "canceled":
			return {
				state: null,
				warning: "project is canceled; pick a different project for new work",
			};
		default:
			return { state: null };
	}
}
