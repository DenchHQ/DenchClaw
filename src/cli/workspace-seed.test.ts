import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { seedWorkspaceFromAssets } from "./workspace-seed.js";

function createTempDir(): string {
  const dir = path.join(
    os.tmpdir(),
    `ironclaw-seed-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

function createPackageRoot(tempDir: string): string {
  const pkgRoot = path.join(tempDir, "pkg");
  const seedDir = path.join(pkgRoot, "assets", "seed");
  const skillsDir = path.join(pkgRoot, "skills", "dench");
  mkdirSync(seedDir, { recursive: true });
  mkdirSync(skillsDir, { recursive: true });
  writeFileSync(path.join(seedDir, "workspace.duckdb"), "SEED_DB_CONTENT", "utf-8");
  writeFileSync(
    path.join(skillsDir, "SKILL.md"),
    "---\nname: database-crm-system\n---\n# Dench CRM\n",
    "utf-8",
  );
  return pkgRoot;
}

describe("seedWorkspaceFromAssets", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir();
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("seeds Dench skill inside the workspace (not in state dir)", () => {
    const packageRoot = createPackageRoot(tempDir);
    const workspaceDir = path.join(tempDir, "workspace-main");

    seedWorkspaceFromAssets({ workspaceDir, packageRoot });

    const skillPath = path.join(workspaceDir, "skills", "dench", "SKILL.md");
    expect(existsSync(skillPath)).toBe(true);
    expect(readFileSync(skillPath, "utf-8")).toContain("database-crm-system");

    const stateSkillPath = path.join(tempDir, "skills", "dench", "SKILL.md");
    expect(existsSync(stateSkillPath)).toBe(false);
  });

  it("generates IDENTITY.md referencing workspace CRM skill path (not virtual ~skills)", () => {
    const packageRoot = createPackageRoot(tempDir);
    const workspaceDir = path.join(tempDir, "workspace-test");

    seedWorkspaceFromAssets({ workspaceDir, packageRoot });

    const identityPath = path.join(workspaceDir, "IDENTITY.md");
    expect(existsSync(identityPath)).toBe(true);

    const identityContent = readFileSync(identityPath, "utf-8");
    expect(identityContent).toContain("Ironclaw");
    expect(identityContent).toContain(path.join(workspaceDir, "skills", "dench", "SKILL.md"));
    expect(identityContent).not.toContain("~skills/dench/SKILL.md");
  });

  it("IDENTITY.md references Ironclaw system prompt contract", () => {
    const packageRoot = createPackageRoot(tempDir);
    const workspaceDir = path.join(tempDir, "workspace-contract");

    seedWorkspaceFromAssets({ workspaceDir, packageRoot });

    const identityContent = readFileSync(path.join(workspaceDir, "IDENTITY.md"), "utf-8");
    expect(identityContent).toContain("Ironclaw system prompt contract");
  });

  it("creates CRM object projection files on first seed", () => {
    const packageRoot = createPackageRoot(tempDir);
    const workspaceDir = path.join(tempDir, "workspace-proj");

    const result = seedWorkspaceFromAssets({ workspaceDir, packageRoot });

    expect(result.seeded).toBe(true);
    expect(result.reason).toBe("seeded");
    expect(existsSync(path.join(workspaceDir, "people", ".object.yaml"))).toBe(true);
    expect(existsSync(path.join(workspaceDir, "company", ".object.yaml"))).toBe(true);
    expect(existsSync(path.join(workspaceDir, "task", ".object.yaml"))).toBe(true);
    expect(existsSync(path.join(workspaceDir, "WORKSPACE.md"))).toBe(true);
  });

  it("skips DuckDB seeding when workspace.duckdb already exists", () => {
    const packageRoot = createPackageRoot(tempDir);
    const workspaceDir = path.join(tempDir, "workspace-existing");
    mkdirSync(workspaceDir, { recursive: true });
    writeFileSync(path.join(workspaceDir, "workspace.duckdb"), "EXISTING_DB", "utf-8");

    const result = seedWorkspaceFromAssets({ workspaceDir, packageRoot });

    expect(result.seeded).toBe(false);
    expect(result.reason).toBe("already-exists");
    expect(readFileSync(path.join(workspaceDir, "workspace.duckdb"), "utf-8")).toBe("EXISTING_DB");
  });

  it("always force-syncs IDENTITY.md even when workspace already exists (keeps updates current)", () => {
    const packageRoot = createPackageRoot(tempDir);
    const workspaceDir = path.join(tempDir, "workspace-resync");
    mkdirSync(workspaceDir, { recursive: true });
    writeFileSync(path.join(workspaceDir, "workspace.duckdb"), "DB", "utf-8");
    writeFileSync(path.join(workspaceDir, "IDENTITY.md"), "# stale identity\n", "utf-8");

    seedWorkspaceFromAssets({ workspaceDir, packageRoot });

    const identityContent = readFileSync(path.join(workspaceDir, "IDENTITY.md"), "utf-8");
    expect(identityContent).toContain("Ironclaw");
    expect(identityContent).not.toContain("# stale identity");
  });

  it("includes skills/dench/SKILL.md in projection files list", () => {
    const packageRoot = createPackageRoot(tempDir);
    const workspaceDir = path.join(tempDir, "workspace-list");

    const result = seedWorkspaceFromAssets({ workspaceDir, packageRoot });

    expect(result.projectionFiles).toContain("skills/dench/SKILL.md");
    expect(result.projectionFiles).toContain("IDENTITY.md");
  });
});
