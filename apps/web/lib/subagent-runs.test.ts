import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("node:fs", () => ({
  existsSync: vi.fn(() => false),
  readFileSync: vi.fn(() => ""),
  readdirSync: vi.fn(() => []),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  appendFileSync: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  spawn: vi.fn(() => {
    const proc = {
      stdout: { on: vi.fn() },
      stderr: { on: vi.fn() },
      on: vi.fn(),
      kill: vi.fn(),
      unref: vi.fn(),
      pid: 12345,
    };
    return proc;
  }),
  execSync: vi.fn(() => ""),
  exec: vi.fn(
    (
      _cmd: string,
      _opts: unknown,
      cb: (err: Error | null, result: { stdout: string }) => void,
    ) => {
      cb(null, { stdout: "" });
    },
  ),
  execFile: vi.fn(
    (
      _cmd: string,
      _args: string[],
      _opts: unknown,
      cb: (err: Error | null, result: { stdout: string }) => void,
    ) => {
      cb(null, { stdout: "" });
    },
  ),
}));

vi.mock("node:os", () => ({
  homedir: vi.fn(() => "/home/testuser"),
}));

vi.mock("node:readline", () => ({
  createInterface: vi.fn(() => {
    const handlers: Record<string, ((...args: unknown[]) => void)[]> = {};
    const iface = {
      on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
        handlers[event] = handlers[event] || [];
        handlers[event].push(cb);
        return iface;
      }),
      close: vi.fn(),
      _emit: (event: string, ...args: unknown[]) => {
        for (const cb of handlers[event] || []) {
          cb(...args);
        }
      },
    };
    return iface;
  }),
}));

vi.mock("./agent-runner", () => ({
  spawnAgentSubscribeProcess: vi.fn(() => ({
    stdout: { on: vi.fn() },
    stderr: { on: vi.fn() },
    on: vi.fn(),
    once: vi.fn(),
    kill: vi.fn(),
    pid: 12345,
  })),
  callGatewayRpc: vi.fn(() => Promise.resolve({ ok: true })),
  extractToolResult: vi.fn((raw: unknown) => {
    if (!raw) {return undefined;}
    if (typeof raw === "string") {return { text: raw };}
    return { text: undefined, details: raw as Record<string, unknown> };
  }),
  buildToolOutput: vi.fn((result?: { text?: string }) =>
    result ? { text: result.text } : {},
  ),
  parseAgentErrorMessage: vi.fn((data?: Record<string, unknown>) => {
    if (data?.error && typeof data.error === "string") {return data.error;}
    if (data?.message && typeof data.message === "string") {return data.message;}
    return undefined;
  }),
  parseErrorBody: vi.fn((raw: string) => raw),
  parseErrorFromStderr: vi.fn((stderr: string) => {
    if (!stderr) {return undefined;}
    if (/error/i.test(stderr)) {return stderr.trim();}
    return undefined;
  }),
}));

import { appendFileSync } from "node:fs";

function createMockSubscribeProcess() {
  const handlers: Record<string, ((...args: unknown[]) => void)[]> = {};
  const proc = {
    stdout: { on: vi.fn() },
    stderr: { on: vi.fn() },
    on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
      handlers[event] = handlers[event] || [];
      handlers[event].push(cb);
      return proc;
    }),
    once: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
      handlers[event] = handlers[event] || [];
      handlers[event].push(cb);
      return proc;
    }),
    kill: vi.fn(),
    pid: 12345,
    _emit(event: string, ...args: unknown[]) {
      for (const cb of handlers[event] || []) {
        cb(...args);
      }
    },
  };
  return proc;
}

// Shared global key used by subagent-runs.ts for its singleton registry
const GLOBAL_KEY = "__openclaw_subagentRuns";

describe("subagent runs", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    process.env = { ...originalEnv };
    delete process.env.OPENCLAW_PROFILE;
    delete process.env.OPENCLAW_HOME;
    delete process.env.OPENCLAW_WORKSPACE;
    delete process.env.OPENCLAW_STATE_DIR;

    // Reset the global singleton between tests
    delete (globalThis as Record<string, unknown>)[GLOBAL_KEY];

    vi.mock("node:fs", () => ({
      existsSync: vi.fn(() => false),
      readFileSync: vi.fn(() => ""),
      readdirSync: vi.fn(() => []),
      writeFileSync: vi.fn(),
      mkdirSync: vi.fn(),
      appendFileSync: vi.fn(),
    }));
    vi.mock("node:child_process", () => ({
      spawn: vi.fn(() => {
        const proc = {
          stdout: { on: vi.fn() },
          stderr: { on: vi.fn() },
          on: vi.fn(),
          kill: vi.fn(),
          unref: vi.fn(),
          pid: 12345,
        };
        return proc;
      }),
      execSync: vi.fn(() => ""),
      exec: vi.fn(
        (
          _cmd: string,
          _opts: unknown,
          cb: (err: Error | null, result: { stdout: string }) => void,
        ) => {
          cb(null, { stdout: "" });
        },
      ),
      execFile: vi.fn(
        (
          _cmd: string,
          _args: string[],
          _opts: unknown,
          cb: (err: Error | null, result: { stdout: string }) => void,
        ) => {
          cb(null, { stdout: "" });
        },
      ),
    }));
    vi.mock("node:os", () => ({
      homedir: vi.fn(() => "/home/testuser"),
    }));
    vi.mock("node:readline", () => ({
      createInterface: vi.fn(() => {
        const handlers: Record<string, ((...args: unknown[]) => void)[]> = {};
        const iface = {
          on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
            handlers[event] = handlers[event] || [];
            handlers[event].push(cb);
            return iface;
          }),
          close: vi.fn(),
          _emit: (event: string, ...args: unknown[]) => {
            for (const cb of handlers[event] || []) {
              cb(...args);
            }
          },
        };
        return iface;
      }),
    }));
    vi.mock("./agent-runner", () => ({
      spawnAgentSubscribeProcess: vi.fn(() => ({
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        on: vi.fn(),
        once: vi.fn(),
        kill: vi.fn(),
        pid: 12345,
      })),
      callGatewayRpc: vi.fn(() => Promise.resolve({ ok: true })),
      extractToolResult: vi.fn((raw: unknown) => {
        if (!raw) {return undefined;}
        if (typeof raw === "string") {return { text: raw };}
        return { text: undefined, details: raw as Record<string, unknown> };
      }),
      buildToolOutput: vi.fn((result?: { text?: string }) =>
        result ? { text: result.text } : {},
      ),
      parseAgentErrorMessage: vi.fn((data?: Record<string, unknown>) => {
        if (data?.error && typeof data.error === "string") {return data.error;}
        if (data?.message && typeof data.message === "string") {return data.message;}
        return undefined;
      }),
      parseErrorBody: vi.fn((raw: string) => raw),
      parseErrorFromStderr: vi.fn((stderr: string) => {
        if (!stderr) {return undefined;}
        if (/error/i.test(stderr)) {return stderr.trim();}
        return undefined;
      }),
    }));
  });

  afterEach(() => {
    process.env = originalEnv;
    delete (globalThis as Record<string, unknown>)[GLOBAL_KEY];
  });

  async function importSubagentRuns() {
    return import("./subagent-runs.js");
  }

  // ─── registerSubagent ─────────────────────────────────────────────

  describe("registerSubagent", () => {
    it("registers a new subagent run", async () => {
      const { registerSubagent, hasActiveSubagent } =
        await importSubagentRuns();
      registerSubagent("parent-session-1", {
        sessionKey: "sub:parent:child1",
        runId: "run-123",
        task: "test task",
      });
      expect(hasActiveSubagent("sub:parent:child1")).toBe(true);
    });

    it("prevents duplicate registration", async () => {
      const { registerSubagent, getSubagentsForSession } =
        await importSubagentRuns();
      registerSubagent("parent-1", {
        sessionKey: "sub:p:c1",
        runId: "run-1",
        task: "task 1",
      });
      registerSubagent("parent-1", {
        sessionKey: "sub:p:c1",
        runId: "run-2",
        task: "task 2",
      });
      const subs = getSubagentsForSession("parent-1");
      expect(subs).toHaveLength(1);
      expect(subs[0].runId).toBe("run-1");
    });

    it("sets initial status to running", async () => {
      const { registerSubagent, getSubagentsForSession } =
        await importSubagentRuns();
      registerSubagent("parent-1", {
        sessionKey: "sub:p:c1",
        runId: "run-1",
        task: "task",
      });
      const subs = getSubagentsForSession("parent-1");
      expect(subs[0].status).toBe("running");
    });

    it("persists subagent info to index file", async () => {
      const { writeFileSync: wfs } = await import("node:fs");
      const mockWrite = vi.mocked(wfs);
      const { registerSubagent } = await importSubagentRuns();
      registerSubagent("parent-1", {
        sessionKey: "sub:p:c1",
        runId: "run-1",
        task: "my task",
        label: "my label",
      });
      const indexWrites = mockWrite.mock.calls.filter((c) =>
        (c[0] as string).includes("subagent-index.json"),
      );
      expect(indexWrites.length).toBeGreaterThan(0);
      const written = JSON.parse(indexWrites[indexWrites.length - 1][1] as string);
      expect(written["sub:p:c1"]).toBeDefined();
      expect(written["sub:p:c1"].task).toBe("my task");
    });

    it("stores label when provided", async () => {
      const { registerSubagent, getSubagentsForSession } =
        await importSubagentRuns();
      registerSubagent("parent-1", {
        sessionKey: "sub:p:c1",
        runId: "run-1",
        task: "task",
        label: "custom label",
      });
      const subs = getSubagentsForSession("parent-1");
      expect(subs[0].label).toBe("custom label");
    });
  });

  describe("subscribe restart stability", () => {
    it("applies exponential backoff and resets after a recovered stream event", async () => {
      vi.useFakeTimers();
      try {
        const { spawnAgentSubscribeProcess } = await import("./agent-runner.js");
        const { createInterface } = await import("node:readline");
        const mockSubscribeSpawn = vi.mocked(spawnAgentSubscribeProcess);
        mockSubscribeSpawn.mockReset();

        const first = createMockSubscribeProcess();
        const second = createMockSubscribeProcess();
        const third = createMockSubscribeProcess();
        const fourth = createMockSubscribeProcess();
        mockSubscribeSpawn
          .mockReturnValueOnce(first as never)
          .mockReturnValueOnce(second as never)
          .mockReturnValueOnce(third as never)
          .mockReturnValueOnce(fourth as never);

        const { registerSubagent } = await importSubagentRuns();
        registerSubagent("parent-stable", {
          sessionKey: "sub:stable:c1",
          runId: "run-stable",
          task: "retry stream",
        });
        expect(mockSubscribeSpawn).toHaveBeenCalledTimes(1);

        first._emit("close", 1);
        await vi.advanceTimersByTimeAsync(299);
        expect(mockSubscribeSpawn).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(1);
        expect(mockSubscribeSpawn).toHaveBeenCalledTimes(2);

        second._emit("close", 1);
        await vi.advanceTimersByTimeAsync(599);
        expect(mockSubscribeSpawn).toHaveBeenCalledTimes(2);
        await vi.advanceTimersByTimeAsync(1);
        expect(mockSubscribeSpawn).toHaveBeenCalledTimes(3);

        const createInterfaceMock = vi.mocked(createInterface);
        const thirdInterface = createInterfaceMock.mock.results.at(-1)
          ?.value as { _emit: (event: string, payload: string) => void };
        thirdInterface?._emit("line", JSON.stringify({
          event: "agent",
          sessionKey: "sub:stable:c1",
          stream: "assistant",
          data: { delta: "recovered" },
          globalSeq: 1,
        }));
        await vi.advanceTimersByTimeAsync(0);

        third._emit("close", 1);
        await vi.advanceTimersByTimeAsync(299);
        expect(mockSubscribeSpawn).toHaveBeenCalledTimes(3);
        await vi.advanceTimersByTimeAsync(1);
        expect(mockSubscribeSpawn).toHaveBeenCalledTimes(4);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("event parity safeguards", () => {
    it("emits tool input/output events from subscribed lines", async () => {
      const { createInterface } = await import("node:readline");
      const { registerSubagent, subscribeToSubagent } = await importSubagentRuns();

      registerSubagent("parent-tools", {
        sessionKey: "sub:tools:c1",
        runId: "run-tools",
        task: "tool parity",
      });

      const received: Array<Record<string, unknown>> = [];
      subscribeToSubagent(
        "sub:tools:c1",
        (event) => {
          if (event) {
            received.push(event as Record<string, unknown>);
          }
        },
        { replay: false },
      );

      const createInterfaceMock = vi.mocked(createInterface);
      const iface = createInterfaceMock.mock.results.at(-1)
        ?.value as { _emit: (event: string, payload: string) => void };

      iface._emit("line", JSON.stringify({
        event: "agent",
        sessionKey: "sub:tools:c1",
        stream: "tool",
        data: {
          phase: "start",
          toolCallId: "tc-tools-1",
          name: "bash",
          args: { command: "echo hello" },
        },
        globalSeq: 1,
      }));
      iface._emit("line", JSON.stringify({
        event: "agent",
        sessionKey: "sub:tools:c1",
        stream: "tool",
        data: {
          phase: "result",
          toolCallId: "tc-tools-1",
          result: { text: "hello" },
        },
        globalSeq: 2,
      }));

      expect(
        received.some(
          (e) =>
            e.type === "tool-input-start" &&
            e.toolCallId === "tc-tools-1",
        ),
      ).toBe(true);
      expect(
        received.some(
          (e) =>
            e.type === "tool-output-available" &&
            e.toolCallId === "tc-tools-1",
        ),
      ).toBe(true);
    });
  });

  // ─── getSubagentsForSession ───────────────────────────────────────

  describe("getSubagentsForSession", () => {
    it("returns empty array for unknown parent", async () => {
      const { getSubagentsForSession } = await importSubagentRuns();
      expect(getSubagentsForSession("unknown")).toEqual([]);
    });

    it("returns all subagents for a parent session", async () => {
      const { registerSubagent, getSubagentsForSession } =
        await importSubagentRuns();
      registerSubagent("parent-1", {
        sessionKey: "sub:p:c1",
        runId: "r1",
        task: "t1",
      });
      registerSubagent("parent-1", {
        sessionKey: "sub:p:c2",
        runId: "r2",
        task: "t2",
      });
      const subs = getSubagentsForSession("parent-1");
      expect(subs).toHaveLength(2);
    });

    it("does not return subagents from other parents", async () => {
      const { registerSubagent, getSubagentsForSession } =
        await importSubagentRuns();
      registerSubagent("parent-1", {
        sessionKey: "sub:p1:c1",
        runId: "r1",
        task: "t1",
      });
      registerSubagent("parent-2", {
        sessionKey: "sub:p2:c1",
        runId: "r2",
        task: "t2",
      });
      const subs1 = getSubagentsForSession("parent-1");
      const subs2 = getSubagentsForSession("parent-2");
      expect(subs1).toHaveLength(1);
      expect(subs1[0].sessionKey).toBe("sub:p1:c1");
      expect(subs2).toHaveLength(1);
      expect(subs2[0].sessionKey).toBe("sub:p2:c1");
    });
  });

  // ─── subscribeToSubagent ──────────────────────────────────────────

  describe("subscribeToSubagent", () => {
    it("returns null for unknown subagent", async () => {
      const { subscribeToSubagent } = await importSubagentRuns();
      const unsub = subscribeToSubagent("unknown-key", () => {});
      expect(unsub).toBeNull();
    });

    it("replays buffered events by default", async () => {
      const { registerSubagent, subscribeToSubagent } =
        await importSubagentRuns();
      registerSubagent("parent-1", {
        sessionKey: "sub:p:c1",
        runId: "r1",
        task: "t",
      });

      // Manually push events into the buffer by using persistUserMessage
      const { persistUserMessage } = await importSubagentRuns();
      persistUserMessage("sub:p:c1", { text: "hello" });

      const received: unknown[] = [];
      subscribeToSubagent("sub:p:c1", (event) => {
        if (event) {received.push(event);}
      });

      expect(received.length).toBeGreaterThanOrEqual(1);
      const userMsg = received.find(
        (e) => (e as Record<string, unknown>).type === "user-message",
      );
      expect(userMsg).toBeDefined();
    });

    it("skips replay when replay=false", async () => {
      const { registerSubagent, persistUserMessage, subscribeToSubagent } =
        await importSubagentRuns();
      registerSubagent("parent-1", {
        sessionKey: "sub:p:c1",
        runId: "r1",
        task: "t",
      });
      persistUserMessage("sub:p:c1", { text: "hello" });

      const received: unknown[] = [];
      subscribeToSubagent(
        "sub:p:c1",
        (event) => {
          if (event) {received.push(event);}
        },
        { replay: false },
      );

      expect(received).toHaveLength(0);
    });

    it("returns unsubscribe function", async () => {
      const { registerSubagent, subscribeToSubagent } =
        await importSubagentRuns();
      registerSubagent("parent-1", {
        sessionKey: "sub:p:c1",
        runId: "r1",
        task: "t",
      });
      const unsub = subscribeToSubagent("sub:p:c1", () => {});
      expect(typeof unsub).toBe("function");
    });
  });

  // ─── isSubagentRunning / hasActiveSubagent ────────────────────────

  describe("isSubagentRunning / hasActiveSubagent", () => {
    it("reports running after registration", async () => {
      const { registerSubagent, isSubagentRunning, hasActiveSubagent } =
        await importSubagentRuns();
      registerSubagent("p-1", {
        sessionKey: "sub:p:c1",
        runId: "r1",
        task: "t",
      });
      expect(isSubagentRunning("sub:p:c1")).toBe(true);
      expect(hasActiveSubagent("sub:p:c1")).toBe(true);
    });

    it("reports not running for unknown keys", async () => {
      const { isSubagentRunning, hasActiveSubagent } =
        await importSubagentRuns();
      expect(isSubagentRunning("unknown")).toBe(false);
      expect(hasActiveSubagent("unknown")).toBe(false);
    });
  });

  // ─── persistUserMessage ───────────────────────────────────────────

  describe("persistUserMessage", () => {
    it("appends user message event to buffer and disk", async () => {
      const mockAppend = vi.mocked(appendFileSync);
      const { registerSubagent, persistUserMessage } =
        await importSubagentRuns();
      registerSubagent("p-1", {
        sessionKey: "sub:p:c1",
        runId: "r1",
        task: "t",
      });
      const result = persistUserMessage("sub:p:c1", { text: "hello" });
      expect(result).toBe(true);

      const appendCalls = mockAppend.mock.calls.filter((c) =>
        (c[0] as string).includes("subagent-events"),
      );
      expect(appendCalls.length).toBeGreaterThan(0);
    });

    it("returns false for unknown subagent", async () => {
      const { persistUserMessage } = await importSubagentRuns();
      expect(persistUserMessage("unknown", { text: "hello" })).toBe(false);
    });

    it("fans out to subscribers", async () => {
      const {
        registerSubagent,
        subscribeToSubagent,
        persistUserMessage,
      } = await importSubagentRuns();
      registerSubagent("p-1", {
        sessionKey: "sub:p:c1",
        runId: "r1",
        task: "t",
      });

      const received: unknown[] = [];
      subscribeToSubagent(
        "sub:p:c1",
        (event) => {
          if (event) {received.push(event);}
        },
        { replay: false },
      );

      persistUserMessage("sub:p:c1", { text: "live msg" });
      const userMsg = received.find(
        (e) => (e as Record<string, unknown>).type === "user-message",
      );
      expect(userMsg).toBeDefined();
    });
  });

  // ─── getRunningSubagentKeys ───────────────────────────────────────

  describe("getRunningSubagentKeys", () => {
    it("returns keys of running subagents", async () => {
      const { registerSubagent, getRunningSubagentKeys } =
        await importSubagentRuns();
      registerSubagent("p-1", {
        sessionKey: "sub:p:c1",
        runId: "r1",
        task: "t1",
      });
      registerSubagent("p-1", {
        sessionKey: "sub:p:c2",
        runId: "r2",
        task: "t2",
      });
      const keys = getRunningSubagentKeys();
      expect(keys).toContain("sub:p:c1");
      expect(keys).toContain("sub:p:c2");
    });

    it("returns empty when no subagents registered", async () => {
      const { getRunningSubagentKeys } = await importSubagentRuns();
      expect(getRunningSubagentKeys()).toEqual([]);
    });
  });

  // ─── ensureRegisteredFromDisk ─────────────────────────────────────

  describe("ensureRegisteredFromDisk", () => {
    it("returns true if already registered in memory", async () => {
      const { registerSubagent, ensureRegisteredFromDisk } =
        await importSubagentRuns();
      registerSubagent("p-1", {
        sessionKey: "sub:p:c1",
        runId: "r1",
        task: "t",
      });
      expect(ensureRegisteredFromDisk("sub:p:c1", "p-1")).toBe(true);
    });

    it("registers from profile-scoped index file", async () => {
      const { readFileSync: rfs, existsSync: es } = await import("node:fs");
      vi.mocked(es).mockImplementation((p) => {
        const s = String(p);
        return s.includes("subagent-index.json");
      });
      vi.mocked(rfs).mockImplementation((p) => {
        const s = String(p);
        if (s.includes("subagent-index.json")) {
          return JSON.stringify({
            "sub:p:disk1": {
              runId: "r-disk",
              parentWebSessionId: "p-disk",
              task: "disk task",
              status: "completed",
              startedAt: 1000,
            },
          }) as never;
        }
        return "" as never;
      });

      const { ensureRegisteredFromDisk, hasActiveSubagent } =
        await importSubagentRuns();
      const result = ensureRegisteredFromDisk("sub:p:disk1", "p-disk");
      expect(result).toBe(true);
      expect(hasActiveSubagent("sub:p:disk1")).toBe(true);
    });

    it("returns false when not found anywhere", async () => {
      const { ensureRegisteredFromDisk } = await importSubagentRuns();
      expect(ensureRegisteredFromDisk("sub:nonexistent", "p-1")).toBe(false);
    });

    it("registers from shared gateway registry as fallback", async () => {
      const { readFileSync: rfs, existsSync: es } = await import("node:fs");
      vi.mocked(es).mockImplementation((p) => {
        const s = String(p);
        return s.includes("subagents/runs.json") || s.includes(".openclaw");
      });
      vi.mocked(rfs).mockImplementation((p) => {
        const s = String(p);
        if (s.includes("runs.json")) {
          return JSON.stringify({
            runs: {
              "run-gw": {
                childSessionKey: "sub:gw:c1",
                runId: "r-gw",
                task: "gateway task",
              },
            },
          }) as never;
        }
        if (s.includes("subagent-index.json")) {
          return "{}" as never;
        }
        return "" as never;
      });

      const { ensureRegisteredFromDisk, hasActiveSubagent } =
        await importSubagentRuns();
      const result = ensureRegisteredFromDisk("sub:gw:c1", "p-gw");
      expect(result).toBe(true);
      expect(hasActiveSubagent("sub:gw:c1")).toBe(true);
    });
  });

  // ─── abortSubagent ────────────────────────────────────────────────

  describe("abortSubagent", () => {
    it("returns false for unknown subagent", async () => {
      const { abortSubagent } = await importSubagentRuns();
      expect(abortSubagent("unknown")).toBe(false);
    });

    it("aborts known subagent via gateway RPC", async () => {
      const { callGatewayRpc } = await import("./agent-runner.js");
      const { registerSubagent, abortSubagent } = await importSubagentRuns();

      registerSubagent("parent-1", {
        sessionKey: "sub:p:c1",
        runId: "run-1",
        task: "task",
      });

      expect(abortSubagent("sub:p:c1")).toBe(true);
      expect(vi.mocked(callGatewayRpc)).toHaveBeenCalledWith(
        "chat.abort",
        { sessionKey: "sub:p:c1" },
        { timeoutMs: 4_000 },
      );
    });
  });

  describe("spawnSubagentMessage", () => {
    it("sends follow-up messages via gateway RPC", async () => {
      const { callGatewayRpc } = await import("./agent-runner.js");
      const { registerSubagent, spawnSubagentMessage } = await importSubagentRuns();

      registerSubagent("parent-1", {
        sessionKey: "sub:p:c1",
        runId: "run-1",
        task: "task",
      });

      expect(spawnSubagentMessage("sub:p:c1", "continue")).toBe(true);
      expect(vi.mocked(callGatewayRpc)).toHaveBeenCalledWith(
        "agent",
        expect.objectContaining({
          sessionKey: "sub:p:c1",
          message: "continue",
          channel: "webchat",
          lane: "subagent",
          deliver: false,
          timeout: 0,
        }),
        { timeoutMs: 10_000 },
      );
    });
  });
});
