import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Dirent } from "node:fs";

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  const existsSync = vi.fn(() => false);
  const readFileSync = vi.fn(() => "");
  const readdirSync = vi.fn(() => []);
  const writeFileSync = vi.fn();
  const mkdirSync = vi.fn();
  const renameSync = vi.fn();
  return {
    ...actual,
    existsSync,
    readFileSync,
    readdirSync,
    writeFileSync,
    mkdirSync,
    renameSync,
    default: {
      ...actual,
      existsSync,
      readFileSync,
      readdirSync,
      writeFileSync,
      mkdirSync,
      renameSync,
    },
  };
});

vi.mock("node:child_process", () => ({
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
  spawn: vi.fn(() => ({
    on: vi.fn(),
    stdout: { on: vi.fn() },
    stderr: { on: vi.fn() },
  })),
}));

vi.mock("node:os", () => ({
  homedir: vi.fn(() => "/home/testuser"),
}));

import { join } from "node:path";

function makeDirent(name: string, isDir: boolean): Dirent {
  return {
    name,
    isDirectory: () => isDir,
    isFile: () => !isDir,
    isBlockDevice: () => false,
    isCharacterDevice: () => false,
    isFIFO: () => false,
    isSocket: () => false,
    isSymbolicLink: () => false,
    path: "",
    parentPath: "",
  } as Dirent;
}

describe("workspace (flat workspace model)", () => {
  const originalEnv = { ...process.env };
  const STATE_DIR = "/home/testuser/.openclaw-dench";
  const UI_STATE_PATH = join(STATE_DIR, ".dench-ui-state.json");

  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    process.env = { ...originalEnv };
    delete process.env.OPENCLAW_PROFILE;
    delete process.env.OPENCLAW_HOME;
    delete process.env.OPENCLAW_WORKSPACE;
    delete process.env.OPENCLAW_STATE_DIR;

    vi.mock("node:fs", async (importOriginal) => {
      const actual = await importOriginal<typeof import("node:fs")>();
      const existsSync = vi.fn(() => false);
      const readFileSync = vi.fn(() => "");
      const readdirSync = vi.fn(() => []);
      const writeFileSync = vi.fn();
      const mkdirSync = vi.fn();
      const renameSync = vi.fn();
      return {
        ...actual,
        existsSync,
        readFileSync,
        readdirSync,
        writeFileSync,
        mkdirSync,
        renameSync,
        default: {
          ...actual,
          existsSync,
          readFileSync,
          readdirSync,
          writeFileSync,
          mkdirSync,
          renameSync,
        },
      };
    });
    vi.mock("node:child_process", () => ({
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
      spawn: vi.fn(() => ({
        on: vi.fn(),
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
      })),
    }));
    vi.mock("node:os", () => ({
      homedir: vi.fn(() => "/home/testuser"),
    }));
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  async function importWorkspace() {
    const {
      existsSync: es,
      readFileSync: rfs,
      readdirSync: rds,
      writeFileSync: wfs,
      renameSync: rs,
    } = await import("node:fs");
    const mod = await import("./workspace.js");
    return {
      ...mod,
      mockExists: vi.mocked(es),
      mockReadFile: vi.mocked(rfs),
      mockReaddir: vi.mocked(rds),
      mockWriteFile: vi.mocked(wfs),
      mockRename: vi.mocked(rs),
    };
  }

  // ─── getEffectiveProfile ──────────────────────────────────────────

  describe("getEffectiveProfile", () => {
    it("always returns 'dench' regardless of env/state (single profile enforcement)", async () => {
      process.env.OPENCLAW_PROFILE = "work";
      const { getEffectiveProfile, setUIActiveProfile, mockReadFile } =
        await importWorkspace();
      mockReadFile.mockReturnValue(
        JSON.stringify({ activeWorkspace: "something" }) as never,
      );
      setUIActiveProfile("custom");
      expect(getEffectiveProfile()).toBe("dench");
    });
  });

  describe("isValidWorkspaceName", () => {
    it("rejects reserved workspace names that collide with managed agent routing", async () => {
      const { isValidWorkspaceName } = await importWorkspace();
      expect(isValidWorkspaceName("main")).toBe(false);
      expect(isValidWorkspaceName("default")).toBe(false);
      expect(isValidWorkspaceName("chat-slot-main-1")).toBe(false);
      expect(isValidWorkspaceName("work")).toBe(true);
    });
  });

  // ─── getActiveWorkspaceName ───────────────────────────────────────

  describe("getActiveWorkspaceName", () => {
    it("returns null when nothing is set and no workspace dirs exist", async () => {
      const { getActiveWorkspaceName, mockReadFile } = await importWorkspace();
      mockReadFile.mockImplementation(() => {
        throw new Error("ENOENT");
      });
      expect(getActiveWorkspaceName()).toBeNull();
    });

    it("returns persisted workspace from state file", async () => {
      const { getActiveWorkspaceName, mockReadFile, mockReaddir } =
        await importWorkspace();
      mockReaddir.mockReturnValue([
        makeDirent("workspace-dev", true),
      ] as unknown as Dirent[]);
      mockReadFile.mockReturnValue(
        JSON.stringify({ activeWorkspace: "dev" }) as never,
      );
      expect(getActiveWorkspaceName()).toBe("dev");
    });

    it("in-memory override takes precedence over persisted file", async () => {
      const {
        getActiveWorkspaceName,
        setUIActiveWorkspace,
        mockReadFile,
        mockReaddir,
      } = await importWorkspace();
      mockReaddir.mockReturnValue([
        makeDirent("workspace-memory-ws", true),
        makeDirent("workspace-file-ws", true),
      ] as unknown as Dirent[]);
      mockReadFile.mockReturnValue(
        JSON.stringify({ activeWorkspace: "file-ws" }) as never,
      );
      setUIActiveWorkspace("memory-ws");
      expect(getActiveWorkspaceName()).toBe("memory-ws");
    });

    it("falls back to first discovered workspace when nothing is set", async () => {
      const { getActiveWorkspaceName, mockReadFile, mockReaddir } =
        await importWorkspace();
      mockReadFile.mockImplementation(() => {
        throw new Error("ENOENT");
      });
      mockReaddir.mockReturnValue([
        makeDirent("workspace-beta", true),
        makeDirent("workspace-alpha", true),
        makeDirent("unrelated-dir", true),
      ] as unknown as Dirent[]);
      // scanWorkspaceNames sorts alphabetically, so "alpha" comes first
      expect(getActiveWorkspaceName()).toBe("alpha");
    });

    it("OPENCLAW_WORKSPACE env pointing to workspace-<name> dir under state dir takes priority", async () => {
      process.env.OPENCLAW_WORKSPACE = join(STATE_DIR, "workspace-envws");
      const {
        getActiveWorkspaceName,
        setUIActiveWorkspace,
        mockReadFile,
        mockReaddir,
      } = await importWorkspace();
      mockReaddir.mockReturnValue([
        makeDirent("workspace-envws", true),
        makeDirent("workspace-memory", true),
      ] as unknown as Dirent[]);
      mockReadFile.mockReturnValue(
        JSON.stringify({ activeWorkspace: "persisted" }) as never,
      );
      setUIActiveWorkspace("memory");
      expect(getActiveWorkspaceName()).toBe("envws");
    });

    it("OPENCLAW_WORKSPACE env pointing to root workspace dir resolves to default", async () => {
      process.env.OPENCLAW_WORKSPACE = join(STATE_DIR, "workspace");
      const {
        getActiveWorkspaceName,
        setUIActiveWorkspace,
        mockReadFile,
        mockReaddir,
      } = await importWorkspace();
      mockReaddir.mockReturnValue([
        makeDirent("workspace", true),
        makeDirent("workspace-memory", true),
      ] as unknown as Dirent[]);
      mockReadFile.mockReturnValue(
        JSON.stringify({ activeWorkspace: "persisted" }) as never,
      );
      setUIActiveWorkspace("memory");
      expect(getActiveWorkspaceName()).toBe("default");
    });
  });

  // ─── setUIActiveWorkspace ─────────────────────────────────────────

  describe("setUIActiveWorkspace", () => {
    it("persists workspace name to state file with activeWorkspace key", async () => {
      const { setUIActiveWorkspace, mockReadFile, mockWriteFile, mockExists } =
        await importWorkspace();
      mockReadFile.mockReturnValue(JSON.stringify({}) as never);
      mockExists.mockReturnValue(true);
      setUIActiveWorkspace("dev");
      expect(mockWriteFile).toHaveBeenCalledWith(
        UI_STATE_PATH,
        expect.stringContaining('"activeWorkspace": "dev"'),
      );
    });

    it("null clears the override", async () => {
      const { setUIActiveWorkspace, mockReadFile, mockWriteFile, mockExists } =
        await importWorkspace();
      mockReadFile.mockReturnValue(JSON.stringify({}) as never);
      mockExists.mockReturnValue(true);
      setUIActiveWorkspace(null);
      expect(mockWriteFile).toHaveBeenCalledWith(
        UI_STATE_PATH,
        expect.stringContaining('"activeWorkspace": null'),
      );
    });
  });

  // ─── clearUIActiveWorkspaceCache ──────────────────────────────────

  describe("clearUIActiveWorkspaceCache", () => {
    it("re-reads from file after clearing in-memory override", async () => {
      const {
        getActiveWorkspaceName,
        setUIActiveWorkspace,
        clearUIActiveWorkspaceCache,
        mockReadFile,
        mockReaddir,
      } = await importWorkspace();
      mockReaddir.mockReturnValue([
        makeDirent("workspace-in-memory", true),
        makeDirent("workspace-from-file", true),
      ] as unknown as Dirent[]);

      mockReadFile.mockReturnValue(
        JSON.stringify({ activeWorkspace: "from-file" }) as never,
      );
      setUIActiveWorkspace("in-memory");
      expect(getActiveWorkspaceName()).toBe("in-memory");

      clearUIActiveWorkspaceCache();
      expect(getActiveWorkspaceName()).toBe("from-file");
    });
  });

  // ─── discoverWorkspaces ───────────────────────────────────────────

  describe("discoverWorkspaces", () => {
    it("returns empty array when state dir has no workspace-* dirs", async () => {
      const { discoverWorkspaces, mockReadFile, mockReaddir } =
        await importWorkspace();
      mockReadFile.mockImplementation(() => {
        throw new Error("ENOENT");
      });
      mockReaddir.mockReturnValue([] as unknown as Dirent[]);
      const workspaces = discoverWorkspaces();
      expect(workspaces).toHaveLength(0);
    });

    it("discovers workspace-<name> directories under state dir", async () => {
      const { discoverWorkspaces, mockReaddir, mockExists, mockReadFile } =
        await importWorkspace();
      mockReadFile.mockImplementation(() => {
        throw new Error("ENOENT");
      });
      mockReaddir.mockReturnValue([
        makeDirent("workspace-alpha", true),
        makeDirent("workspace-beta", true),
        makeDirent("some-other-dir", true),
        makeDirent("config.json", false),
      ] as unknown as Dirent[]);
      mockExists.mockImplementation((p) => {
        const s = String(p);
        return (
          s === join(STATE_DIR, "workspace-alpha") ||
          s === join(STATE_DIR, "workspace-beta")
        );
      });

      const workspaces = discoverWorkspaces();
      const names = workspaces.map((w) => w.name);
      expect(names).toContain("alpha");
      expect(names).toContain("beta");
      expect(names).not.toContain("some-other-dir");
      expect(names).not.toContain("config.json");
    });

    it("discovers root workspace dir as default", async () => {
      const { discoverWorkspaces, mockReaddir, mockExists, mockReadFile } =
        await importWorkspace();
      mockReadFile.mockImplementation(() => {
        throw new Error("ENOENT");
      });
      mockReaddir.mockReturnValue([
        makeDirent("workspace", true),
      ] as unknown as Dirent[]);
      mockExists.mockImplementation((p) => String(p) === join(STATE_DIR, "workspace"));

      const workspaces = discoverWorkspaces();
      expect(workspaces).toHaveLength(1);
      expect(workspaces[0]?.name).toBe("default");
      expect(workspaces[0]?.workspaceDir).toBe(join(STATE_DIR, "workspace"));
      expect(workspaces[0]?.isActive).toBe(true);
    });

    it("ignores internal workspace directories for main/chat-slot agent ids", async () => {
      const { discoverWorkspaces, mockReaddir, mockExists, mockReadFile } =
        await importWorkspace();
      mockReadFile.mockImplementation(() => {
        throw new Error("ENOENT");
      });
      mockReaddir.mockReturnValue([
        makeDirent("workspace", true),
        makeDirent("workspace-main", true),
        makeDirent("workspace-chat-slot-main-1", true),
      ] as unknown as Dirent[]);
      mockExists.mockImplementation((p) => {
        const s = String(p);
        return (
          s === join(STATE_DIR, "workspace") ||
          s === join(STATE_DIR, "workspace-main") ||
          s === join(STATE_DIR, "workspace-chat-slot-main-1")
        );
      });

      const workspaces = discoverWorkspaces();
      expect(workspaces.map((workspace) => workspace.name)).toEqual(["default"]);
    });

    it("keeps root default and workspace-dench as distinct workspaces", async () => {
      const { discoverWorkspaces, mockReaddir, mockExists, mockReadFile } =
        await importWorkspace();
      mockReadFile.mockImplementation(() => {
        throw new Error("ENOENT");
      });
      mockReaddir.mockReturnValue([
        makeDirent("workspace", true),
        makeDirent("workspace-dench", true),
      ] as unknown as Dirent[]);
      mockExists.mockImplementation((p) => {
        const s = String(p);
        return s === join(STATE_DIR, "workspace") || s === join(STATE_DIR, "workspace-dench");
      });

      const workspaces = discoverWorkspaces();
      expect(workspaces).toHaveLength(2);
      const names = workspaces.map((workspace) => workspace.name);
      expect(names).toContain("default");
      expect(names).toContain("dench");
      const rootDefault = workspaces.find((workspace) => workspace.name === "default");
      const profileDench = workspaces.find((workspace) => workspace.name === "dench");
      expect(rootDefault?.workspaceDir).toBe(join(STATE_DIR, "workspace"));
      expect(profileDench?.workspaceDir).toBe(join(STATE_DIR, "workspace-dench"));
    });

    it("lists default, dench, and custom workspace side by side", async () => {
      const { discoverWorkspaces, mockReaddir, mockExists, mockReadFile } =
        await importWorkspace();
      mockReadFile.mockImplementation(() => {
        throw new Error("ENOENT");
      });
      mockReaddir.mockReturnValue([
        makeDirent("workspace", true),
        makeDirent("workspace-dench", true),
        makeDirent("workspace-kumareth", true),
      ] as unknown as Dirent[]);
      mockExists.mockImplementation((p) => {
        const s = String(p);
        return (
          s === join(STATE_DIR, "workspace") ||
          s === join(STATE_DIR, "workspace-dench") ||
          s === join(STATE_DIR, "workspace-kumareth")
        );
      });

      const workspaces = discoverWorkspaces();
      expect(workspaces.map((workspace) => workspace.name)).toEqual([
        "default",
        "dench",
        "kumareth",
      ]);
    });

    it("first discovered workspace is marked active when no explicit selection", async () => {
      const { discoverWorkspaces, mockReaddir, mockExists, mockReadFile } =
        await importWorkspace();
      mockReadFile.mockImplementation(() => {
        throw new Error("ENOENT");
      });
      mockReaddir.mockReturnValue([
        makeDirent("workspace-beta", true),
        makeDirent("workspace-alpha", true),
      ] as unknown as Dirent[]);
      mockExists.mockImplementation((p) => {
        const s = String(p);
        return (
          s === join(STATE_DIR, "workspace-alpha") ||
          s === join(STATE_DIR, "workspace-beta")
        );
      });

      const workspaces = discoverWorkspaces();
      // sorted alphabetically: alpha first
      expect(workspaces[0].name).toBe("alpha");
      expect(workspaces[0].isActive).toBe(true);
      expect(workspaces[1].isActive).toBe(false);
    });

    it("marks the explicitly active workspace correctly", async () => {
      const {
        discoverWorkspaces,
        setUIActiveWorkspace,
        mockReaddir,
        mockExists,
        mockReadFile,
      } = await importWorkspace();
      mockReadFile.mockReturnValue(JSON.stringify({}) as never);
      mockReaddir.mockReturnValue([
        makeDirent("workspace-alpha", true),
        makeDirent("workspace-beta", true),
      ] as unknown as Dirent[]);
      mockExists.mockImplementation((p) => {
        const s = String(p);
        return (
          s === join(STATE_DIR, "workspace-alpha") ||
          s === join(STATE_DIR, "workspace-beta") ||
          s === STATE_DIR
        );
      });

      setUIActiveWorkspace("beta");
      const workspaces = discoverWorkspaces();
      const alpha = workspaces.find((w) => w.name === "alpha");
      const beta = workspaces.find((w) => w.name === "beta");
      expect(alpha?.isActive).toBe(false);
      expect(beta?.isActive).toBe(true);
    });
  });

  // ─── resolveWebChatDir ────────────────────────────────────────────

  describe("resolveWebChatDir", () => {
    it("returns <workspace>/.openclaw/web-chat for active workspace (per-workspace chat isolation)", async () => {
      const {
        resolveWebChatDir,
        setUIActiveWorkspace,
        mockExists,
        mockReadFile,
        mockReaddir,
      } = await importWorkspace();
      mockReaddir.mockReturnValue([
        makeDirent("workspace-dev", true),
      ] as unknown as Dirent[]);
      mockReadFile.mockReturnValue(JSON.stringify({}) as never);
      setUIActiveWorkspace("dev");
      const wsDir = join(STATE_DIR, "workspace-dev");
      mockExists.mockImplementation((p) => String(p) === wsDir);
      expect(resolveWebChatDir()).toBe(join(wsDir, ".openclaw", "web-chat"));
    });

    it("different workspaces produce different chat directories", async () => {
      const {
        resolveWebChatDir,
        setUIActiveWorkspace,
        clearUIActiveWorkspaceCache,
        mockExists,
        mockReadFile,
        mockReaddir,
      } = await importWorkspace();
      mockReaddir.mockReturnValue([
        makeDirent("workspace-work", true),
        makeDirent("workspace-personal", true),
      ] as unknown as Dirent[]);
      mockReadFile.mockReturnValue(JSON.stringify({}) as never);

      setUIActiveWorkspace("work");
      const workDir = join(STATE_DIR, "workspace-work");
      mockExists.mockImplementation((p) => String(p) === workDir);
      const chatWork = resolveWebChatDir();

      clearUIActiveWorkspaceCache();
      setUIActiveWorkspace("personal");
      const personalDir = join(STATE_DIR, "workspace-personal");
      mockExists.mockImplementation((p) => String(p) === personalDir);
      const chatPersonal = resolveWebChatDir();

      expect(chatWork).not.toBe(chatPersonal);
      expect(chatWork).toBe(join(workDir, ".openclaw", "web-chat"));
      expect(chatPersonal).toBe(join(personalDir, ".openclaw", "web-chat"));
    });

    it("falls back to root workspace path when no workspace is active", async () => {
      const { resolveWebChatDir, mockReadFile, mockReaddir } =
        await importWorkspace();
      mockReadFile.mockImplementation(() => {
        throw new Error("ENOENT");
      });
      mockReaddir.mockReturnValue([] as unknown as Dirent[]);
      expect(resolveWebChatDir()).toBe(
        join(STATE_DIR, "workspace", ".openclaw", "web-chat"),
      );
    });
  });

  // ─── resolveWorkspaceRoot ─────────────────────────────────────────

  describe("resolveWorkspaceRoot", () => {
    it("returns active workspace dir when it exists on disk", async () => {
      const {
        resolveWorkspaceRoot,
        setUIActiveWorkspace,
        mockExists,
        mockReadFile,
        mockReaddir,
      } = await importWorkspace();
      mockReaddir.mockReturnValue([
        makeDirent("workspace-dev", true),
      ] as unknown as Dirent[]);
      mockReadFile.mockReturnValue(JSON.stringify({}) as never);
      setUIActiveWorkspace("dev");
      const wsDir = join(STATE_DIR, "workspace-dev");
      mockExists.mockImplementation((p) => String(p) === wsDir);
      expect(resolveWorkspaceRoot()).toBe(wsDir);
    });

    it("returns null when no workspace dirs exist", async () => {
      const { resolveWorkspaceRoot, mockReadFile, mockReaddir } = await importWorkspace();
      mockReaddir.mockReturnValue([] as unknown as Dirent[]);
      mockReadFile.mockImplementation(() => {
        throw new Error("ENOENT");
      });
      expect(resolveWorkspaceRoot()).toBeNull();
    });

    it("OPENCLAW_WORKSPACE env takes priority if it points to a valid workspace-<name> path", async () => {
      const envWsDir = join(STATE_DIR, "workspace-envws");
      process.env.OPENCLAW_WORKSPACE = envWsDir;
      const { resolveWorkspaceRoot, setUIActiveWorkspace, mockExists, mockReadFile } =
        await importWorkspace();
      mockReadFile.mockReturnValue(JSON.stringify({}) as never);
      setUIActiveWorkspace("other");
      mockExists.mockImplementation((p) => {
        const s = String(p);
        return s === envWsDir || s === join(STATE_DIR, "workspace-other");
      });
      expect(resolveWorkspaceRoot()).toBe(envWsDir);
    });

    it("OPENCLAW_WORKSPACE env takes priority for root workspace path", async () => {
      const envWsDir = join(STATE_DIR, "workspace");
      process.env.OPENCLAW_WORKSPACE = envWsDir;
      const { resolveWorkspaceRoot, setUIActiveWorkspace, mockExists, mockReadFile } =
        await importWorkspace();
      mockReadFile.mockReturnValue(JSON.stringify({}) as never);
      setUIActiveWorkspace("other");
      mockExists.mockImplementation((p) => {
        const s = String(p);
        return s === envWsDir || s === join(STATE_DIR, "workspace-other");
      });
      expect(resolveWorkspaceRoot()).toBe(envWsDir);
    });
  });

  describe("ensureManagedWorkspaceRouting", () => {
    it("repairs the default workspace agent and prunes chat slots without flipping the active default agent", async () => {
      const { ensureManagedWorkspaceRouting, mockExists, mockReadFile, mockWriteFile } =
        await importWorkspace();
      const configPath = join(STATE_DIR, "openclaw.json");
      const defaultWorkspaceDir = join(STATE_DIR, "workspace");
      const staleWorkspaceDir = join(STATE_DIR, "workspace-main");
      const otherWorkspaceDir = join(STATE_DIR, "workspace-kumareth");

      mockExists.mockImplementation((p) => String(p) === configPath);
      mockReadFile.mockImplementation((p) => {
        if (String(p) === configPath) {
          return JSON.stringify({
            agents: {
              defaults: {
                workspace: staleWorkspaceDir,
              },
              list: [
                { id: "main", workspace: staleWorkspaceDir },
                { id: "chat-slot-main-1", workspace: staleWorkspaceDir },
                { id: "chat-slot-main-2", workspace: staleWorkspaceDir },
                { id: "kumareth", workspace: otherWorkspaceDir, default: true },
              ],
            },
          }) as never;
        }
        return "" as never;
      });

      ensureManagedWorkspaceRouting("default", defaultWorkspaceDir, {
        markDefault: false,
        poolSize: 2,
      });

      expect(mockWriteFile).toHaveBeenCalled();
      const written = JSON.parse(String(mockWriteFile.mock.calls.at(-1)?.[1])) as {
        agents: {
          defaults: { workspace?: string };
          list: Array<{ id: string; workspace?: string; default?: boolean }>;
        };
      };

      expect(written.agents.defaults.workspace).toBe(defaultWorkspaceDir);
      expect(written.agents.list.find((agent) => agent.id === "main")?.workspace).toBe(defaultWorkspaceDir);
      expect(written.agents.list.find((agent) => agent.id === "chat-slot-main-1")).toBeUndefined();
      expect(written.agents.list.find((agent) => agent.id === "chat-slot-main-2")).toBeUndefined();
      expect(written.agents.list.find((agent) => agent.id === "kumareth")?.default).toBe(true);
      expect(written.agents.list.find((agent) => agent.id === "main")?.default).toBeUndefined();
    });
  });

  // ─── registerWorkspacePath / getRegisteredWorkspacePath ────────────

  describe("registerWorkspacePath / getRegisteredWorkspacePath", () => {
    it("registerWorkspacePath is now a no-op (custom paths disabled)", async () => {
      const { registerWorkspacePath, mockWriteFile } = await importWorkspace();
      mockWriteFile.mockClear();
      registerWorkspacePath("myprofile", "/my/workspace");
      const stateWrites = mockWriteFile.mock.calls.filter((c) =>
        (c[0] as string).includes(".dench-ui-state.json"),
      );
      expect(stateWrites).toHaveLength(0);
    });

    it("getRegisteredWorkspacePath always returns null", async () => {
      const { getRegisteredWorkspacePath } = await importWorkspace();
      expect(getRegisteredWorkspacePath("anything")).toBeNull();
      expect(getRegisteredWorkspacePath(null)).toBeNull();
      expect(getRegisteredWorkspacePath("test")).toBeNull();
    });
  });
});
