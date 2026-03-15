import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("node:fs", () => ({
  existsSync: vi.fn(() => false),
  readFileSync: vi.fn(() => Buffer.from("")),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

vi.mock("@/lib/workspace", () => ({
  resolveFilesystemPath: vi.fn(),
  resolveWorkspaceRoot: vi.fn(() => "/ws"),
  isProtectedSystemPath: vi.fn(() => false),
}));

describe("POST /api/workspace/raw-file", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.mock("node:fs", () => ({
      existsSync: vi.fn(() => false),
      readFileSync: vi.fn(() => Buffer.from("")),
      writeFileSync: vi.fn(),
      mkdirSync: vi.fn(),
    }));
    vi.mock("@/lib/workspace", () => ({
      resolveFilesystemPath: vi.fn(),
      resolveWorkspaceRoot: vi.fn(() => "/ws"),
      isProtectedSystemPath: vi.fn(() => false),
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns 400 when path query parameter is missing (prevents blind writes)", async () => {
    const { POST } = await import("./raw-file/route.js");
    const req = new Request("http://localhost/api/workspace/raw-file", {
      method: "POST",
      body: new ArrayBuffer(8),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns 403 when path is a system file (protects workspace.duckdb, etc.)", async () => {
    const { resolveFilesystemPath, isProtectedSystemPath } = await import("@/lib/workspace");
    vi.mocked(resolveFilesystemPath).mockReturnValueOnce({
      absolutePath: "/ws/workspace.duckdb",
      kind: "workspaceRelative",
      withinWorkspace: true,
      workspaceRelativePath: "workspace.duckdb",
    });
    vi.mocked(isProtectedSystemPath).mockReturnValueOnce(true);

    const { POST } = await import("./raw-file/route.js");
    const req = new Request(
      "http://localhost/api/workspace/raw-file?path=workspace.duckdb",
      { method: "POST", body: new ArrayBuffer(8) },
    );
    const res = await POST(req);
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toContain("system file");
  });

  it("returns 400 when path resolution rejects the path (path traversal attack)", async () => {
    const { resolveFilesystemPath } = await import("@/lib/workspace");
    vi.mocked(resolveFilesystemPath).mockReturnValueOnce(null);

    const { POST } = await import("./raw-file/route.js");
    const req = new Request(
      "http://localhost/api/workspace/raw-file?path=../../etc/passwd",
      { method: "POST", body: new ArrayBuffer(8) },
    );
    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("traversal");
  });

  it("writes binary data to the resolved path and creates parent dirs", async () => {
    const { resolveFilesystemPath } = await import("@/lib/workspace");
    vi.mocked(resolveFilesystemPath).mockReturnValueOnce({
      absolutePath: "/ws/data/report.xlsx",
      kind: "workspaceRelative",
      withinWorkspace: true,
      workspaceRelativePath: "data/report.xlsx",
    });

    const { writeFileSync: mockWrite, mkdirSync: mockMkdir } = await import("node:fs");

    const { POST } = await import("./raw-file/route.js");
    const binaryData = new Uint8Array([0x50, 0x4b, 0x03, 0x04]).buffer;
    const req = new Request(
      "http://localhost/api/workspace/raw-file?path=data/report.xlsx",
      { method: "POST", body: binaryData },
    );
    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.path).toBe("data/report.xlsx");

    expect(mockMkdir).toHaveBeenCalledWith("/ws/data", { recursive: true });
    expect(mockWrite).toHaveBeenCalledWith(
      "/ws/data/report.xlsx",
      expect.any(Buffer),
    );
  });

  it("returns 500 when writeFileSync throws (disk full, permission denied)", async () => {
    const { resolveFilesystemPath } = await import("@/lib/workspace");
    vi.mocked(resolveFilesystemPath).mockReturnValueOnce({
      absolutePath: "/ws/data.xlsx",
      kind: "workspaceRelative",
      withinWorkspace: true,
      workspaceRelativePath: "data.xlsx",
    });

    const { writeFileSync: mockWrite } = await import("node:fs");
    vi.mocked(mockWrite).mockImplementationOnce(() => {
      throw new Error("ENOSPC: no space left on device");
    });

    const { POST } = await import("./raw-file/route.js");
    const req = new Request(
      "http://localhost/api/workspace/raw-file?path=data.xlsx",
      { method: "POST", body: new ArrayBuffer(8) },
    );
    const res = await POST(req);
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toContain("ENOSPC");
  });

  it("preserves binary content exactly as received (no encoding corruption)", async () => {
    const { resolveFilesystemPath } = await import("@/lib/workspace");
    vi.mocked(resolveFilesystemPath).mockReturnValueOnce({
      absolutePath: "/ws/file.xlsx",
      kind: "workspaceRelative",
      withinWorkspace: true,
      workspaceRelativePath: "file.xlsx",
    });

    const { writeFileSync: mockWrite } = await import("node:fs");
    vi.mocked(mockWrite).mockClear();

    const { POST } = await import("./raw-file/route.js");
    const bytes = new Uint8Array([0x00, 0xff, 0x80, 0x7f, 0x01]);
    const req = new Request(
      "http://localhost/api/workspace/raw-file?path=file.xlsx",
      { method: "POST", body: bytes.buffer },
    );
    await POST(req);

    const writtenBuffer = vi.mocked(mockWrite).mock.calls[0][1] as Buffer;
    expect(writtenBuffer[0]).toBe(0x00);
    expect(writtenBuffer[1]).toBe(0xff);
    expect(writtenBuffer[2]).toBe(0x80);
    expect(writtenBuffer[3]).toBe(0x7f);
    expect(writtenBuffer[4]).toBe(0x01);
  });

  it("writes external absolute .object.yaml files when they are outside the managed workspace", async () => {
    const { resolveFilesystemPath, isProtectedSystemPath } = await import("@/lib/workspace");
    vi.mocked(resolveFilesystemPath).mockReturnValueOnce({
      absolutePath: "/tmp/.object.yaml",
      kind: "absolute",
      withinWorkspace: false,
      workspaceRelativePath: null,
    });
    vi.mocked(isProtectedSystemPath).mockReturnValueOnce(false);
    const { writeFileSync: mockWrite } = await import("node:fs");

    const { POST } = await import("./raw-file/route.js");
    const req = new Request(
      "http://localhost/api/workspace/raw-file?path=/tmp/.object.yaml",
      { method: "POST", body: new ArrayBuffer(1) },
    );
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(mockWrite).toHaveBeenCalledWith("/tmp/.object.yaml", expect.any(Buffer));
  });
});

describe("GET /api/workspace/raw-file", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.mock("node:fs", () => ({
      existsSync: vi.fn(() => false),
      readFileSync: vi.fn(() => Buffer.from("")),
      writeFileSync: vi.fn(),
      mkdirSync: vi.fn(),
    }));
    vi.mock("@/lib/workspace", () => ({
      resolveFilesystemPath: vi.fn(),
      resolveWorkspaceRoot: vi.fn(() => "/ws"),
      isProtectedSystemPath: vi.fn(() => false),
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns DOCX MIME type for .docx files (required for browser/editor interoperability)", async () => {
    const { resolveFilesystemPath } = await import("@/lib/workspace");
    vi.mocked(resolveFilesystemPath).mockReturnValueOnce({
      absolutePath: "/ws/docs/spec.docx",
      kind: "workspaceRelative",
      withinWorkspace: true,
      workspaceRelativePath: "docs/spec.docx",
    });
    const { readFileSync } = await import("node:fs");
    vi.mocked(readFileSync).mockReturnValueOnce(Buffer.from([0x50, 0x4b]));

    const { GET } = await import("./raw-file/route.js");
    const res = await GET(
      new Request("http://localhost/api/workspace/raw-file?path=docs/spec.docx"),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
  });

  it("returns text/plain for .txt files (ensures plain-text previews render correctly)", async () => {
    const { resolveFilesystemPath } = await import("@/lib/workspace");
    vi.mocked(resolveFilesystemPath).mockReturnValueOnce({
      absolutePath: "/ws/notes/today.txt",
      kind: "workspaceRelative",
      withinWorkspace: true,
      workspaceRelativePath: "notes/today.txt",
    });
    const { readFileSync } = await import("node:fs");
    vi.mocked(readFileSync).mockReturnValueOnce(Buffer.from("hello"));

    const { GET } = await import("./raw-file/route.js");
    const res = await GET(
      new Request("http://localhost/api/workspace/raw-file?path=notes/today.txt"),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/plain");
  });

  it("falls back to octet-stream for unknown extensions (prevents incorrect sniffing assumptions)", async () => {
    const { resolveFilesystemPath } = await import("@/lib/workspace");
    vi.mocked(resolveFilesystemPath).mockReturnValueOnce({
      absolutePath: "/ws/blob.unknown",
      kind: "workspaceRelative",
      withinWorkspace: true,
      workspaceRelativePath: "blob.unknown",
    });
    const { readFileSync } = await import("node:fs");
    vi.mocked(readFileSync).mockReturnValueOnce(Buffer.from([1, 2, 3]));

    const { GET } = await import("./raw-file/route.js");
    const res = await GET(
      new Request("http://localhost/api/workspace/raw-file?path=blob.unknown"),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/octet-stream");
  });

  it("returns 400 when path query is missing (rejects ambiguous read requests)", async () => {
    const { GET } = await import("./raw-file/route.js");
    const res = await GET(new Request("http://localhost/api/workspace/raw-file"));
    expect(res.status).toBe(400);
  });

  it("returns 404 when file cannot be resolved (prevents leaking host paths)", async () => {
    const { resolveFilesystemPath, resolveWorkspaceRoot } = await import("@/lib/workspace");
    vi.mocked(resolveFilesystemPath).mockReturnValueOnce(null);
    vi.mocked(resolveWorkspaceRoot).mockReturnValueOnce(null);

    const { GET } = await import("./raw-file/route.js");
    const res = await GET(
      new Request("http://localhost/api/workspace/raw-file?path=missing.docx"),
    );
    expect(res.status).toBe(404);
  });
});
