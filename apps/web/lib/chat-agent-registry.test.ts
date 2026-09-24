import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

let tempDir: string;

vi.mock("./workspace", () => ({
	resolveOpenClawStateDir: () => tempDir,
	resolveActiveAgentId: () => "main",
	getChatSlotAgentIds: () => ["chat-slot-main-1", "chat-slot-main-2", "chat-slot-main-3"],
}));

describe("chat-agent-registry", () => {
	beforeEach(() => {
		vi.resetModules();
		tempDir = mkdtempSync(join(tmpdir(), "chat-agent-test-"));

		vi.mock("./workspace", () => ({
			resolveOpenClawStateDir: () => tempDir,
			resolveActiveAgentId: () => "main",
			getChatSlotAgentIds: () => ["chat-slot-main-1", "chat-slot-main-2", "chat-slot-main-3"],
		}));

		const configPath = join(tempDir, "openclaw.json");
		writeFileSync(
			configPath,
			JSON.stringify({
				agents: {
					list: [
						{ id: "main", workspace: "/tmp/ws", default: true },
					],
				},
			}),
		);
	});

	afterEach(() => {
		vi.restoreAllMocks();
		try { rmSync(tempDir, { recursive: true, force: true }); } catch { /* ignore */ }
	});

	it("allocates a pool slot agent and writes registry", async () => {
		const { allocateChatAgent, getChatAgent } = await import("./chat-agent-registry.js");

		const entry = allocateChatAgent("session-1");
		expect(entry.chatAgentId).toBe("chat-slot-main-1");
		expect(entry.workspaceAgentId).toBe("main");
		expect(entry.state).toBe("active");
		expect(entry.sessionId).toBe("session-1");

		const stored = getChatAgent("session-1");
		expect(stored?.chatAgentId).toBe(entry.chatAgentId);
	});

	it("reuses existing slot on second allocate for same session", async () => {
		const { allocateChatAgent } = await import("./chat-agent-registry.js");

		const first = allocateChatAgent("session-2");
		const second = allocateChatAgent("session-2");
		expect(second.chatAgentId).toBe(first.chatAgentId);
		expect(second.state).toBe("active");
	});

	it("assigns different pool slots to concurrent sessions", async () => {
		const { allocateChatAgent } = await import("./chat-agent-registry.js");

		const a = allocateChatAgent("session-concurrent-a");
		const b = allocateChatAgent("session-concurrent-b");
		expect(a.chatAgentId).not.toBe(b.chatAgentId);
		expect(a.chatAgentId).toBe("chat-slot-main-1");
		expect(b.chatAgentId).toBe("chat-slot-main-2");
	});

	it("falls back to workspace agent when all slots are occupied", async () => {
		const { allocateChatAgent } = await import("./chat-agent-registry.js");

		allocateChatAgent("s-fill-1");
		allocateChatAgent("s-fill-2");
		allocateChatAgent("s-fill-3");
		const overflow = allocateChatAgent("s-fill-4");
		expect(overflow.chatAgentId).toBe("main");
	});

	it("marks agent idle and back to active on touch", async () => {
		const { allocateChatAgent, markChatAgentIdle, touchChatAgent, getChatAgent } =
			await import("./chat-agent-registry.js");

		allocateChatAgent("session-3");
		markChatAgentIdle("session-3");
		expect(getChatAgent("session-3")?.state).toBe("idle");

		touchChatAgent("session-3");
		expect(getChatAgent("session-3")?.state).toBe("active");
	});

	it("expires idle agents past TTL and releases the slot", async () => {
		const { allocateChatAgent, getChatAgent, expireIdleChatAgents } =
			await import("./chat-agent-registry.js");

		const entry = allocateChatAgent("session-4", { idleTtlMs: 1 });
		expect(entry.state).toBe("active");

		const registry = JSON.parse(readFileSync(join(tempDir, "chat-agents.json"), "utf-8"));
		registry.agents["session-4"].lastActiveAt = Date.now() - 1000;
		writeFileSync(join(tempDir, "chat-agents.json"), JSON.stringify(registry));

		const expired = expireIdleChatAgents();
		expect(expired).toContain("session-4");
		expect(getChatAgent("session-4")?.state).toBe("expired");
	});

	it("resumes expired agent transparently", async () => {
		const { allocateChatAgent, expireIdleChatAgents, resumeExpiredChatAgent, getChatAgent } =
			await import("./chat-agent-registry.js");

		allocateChatAgent("session-5", { idleTtlMs: 1 });

		const registry = JSON.parse(readFileSync(join(tempDir, "chat-agents.json"), "utf-8"));
		registry.agents["session-5"].lastActiveAt = Date.now() - 1000;
		writeFileSync(join(tempDir, "chat-agents.json"), JSON.stringify(registry));

		expireIdleChatAgents();
		expect(getChatAgent("session-5")?.state).toBe("expired");

		const resumed = resumeExpiredChatAgent("session-5");
		expect(resumed?.state).toBe("active");
		expect(resumed?.chatAgentId).toMatch(/^chat-/);
	});

	it("deletes agent and releases slot", async () => {
		const { allocateChatAgent, deleteChatAgent, getChatAgent } =
			await import("./chat-agent-registry.js");

		allocateChatAgent("session-6");
		deleteChatAgent("session-6");

		expect(getChatAgent("session-6")?.state).toBe("deleted");
	});

	it("purges deleted entries from registry", async () => {
		const { allocateChatAgent, deleteChatAgent, purgeChatAgentRegistry, getChatAgent } =
			await import("./chat-agent-registry.js");

		allocateChatAgent("session-7");
		deleteChatAgent("session-7");
		expect(getChatAgent("session-7")?.state).toBe("deleted");

		const purged = purgeChatAgentRegistry();
		expect(purged).toBe(1);
		expect(getChatAgent("session-7")).toBeUndefined();
	});

	it("ensureChatAgentForSend resumes expired agent", async () => {
		const { allocateChatAgent, expireIdleChatAgents, ensureChatAgentForSend } =
			await import("./chat-agent-registry.js");

		allocateChatAgent("session-8", { idleTtlMs: 1 });

		const registry = JSON.parse(readFileSync(join(tempDir, "chat-agents.json"), "utf-8"));
		registry.agents["session-8"].lastActiveAt = Date.now() - 1000;
		writeFileSync(join(tempDir, "chat-agents.json"), JSON.stringify(registry));

		expireIdleChatAgents();

		const agentId = ensureChatAgentForSend("session-8");
		expect(agentId).toMatch(/^chat-/);
	});

	it("ensureChatAgentForSend returns undefined for unknown session", async () => {
		const { ensureChatAgentForSend } = await import("./chat-agent-registry.js");
		expect(ensureChatAgentForSend("nonexistent")).toBeUndefined();
	});

	it("listChatAgents returns all entries", async () => {
		const { allocateChatAgent, listChatAgents } = await import("./chat-agent-registry.js");

		allocateChatAgent("session-a");
		allocateChatAgent("session-b");

		const all = listChatAgents();
		expect(all.length).toBe(2);
		expect(all.map((e) => e.sessionId).sort()).toEqual(["session-a", "session-b"]);
	});
});
