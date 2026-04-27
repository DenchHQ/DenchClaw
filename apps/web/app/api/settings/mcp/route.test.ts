import { beforeEach, describe, expect, it, vi } from "vitest";
import { DELETE, GET, POST } from "./route";

vi.mock("@/lib/mcp-servers", () => {
  class MockMcpServerError extends Error {
    status: number;

    constructor(status: number, message: string) {
      super(message);
      this.name = "McpServerError";
      this.status = status;
    }
  }

  return {
    listMcpServers: vi.fn(),
    addMcpServer: vi.fn(),
    removeMcpServer: vi.fn(),
    McpServerError: MockMcpServerError,
  };
});

vi.mock("@/lib/telemetry", () => ({
  trackServer: vi.fn(),
}));

const {
  addMcpServer,
  listMcpServers,
  McpServerError,
  removeMcpServer,
} = await import("@/lib/mcp-servers");
const { trackServer } = await import("@/lib/telemetry");

const mockedAddMcpServer = vi.mocked(addMcpServer);
const mockedListMcpServers = vi.mocked(listMcpServers);
const mockedRemoveMcpServer = vi.mocked(removeMcpServer);
const mockedTrackServer = vi.mocked(trackServer);

describe("MCP settings API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("GET returns configured MCP servers", async () => {
    mockedListMcpServers.mockReturnValue([
      {
        key: "acme",
        url: "https://mcp.example.com",
        transport: "streamable-http",
        hasAuth: true,
      },
    ]);

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.servers).toEqual([
      {
        key: "acme",
        url: "https://mcp.example.com",
        transport: "streamable-http",
        hasAuth: true,
      },
    ]);
  });

  it("GET returns 500 when listing fails", async () => {
    mockedListMcpServers.mockImplementation(() => {
      throw new Error("read failed");
    });

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toContain("read failed");
  });

  it("POST validates key type", async () => {
    const response = await POST(new Request("http://localhost/api/settings/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        key: 123,
        url: "https://mcp.example.com",
      }),
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "Field 'key' must be a string.",
    });
  });

  it("POST creates a server and returns it", async () => {
    mockedAddMcpServer.mockReturnValue({
      key: "acme",
      url: "https://mcp.example.com",
      transport: "streamable-http",
      hasAuth: true,
    });

    const response = await POST(new Request("http://localhost/api/settings/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        key: "acme",
        url: "https://mcp.example.com",
        authToken: "secret-token",
      }),
    }));
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(mockedAddMcpServer).toHaveBeenCalledWith({
      key: "acme",
      url: "https://mcp.example.com",
      transport: undefined,
      authToken: "secret-token",
    });
    expect(body.server).toEqual({
      key: "acme",
      url: "https://mcp.example.com",
      transport: "streamable-http",
      hasAuth: true,
    });
    expect(mockedTrackServer).toHaveBeenCalledWith("mcp_server_added", {
      key: "acme",
      transport: "streamable-http",
      has_auth: true,
    });
  });

  it("POST returns helper validation errors", async () => {
    mockedAddMcpServer.mockImplementation(() => {
      throw new McpServerError(409, "MCP server 'acme' already exists.");
    });

    const response = await POST(new Request("http://localhost/api/settings/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        key: "acme",
        url: "https://mcp.example.com",
      }),
    }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: "MCP server 'acme' already exists.",
    });
    expect(mockedTrackServer).not.toHaveBeenCalled();
  });

  it("DELETE validates key type", async () => {
    const response = await DELETE(new Request("http://localhost/api/settings/mcp", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: 123 }),
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "Field 'key' must be a string.",
    });
  });

  it("DELETE removes the requested server", async () => {
    const response = await DELETE(new Request("http://localhost/api/settings/mcp", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "acme" }),
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mockedRemoveMcpServer).toHaveBeenCalledWith("acme");
    expect(body).toEqual({ key: "acme" });
    expect(mockedTrackServer).toHaveBeenCalledWith("mcp_server_removed", {
      key: "acme",
    });
  });

  it("DELETE returns helper not-found errors", async () => {
    mockedRemoveMcpServer.mockImplementation(() => {
      throw new McpServerError(404, "MCP server 'missing' was not found.");
    });

    const response = await DELETE(new Request("http://localhost/api/settings/mcp", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "missing" }),
    }));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      error: "MCP server 'missing' was not found.",
    });
    expect(mockedTrackServer).not.toHaveBeenCalled();
  });
});
