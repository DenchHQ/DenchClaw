import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/workspace", () => ({
  duckdbQueryOnFile: vi.fn(),
  duckdbExecOnFile: vi.fn(),
  findDuckDBForObject: vi.fn(() => "/tmp/workspace.duckdb"),
}));

vi.mock("@/lib/integrations", () => ({
  getIntegrationsState: vi.fn(() => ({
    denchCloud: {
      hasKey: true,
      isPrimaryProvider: true,
      primaryModel: "dench-cloud/gpt-5.4",
    },
    metadata: { schemaVersion: 1 },
    search: {
      builtIn: { enabled: true, denied: false, provider: null },
      effectiveOwner: "web_search",
    },
    managedPlugins: [],
    integrations: [{ id: "apollo", enabled: true }],
  })),
  resolveDenchGatewayCredentials: vi.fn(() => ({
    apiKey: "dc-key",
    gatewayUrl: "https://gateway.example.com",
  })),
}));

// Keep the real field-mapping helper (enrichment-columns.ts depends on it) while
// stubbing the network-touching gateway functions.
vi.mock("@/lib/dench-gateway-enrichment", async () => {
  const actual = await vi.importActual<typeof import("@/lib/dench-gateway-enrichment")>(
    "@/lib/dench-gateway-enrichment",
  );
  return {
    ...actual,
    gatewayPersonContact: vi.fn(),
    gatewayCompanySearch: vi.fn(),
    pollEnrichmentJobWithTimeout: vi.fn(),
  };
});

function mockDuckDb(
  duckdbQueryOnFile: ReturnType<typeof vi.fn>,
  opts: { inputField: { name: string; type: string }; inputValue: string | null },
) {
  duckdbQueryOnFile.mockImplementation((_dbFile: string, sql: string) => {
    if (sql.includes("SELECT id FROM objects WHERE name")) {
      return [{ id: "obj_1" }] as never;
    }
    if (sql.includes("SELECT id, name, type FROM fields")) {
      return [{ id: "input_1", ...opts.inputField }] as never;
    }
    if (sql.includes("SELECT id FROM fields WHERE id")) {
      return [{ id: "field_1" }] as never;
    }
    if (sql.includes("FROM entries e")) {
      return [{ entry_id: "entry_1", input_value: opts.inputValue }] as never;
    }
    if (sql.includes("COUNT(*) as cnt")) {
      return [{ cnt: 0 }] as never;
    }
    return [] as never;
  });
}

describe("workspace enrichment route", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const { duckdbExecOnFile, duckdbQueryOnFile } = await import("@/lib/workspace");
    vi.mocked(duckdbExecOnFile).mockReset();
    vi.mocked(duckdbQueryOnFile).mockReset();
    const gateway = await import("@/lib/dench-gateway-enrichment");
    vi.mocked(gateway.gatewayPersonContact).mockReset();
    vi.mocked(gateway.gatewayCompanySearch).mockReset();
    vi.mocked(gateway.pollEnrichmentJobWithTimeout).mockReset();
  });

  it("enriches a LinkedIn person via gatewayPersonContact and writes the cached value", async () => {
    const { duckdbQueryOnFile, duckdbExecOnFile } = await import("@/lib/workspace");
    mockDuckDb(vi.mocked(duckdbQueryOnFile), {
      inputField: { name: "LinkedIn URL", type: "url" },
      inputValue: "https://www.linkedin.com/in/janedoe",
    });

    const { gatewayPersonContact } = await import("@/lib/dench-gateway-enrichment");
    vi.mocked(gatewayPersonContact).mockResolvedValue({
      ok: true,
      result: { kind: "person", person: { person: { name: "Jane Doe" } } },
    });

    const { POST } = await import("./route.js");
    const response = await POST(
      new Request("http://localhost/api/workspace/objects/leads/enrich", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fieldId: "field_1",
          apolloPath: "person.name",
          category: "people",
          inputFieldName: "LinkedIn URL",
          scope: 1,
        }),
      }),
      { params: Promise.resolve({ name: "leads" }) },
    );

    expect(response.status).toBe(200);
    const text = await response.text();
    expect(gatewayPersonContact).toHaveBeenCalledTimes(1);
    const [, , params] = vi.mocked(gatewayPersonContact).mock.calls[0];
    // person.name maps to the Apollo `fullName` token, which has no contact-field
    // mapping, so we send no enrichFields narrowing and let the gateway run its
    // default backfill rather than forcing a work_emails-only request.
    expect(params).toMatchObject({
      linkedinUrl: "https://www.linkedin.com/in/janedoe",
    });
    expect(params.enrichFields).toBeUndefined();
    // Value extracted and written back, surfaced as a progress event.
    expect(text).toContain('"type":"progress"');
    expect(text).toContain("Jane Doe");
    expect(vi.mocked(duckdbExecOnFile)).toHaveBeenCalled();
  });

  it("polls queued LinkedIn jobs and writes the polled value", async () => {
    const { duckdbQueryOnFile } = await import("@/lib/workspace");
    mockDuckDb(vi.mocked(duckdbQueryOnFile), {
      inputField: { name: "LinkedIn URL", type: "url" },
      inputValue: "https://www.linkedin.com/in/markrachapoom",
    });

    const { gatewayPersonContact, pollEnrichmentJobWithTimeout } = await import(
      "@/lib/dench-gateway-enrichment"
    );
    vi.mocked(gatewayPersonContact).mockResolvedValue({
      ok: true,
      result: {
        kind: "queued",
        enrichmentId: "job_1",
        status: "queued",
        pollPath: "/v1/enrichment/jobs/job_1",
      },
    });
    vi.mocked(pollEnrichmentJobWithTimeout).mockResolvedValue({
      ok: true,
      person: { person: { name: "Mark Rachapoom" } },
    });

    const { POST } = await import("./route.js");
    const response = await POST(
      new Request("http://localhost/api/workspace/objects/leads/enrich", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fieldId: "field_1",
          apolloPath: "person.name",
          category: "people",
          inputFieldName: "LinkedIn URL",
          scope: 1,
        }),
      }),
      { params: Promise.resolve({ name: "leads" }) },
    );

    expect(response.status).toBe(200);
    const text = await response.text();
    expect(pollEnrichmentJobWithTimeout).toHaveBeenCalledWith(
      "https://gateway.example.com",
      "dc-key",
      "job_1",
    );
    expect(text).toContain("Mark Rachapoom");
  });

  it("emits pending + error events when a queued job is still pending after polling", async () => {
    const { duckdbQueryOnFile } = await import("@/lib/workspace");
    mockDuckDb(vi.mocked(duckdbQueryOnFile), {
      inputField: { name: "LinkedIn URL", type: "url" },
      inputValue: "https://www.linkedin.com/in/pending",
    });

    const { gatewayPersonContact, pollEnrichmentJobWithTimeout } = await import(
      "@/lib/dench-gateway-enrichment"
    );
    vi.mocked(gatewayPersonContact).mockResolvedValue({
      ok: true,
      result: {
        kind: "queued",
        enrichmentId: "job_2",
        status: "queued",
        pollPath: "/v1/enrichment/jobs/job_2",
      },
    });
    vi.mocked(pollEnrichmentJobWithTimeout).mockResolvedValue({
      ok: false,
      error: "Enrichment still pending",
      pending: true,
    });

    const { POST } = await import("./route.js");
    const response = await POST(
      new Request("http://localhost/api/workspace/objects/leads/enrich", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fieldId: "field_1",
          apolloPath: "person.name",
          category: "people",
          inputFieldName: "LinkedIn URL",
          scope: 1,
        }),
      }),
      { params: Promise.resolve({ name: "leads" }) },
    );

    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toContain('"type":"pending"');
    expect(text).toContain('"enrichmentId":"job_2"');
    expect(text).toContain("Enrichment still pending");
  });

  it("rejects an email input field for people enrichment before touching the gateway", async () => {
    // Email is no longer an eligible people identifier (the gateway resolves
    // contacts from LinkedIn URLs), so an email-typed input field is rejected at
    // validation rather than failing per-row downstream.
    const { duckdbQueryOnFile } = await import("@/lib/workspace");
    mockDuckDb(vi.mocked(duckdbQueryOnFile), {
      inputField: { name: "email", type: "email" },
      inputValue: "jane@acme.com",
    });

    const { gatewayPersonContact } = await import("@/lib/dench-gateway-enrichment");

    const { POST } = await import("./route.js");
    const response = await POST(
      new Request("http://localhost/api/workspace/objects/leads/enrich", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fieldId: "field_1",
          apolloPath: "person.name",
          category: "people",
          inputFieldName: "email",
          scope: 1,
        }),
      }),
      { params: Promise.resolve({ name: "leads" }) },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "Input field 'email' is not supported for people enrichment.",
    });
    expect(gatewayPersonContact).not.toHaveBeenCalled();
  });

  it("rejects email values that slip through a LinkedIn-typed field", async () => {
    // A LinkedIn-typed field passes validation, but a per-row value that is an
    // email (not a LinkedIn URL) must not be sent to the contact endpoint.
    const { duckdbQueryOnFile } = await import("@/lib/workspace");
    mockDuckDb(vi.mocked(duckdbQueryOnFile), {
      inputField: { name: "LinkedIn URL", type: "url" },
      inputValue: "jane@acme.com",
    });

    const { gatewayPersonContact } = await import("@/lib/dench-gateway-enrichment");

    const { POST } = await import("./route.js");
    const response = await POST(
      new Request("http://localhost/api/workspace/objects/leads/enrich", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fieldId: "field_1",
          apolloPath: "person.name",
          category: "people",
          inputFieldName: "LinkedIn URL",
          scope: 1,
        }),
      }),
      { params: Promise.resolve({ name: "leads" }) },
    );

    expect(response.status).toBe(200);
    const text = await response.text();
    expect(gatewayPersonContact).not.toHaveBeenCalled();
    expect(text).toContain("People enrichment requires a LinkedIn URL");
  });

  it("skips unknown people identifiers instead of treating them as a LinkedIn URL", async () => {
    const { duckdbQueryOnFile } = await import("@/lib/workspace");
    mockDuckDb(vi.mocked(duckdbQueryOnFile), {
      inputField: { name: "LinkedIn URL", type: "url" },
      inputValue: "Jane Example",
    });

    const { gatewayPersonContact } = await import("@/lib/dench-gateway-enrichment");

    const { POST } = await import("./route.js");
    const response = await POST(
      new Request("http://localhost/api/workspace/objects/leads/enrich", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fieldId: "field_1",
          apolloPath: "person.name",
          category: "people",
          inputFieldName: "LinkedIn URL",
          scope: 1,
        }),
      }),
      { params: Promise.resolve({ name: "leads" }) },
    );

    expect(response.status).toBe(200);
    const text = await response.text();
    expect(gatewayPersonContact).not.toHaveBeenCalled();
    expect(text).toContain("Unsupported people identifier");
  });

  it("enriches a company via gatewayCompanySearch using the extracted domain", async () => {
    const { duckdbQueryOnFile } = await import("@/lib/workspace");
    mockDuckDb(vi.mocked(duckdbQueryOnFile), {
      inputField: { name: "website", type: "url" },
      inputValue: "https://www.acme.com",
    });

    const { gatewayCompanySearch } = await import("@/lib/dench-gateway-enrichment");
    vi.mocked(gatewayCompanySearch).mockResolvedValue({
      ok: true,
      company: { name: "Acme" },
    });

    const { POST } = await import("./route.js");
    const response = await POST(
      new Request("http://localhost/api/workspace/objects/accounts/enrich", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fieldId: "field_1",
          apolloPath: "organization.name",
          category: "company",
          inputFieldName: "website",
          scope: 1,
        }),
      }),
      { params: Promise.resolve({ name: "accounts" }) },
    );

    expect(response.status).toBe(200);
    const text = await response.text();
    expect(gatewayCompanySearch).toHaveBeenCalledWith(
      "https://gateway.example.com",
      "dc-key",
      "acme.com",
      1,
    );
    expect(text).toContain("Acme");
  });

  it("surfaces gateway invalid_required_field errors in SSE error events", async () => {
    const { duckdbQueryOnFile } = await import("@/lib/workspace");
    mockDuckDb(vi.mocked(duckdbQueryOnFile), {
      inputField: { name: "LinkedIn URL", type: "url" },
      inputValue: "https://www.linkedin.com/in/janedoe",
    });

    const { gatewayPersonContact } = await import("@/lib/dench-gateway-enrichment");
    vi.mocked(gatewayPersonContact).mockResolvedValue({
      ok: false,
      error: "Unknown required fields: foo",
    });

    const { POST } = await import("./route.js");
    const response = await POST(
      new Request("http://localhost/api/workspace/objects/leads/enrich", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fieldId: "field_1",
          apolloPath: "person.name",
          category: "people",
          inputFieldName: "LinkedIn URL",
          scope: 1,
        }),
      }),
      { params: Promise.resolve({ name: "leads" }) },
    );

    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toContain("Unknown required fields: foo");
  });

  it("rejects non-integer numeric scope values", async () => {
    const { POST } = await import("./route.js");
    const response = await POST(
      new Request("http://localhost/api/workspace/objects/leads/enrich", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fieldId: "field_1",
          apolloPath: "person.name",
          category: "people",
          inputFieldName: "email",
          scope: 1.5,
        }),
      }),
      { params: Promise.resolve({ name: "leads" }) },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: "Invalid scope." });
  });

  it("narrows the entries SQL to the supplied entryIds", async () => {
    const { duckdbQueryOnFile } = await import("@/lib/workspace");
    const seenSqls: string[] = [];
    vi.mocked(duckdbQueryOnFile).mockImplementation((_dbFile: string, sql: string) => {
      seenSqls.push(sql);
      if (sql.includes("SELECT id FROM objects WHERE name")) return [{ id: "obj_1" }] as never;
      if (sql.includes("SELECT id, name, type FROM fields")) {
        return [{ id: "input_1", name: "LinkedIn URL", type: "url" }] as never;
      }
      if (sql.includes("SELECT id FROM fields WHERE id")) return [{ id: "field_1" }] as never;
      if (sql.includes("FROM entries e")) {
        return [{ entry_id: "entry_2", input_value: "https://www.linkedin.com/in/bob" }] as never;
      }
      if (sql.includes("COUNT(*) as cnt")) return [{ cnt: 0 }] as never;
      return [] as never;
    });

    const { gatewayPersonContact } = await import("@/lib/dench-gateway-enrichment");
    vi.mocked(gatewayPersonContact).mockResolvedValue({
      ok: true,
      result: { kind: "person", person: { person: { name: "Bob" } } },
    });

    const { POST } = await import("./route.js");
    const response = await POST(
      new Request("http://localhost/api/workspace/objects/leads/enrich", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fieldId: "field_1",
          apolloPath: "person.name",
          category: "people",
          inputFieldName: "LinkedIn URL",
          scope: "all",
          entryIds: ["entry_2", "entry_4"],
        }),
      }),
      { params: Promise.resolve({ name: "leads" }) },
    );

    expect(response.status).toBe(200);
    await response.text();
    const entrySql = seenSqls.find((s) => s.includes("FROM entries e"));
    expect(entrySql).toMatch(/AND e\.id IN \('entry_2','entry_4'\)/);
    expect(gatewayPersonContact).toHaveBeenCalledTimes(1);
  });

  it("composes entryIds with scope='empty' so the two filters intersect", async () => {
    const { duckdbQueryOnFile } = await import("@/lib/workspace");
    const seenSqls: string[] = [];
    vi.mocked(duckdbQueryOnFile).mockImplementation((_dbFile: string, sql: string) => {
      seenSqls.push(sql);
      if (sql.includes("SELECT id FROM objects WHERE name")) return [{ id: "obj_1" }] as never;
      if (sql.includes("SELECT id, name, type FROM fields")) {
        return [{ id: "input_1", name: "LinkedIn URL", type: "url" }] as never;
      }
      if (sql.includes("SELECT id FROM fields WHERE id")) return [{ id: "field_1" }] as never;
      if (sql.includes("FROM entries e")) return [] as never;
      return [] as never;
    });

    const { POST } = await import("./route.js");
    await POST(
      new Request("http://localhost/api/workspace/objects/leads/enrich", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fieldId: "field_1",
          apolloPath: "person.name",
          category: "people",
          inputFieldName: "LinkedIn URL",
          scope: "empty",
          entryIds: ["entry_1"],
        }),
      }),
      { params: Promise.resolve({ name: "leads" }) },
    );

    const entrySql = seenSqls.find((s) => s.includes("FROM entries e"));
    expect(entrySql).toContain("AND e.id IN ('entry_1')");
    expect(entrySql).toContain("AND e.id NOT IN");
  });

  it("rejects entryIds that contain SQL-injection characters", async () => {
    const { POST } = await import("./route.js");
    const response = await POST(
      new Request("http://localhost/api/workspace/objects/leads/enrich", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fieldId: "field_1",
          apolloPath: "person.name",
          category: "people",
          inputFieldName: "email",
          scope: "all",
          entryIds: ["entry_1", "'; DROP TABLE entries; --"],
        }),
      }),
      { params: Promise.resolve({ name: "leads" }) },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: "Invalid entry ID." });
  });

  it("rejects entryIds payloads that exceed the cap", async () => {
    const { POST } = await import("./route.js");
    const tooMany = Array.from({ length: 5001 }, (_, i) => `entry_${i}`);
    const response = await POST(
      new Request("http://localhost/api/workspace/objects/leads/enrich", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fieldId: "field_1",
          apolloPath: "person.name",
          category: "people",
          inputFieldName: "email",
          scope: "all",
          entryIds: tooMany,
        }),
      }),
      { params: Promise.resolve({ name: "leads" }) },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining("Too many entryIds"),
    });
  });

  it("treats an empty entryIds array as 'no narrowing'", async () => {
    const { duckdbQueryOnFile } = await import("@/lib/workspace");
    const seenSqls: string[] = [];
    vi.mocked(duckdbQueryOnFile).mockImplementation((_dbFile: string, sql: string) => {
      seenSqls.push(sql);
      if (sql.includes("SELECT id FROM objects WHERE name")) return [{ id: "obj_1" }] as never;
      if (sql.includes("SELECT id, name, type FROM fields")) {
        return [{ id: "input_1", name: "LinkedIn URL", type: "url" }] as never;
      }
      if (sql.includes("SELECT id FROM fields WHERE id")) return [{ id: "field_1" }] as never;
      if (sql.includes("FROM entries e")) return [] as never;
      return [] as never;
    });

    const { POST } = await import("./route.js");
    await POST(
      new Request("http://localhost/api/workspace/objects/leads/enrich", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fieldId: "field_1",
          apolloPath: "person.name",
          category: "people",
          inputFieldName: "LinkedIn URL",
          scope: "all",
          entryIds: [],
        }),
      }),
      { params: Promise.resolve({ name: "leads" }) },
    );

    const entrySql = seenSqls.find((s) => s.includes("FROM entries e"));
    expect(entrySql).not.toContain("AND e.id IN");
  });
});
