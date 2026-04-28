import { describe, expect, it } from "vitest";
import { buildAgentMessage } from "./agent-message";
import type { TableSelectionContext } from "./table-selection";

describe("buildAgentMessage", () => {
	it("returns userText unchanged when no context is provided", () => {
		expect(buildAgentMessage({ userText: "hello" })).toBe("hello");
	});

	it("does not touch [Attached files: ...] already in userText", () => {
		// [Attached files: ...] stays in the message text (chat-message.tsx
		// parses it for the AttachedFilesCard); buildAgentMessage only
		// layers agent-only prefixes on top.
		expect(
			buildAgentMessage({
				userText: "[Attached files: a.md]\n\nsummarize",
			}),
		).toBe("[Attached files: a.md]\n\nsummarize");
	});

	it("prepends [Context: workspace file '...'] when filePath is provided", () => {
		expect(
			buildAgentMessage({
				userText: "what is this?",
				workspaceContext: { filePath: "doc.md", isDirectory: false },
			}),
		).toBe("[Context: workspace file 'doc.md']\n\nwhat is this?");
	});

	it("uses 'directory' label for directory contexts", () => {
		expect(
			buildAgentMessage({
				userText: "list everyone",
				workspaceContext: { filePath: "~crm/people", isDirectory: true },
			}),
		).toBe(
			"[Context: workspace directory '~crm/people']\n\nlist everyone",
		);
	});

	it("applies the workspace prefix to file context paths", () => {
		expect(
			buildAgentMessage({
				userText: "ok",
				workspaceContext: { filePath: "doc.md", isDirectory: false },
				workspacePrefix: "/home/user/.openclaw/work",
			}),
		).toBe(
			"[Context: workspace file '/home/user/.openclaw/work/doc.md']\n\nok",
		);
	});

	it("does NOT apply the workspace prefix to directory context paths", () => {
		// The legacy server regex only matched `workspace file '...'`, so
		// directory paths (especially virtual surfaces like `~crm/people`)
		// were always passed through unprefixed. Prefixing them would
		// produce nonsensical paths like `<workspaceRoot>/~crm/people`.
		expect(
			buildAgentMessage({
				userText: "list",
				workspaceContext: { filePath: "~crm/people", isDirectory: true },
				workspacePrefix: "/home/user/.openclaw/work",
			}),
		).toBe("[Context: workspace directory '~crm/people']\n\nlist");

		expect(
			buildAgentMessage({
				userText: "list",
				workspaceContext: { filePath: "subdir", isDirectory: true },
				workspacePrefix: "/home/user/.openclaw/work",
			}),
		).toBe("[Context: workspace directory 'subdir']\n\nlist");
	});

	it("prepends a [Selected table ...] block when tableSelection is provided", () => {
		const selection: TableSelectionContext = {
			objectName: "people",
			kind: "rows",
			rowCount: 1,
			columnCount: 2,
			columns: ["name", "email"],
			rows: [
				{
					rowIndex: 0,
					entryId: "p1",
					values: { name: "Ada", email: "ada@example.com" },
				},
			],
			updatedAt: 0,
		};
		const out = buildAgentMessage({
			userText: "anything weird?",
			workspaceContext: { tableSelection: selection },
		});
		expect(out).toContain("[Selected table rows: people]");
		expect(out).toContain("anything weird?");
	});

	it("orders prefixes: tableSelection > filePath > attachedFiles in userText", () => {
		const selection: TableSelectionContext = {
			objectName: "people",
			kind: "cells",
			rowCount: 1,
			columnCount: 1,
			columns: ["email"],
			cells: [
				{ rowIndex: 0, entryId: "p1", fieldName: "email", value: "x" },
			],
			updatedAt: 0,
		};
		// userText carries the attachments prefix that the client builds
		// inline; buildAgentMessage layers Context + Selected table on top.
		const out = buildAgentMessage({
			userText: "[Attached files: a.md]\n\ngo",
			workspaceContext: {
				filePath: "doc.md",
				isDirectory: false,
				tableSelection: selection,
			},
		});

		const tableIdx = out.indexOf("[Selected table");
		const ctxIdx = out.indexOf("[Context: workspace");
		const attIdx = out.indexOf("[Attached files:");
		const goIdx = out.indexOf("go");

		expect(tableIdx).toBeGreaterThanOrEqual(0);
		expect(tableIdx).toBeLessThan(ctxIdx);
		expect(ctxIdx).toBeLessThan(attIdx);
		expect(attIdx).toBeLessThan(goIdx);
	});
});
