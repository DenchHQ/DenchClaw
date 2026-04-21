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

describe("workspace-scoped chat session isolation", () => {
  const originalEnv = { ...process.env };
  const STATE_DIR = "/home/testuser/.openclaw-dench";

  const workspaceDir = (name: string) =>
    name === "default"
      ? join(STATE_DIR, "workspace")
      : join(STATE_DIR, `workspace-${name}`);

  const chatDir = (name: string) =>
    join(workspaceDir(name), ".openclaw", "web-chat");

  function makeDirent(name: string): Dirent {
    return {
      name,
      isDirectory: () => true,
      isFile: () => false,
      isBlockDevice: () => false,
      isCharacterDevice: () => false,
      isFIFO: () => false,
      isSocket: () => false,
      isSymbolicLink: () => false,
      path: "",
      parentPath: "",
    } as Dirent;
  }

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
    const { readFileSync: rfs, writeFileSync: wfs, existsSync: es, readdirSync: rds } =
      await import("node:fs");
    const mod = await import("./workspace.js");
    return {
      ...mod,
      mockReadFile: vi.mocked(rfs),
      mockWriteFile: vi.mocked(wfs),
      mockExists: vi.mocked(es),
      mockReaddir: vi.mocked(rds),
    };
  }

  it("active workspace uses <workspace>/.openclaw/web-chat", async () => {
    const { resolveWebChatDir, setUIActiveWorkspace, mockExists, mockReadFile, mockReaddir } =
      await importWorkspace();
    mockReadFile.mockImplementation(() => {
      throw new Error("ENOENT");
    });
    mockReaddir.mockReturnValue([
      makeDirent("workspace-dev"),
    ] as unknown as Dirent[]);

    const wsDir = workspaceDir("dev");
    mockExists.mockImplementation((p) => String(p) === wsDir);

    setUIActiveWorkspace("dev");
    expect(resolveWebChatDir()).toBe(chatDir("dev"));
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
    mockReadFile.mockImplementation(() => {
      throw new Error("ENOENT");
    });
    mockReaddir.mockReturnValue([
      makeDirent("workspace-alpha"),
      makeDirent("workspace-beta"),
    ] as unknown as Dirent[]);

    const alphaDir = workspaceDir("alpha");
    const betaDir = workspaceDir("beta");
    mockExists.mockImplementation((p) => {
      const s = String(p);
      return s === alphaDir || s === betaDir;
    });

    setUIActiveWorkspace("alpha");
    const dirAlpha = resolveWebChatDir();

    clearUIActiveWorkspaceCache();
    setUIActiveWorkspace("beta");
    const dirBeta = resolveWebChatDir();

    expect(dirAlpha).not.toBe(dirBeta);
    expect(dirAlpha).toBe(chatDir("alpha"));
    expect(dirBeta).toBe(chatDir("beta"));
  });

  it("switching workspaces changes chat directory", async () => {
    const { resolveWebChatDir, setUIActiveWorkspace, mockExists, mockReadFile, mockReaddir } =
      await importWorkspace();
    mockReadFile.mockImplementation(() => {
      throw new Error("ENOENT");
    });
    mockReaddir.mockReturnValue([
      makeDirent("workspace-work"),
      makeDirent("workspace-personal"),
    ] as unknown as Dirent[]);

    const workDir = workspaceDir("work");
    const personalDir = workspaceDir("personal");
    mockExists.mockImplementation((p) => {
      const s = String(p);
      return s === workDir || s === personalDir;
    });

    setUIActiveWorkspace("work");
    expect(resolveWebChatDir()).toBe(chatDir("work"));

    setUIActiveWorkspace("personal");
    expect(resolveWebChatDir()).toBe(chatDir("personal"));
  });

  it("falls back to default root workspace when nothing is active", async () => {
    const { resolveWebChatDir, mockReadFile, mockExists, mockReaddir } = await importWorkspace();
    mockReadFile.mockImplementation(() => {
      throw new Error("ENOENT");
    });
    mockReaddir.mockReturnValue([] as unknown as Dirent[]);
    mockExists.mockReturnValue(false);

    expect(resolveWebChatDir()).toBe(chatDir("default"));
  });

  it("workspace roots are isolated per workspace", async () => {
    const {
      resolveWorkspaceRoot,
      setUIActiveWorkspace,
      clearUIActiveWorkspaceCache,
      mockExists,
      mockReadFile,
      mockReaddir,
    } = await importWorkspace();
    mockReadFile.mockImplementation(() => {
      throw new Error("ENOENT");
    });
    mockReaddir.mockReturnValue([
      makeDirent("workspace-dev"),
      makeDirent("workspace-staging"),
    ] as unknown as Dirent[]);

    const devDir = workspaceDir("dev");
    const stagingDir = workspaceDir("staging");
    mockExists.mockImplementation((p) => {
      const s = String(p);
      return s === devDir || s === stagingDir;
    });

    clearUIActiveWorkspaceCache();
    setUIActiveWorkspace("dev");
    expect(resolveWorkspaceRoot()).toBe(devDir);

    setUIActiveWorkspace("staging");
    expect(resolveWorkspaceRoot()).toBe(stagingDir);
  });

  it("setUIActiveProfile compat shim delegates to workspace", async () => {
    const { resolveWebChatDir, setUIActiveProfile, mockExists, mockReadFile, mockReaddir } =
      await importWorkspace();
    mockReadFile.mockImplementation(() => {
      throw new Error("ENOENT");
    });
    mockReaddir.mockReturnValue([
      makeDirent("workspace-work"),
    ] as unknown as Dirent[]);

    const wsDir = workspaceDir("work");
    mockExists.mockImplementation((p) => String(p) === wsDir);

    setUIActiveProfile("work");
    expect(resolveWebChatDir()).toBe(chatDir("work"));
  });

  it("setUIActiveProfile('default') selects the root workspace", async () => {
    const { resolveWebChatDir, setUIActiveProfile, mockReadFile, mockExists, mockReaddir } =
      await importWorkspace();
    mockReadFile.mockImplementation(() => {
      throw new Error("ENOENT");
    });
    const rootDir = workspaceDir("default");
    mockReaddir.mockReturnValue([
      makeDirent("workspace"),
    ] as unknown as Dirent[]);
    mockExists.mockImplementation((p) => String(p) === rootDir);

    setUIActiveProfile("default");
    expect(resolveWebChatDir()).toBe(chatDir("default"));
  });

  it("clearUIActiveProfileCache delegates to clearUIActiveWorkspaceCache", async () => {
    const {
      resolveWebChatDir,
      setUIActiveWorkspace,
      clearUIActiveProfileCache,
      mockExists,
      mockReadFile,
      mockReaddir,
    } = await importWorkspace();
    mockReadFile.mockImplementation(() => {
      throw new Error("ENOENT");
    });
    mockReaddir.mockReturnValue([
      makeDirent("workspace-dev"),
    ] as unknown as Dirent[]);

    const devDir = workspaceDir("dev");
    mockExists.mockImplementation((p) => String(p) === devDir);

    setUIActiveWorkspace("dev");
    expect(resolveWebChatDir()).toBe(chatDir("dev"));

    clearUIActiveProfileCache();
    mockExists.mockReturnValue(false);
    mockReaddir.mockReturnValue([] as unknown as Dirent[]);

    expect(resolveWebChatDir()).toBe(chatDir("default"));
  });
});
