import { describe, expect, it } from "vitest";

import { _internal, buildSnapshot } from "../../src/curator/snapshot.js";
import type { BulkIssueNode } from "../../src/lib/bulk-graphql.js";

function issue(id: string, overrides: Partial<BulkIssueNode> = {}): BulkIssueNode {
	return {
		identifier: id,
		title: `Title for ${id}`,
		description: "A description",
		priority: 0,
		state: { id: "s1", name: "Todo", type: "unstarted" },
		assignee: { id: "u1", name: "Alice" },
		team: { id: "t1", key: id.split("-")[0], name: "Engineering" },
		project: { id: "p1", name: "Proj" },
		labels: { nodes: [] },
		parent: null,
		children: { nodes: [] },
		relations: { nodes: [] },
		url: `https://linear.app/${id}`,
		updatedAt: "2026-05-15",
		createdAt: "2026-05-01",
		...overrides,
	};
}

describe("buildSnapshot", () => {
	it("renders issue blocks with state/assignee/project + signals grouped by issueIdentifier", () => {
		const snap = buildSnapshot({
			issues: [issue("ENG-1"), issue("ENG-2")],
			signals: [
				{
					source: "gh",
					type: "github_commits",
					issueIdentifier: "ENG-1",
					payload: { sha: "abc" },
					receivedAt: "2026-05-15",
				},
				{ source: "gh", type: "github_commits", payload: { sha: "def" }, receivedAt: "2026-05-15" },
			],
			pendingQuestions: [],
		});
		expect(snap).toContain("### ENG-1");
		expect(snap).toContain("### ENG-2");
		expect(snap).toContain("[gh/github_commits]");
		// Unattributed signal should land in its own section
		expect(snap).toContain("## Unattributed signals");
	});

	it("formats pending questions when present", () => {
		const snap = buildSnapshot({
			issues: [],
			signals: [],
			pendingQuestions: [{ issue_id: "ENG-5", thread_key: "k", posted_at: "2026-05-14", question_text: "Done?" }],
		});
		expect(snap).toContain("ENG-5 [k] posted 2026-05-14: Done?");
	});

	it("renders (none) when no pending questions", () => {
		const snap = buildSnapshot({ issues: [], signals: [], pendingQuestions: [] });
		expect(snap).toContain("(none)");
	});

	it("uses the bundled tiering rules when explicit path is missing", () => {
		const snap = buildSnapshot({ issues: [], signals: [], pendingQuestions: [], tieringRulesPath: "/nope" });
		expect(snap).toContain("Tiering Rules");
	});
});

describe("_internal.groupSignals", () => {
	it("groups signals by issueIdentifier with unattributed bucket", () => {
		const grouped = _internal.groupSignals([
			{ source: "s", type: "t", issueIdentifier: "ENG-1", payload: {}, receivedAt: "x" },
			{ source: "s", type: "t", payload: {}, receivedAt: "x" },
		]);
		expect(grouped.get("ENG-1")?.length).toBe(1);
		expect(grouped.get("_unattributed")?.length).toBe(1);
	});
});
