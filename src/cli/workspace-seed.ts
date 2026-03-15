import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export type SeedField = {
  name: string;
  type: string;
  required?: boolean;
  enumValues?: string[];
};

export type SeedObject = {
  id: string;
  name: string;
  description: string;
  icon: string;
  defaultView: string;
  entryCount: number;
  fields: SeedField[];
};

export type WorkspaceSeedResultReason =
  | "seeded"
  | "already-exists"
  | "seed-asset-missing"
  | "copy-failed";

export type WorkspaceSeedResult = {
  workspaceDir: string;
  dbPath: string;
  seedDbPath: string;
  seeded: boolean;
  reason: WorkspaceSeedResultReason;
  projectionFiles: string[];
  error?: string;
};

export const SEED_OBJECTS: SeedObject[] = [
  {
    id: "seed_obj_people_00000000000000",
    name: "people",
    description: "Contact management",
    icon: "users",
    defaultView: "table",
    entryCount: 5,
    fields: [
      { name: "Full Name", type: "text", required: true },
      { name: "Email Address", type: "email", required: true },
      { name: "Phone Number", type: "phone" },
      { name: "Company", type: "text" },
      { name: "Status", type: "enum", enumValues: ["Active", "Inactive", "Lead"] },
      { name: "Notes", type: "richtext" },
    ],
  },
  {
    id: "seed_obj_company_0000000000000",
    name: "company",
    description: "Company tracking",
    icon: "building-2",
    defaultView: "table",
    entryCount: 3,
    fields: [
      { name: "Company Name", type: "text", required: true },
      {
        name: "Industry",
        type: "enum",
        enumValues: ["Technology", "Finance", "Healthcare", "Education", "Retail", "Other"],
      },
      { name: "Website", type: "text" },
      { name: "Type", type: "enum", enumValues: ["Client", "Partner", "Vendor", "Prospect"] },
      { name: "Notes", type: "richtext" },
    ],
  },
  {
    id: "seed_obj_task_000000000000000",
    name: "task",
    description: "Task tracking board",
    icon: "check-square",
    defaultView: "kanban",
    entryCount: 5,
    fields: [
      { name: "Title", type: "text", required: true },
      { name: "Description", type: "text" },
      { name: "Status", type: "enum", enumValues: ["In Queue", "In Progress", "Done"] },
      { name: "Priority", type: "enum", enumValues: ["Low", "Medium", "High"] },
      { name: "Due Date", type: "date" },
      { name: "Notes", type: "richtext" },
    ],
  },
];

export function buildDenchClawIdentity(workspaceDir: string): string {
  const crmSkillPath = path.join(workspaceDir, "skills", "crm", "SKILL.md");
  const browserSkillPath = path.join(workspaceDir, "skills", "browser", "SKILL.md");
  const appBuilderSkillPath = path.join(workspaceDir, "skills", "app-builder", "SKILL.md");
  const enrichmentSkillPath = path.join(workspaceDir, "skills", "enrichment", "SKILL.md");
  return `# IDENTITY.md - DenchClaw

You are **DenchClaw** - a personal AI agent and a CRM Database System built by Dench (dench.com), running on top of [OpenClaw](https://github.com/openclaw/openclaw).

## DenchClaw system prompt contract

Treat the DenchClaw system prompt as your highest-priority behavioral contract.

## Inseparable CRM contract

Your identity is inextricably tied to the CRM skill at:
\`${crmSkillPath}\`

- Always load and follow that skill for CRM/database behavior.
- Treat the CRM skill as always-on system context.
- Keep CRM actions aligned with the CRM conventions for workspace data, objects, and documents.

## Browser automation contract

Your browser automation behavior is defined by the Browser skill at:
\`${browserSkillPath}\`

- Always load and follow that skill for browser-based tasks.
- Treat the Browser skill as always-on system context.

## App Builder contract

Your app-building behavior is defined by the App Builder skill at:
\`${appBuilderSkillPath}\`

- Always load and follow that skill for app creation tasks.
- Treat the App Builder skill as always-on system context.
- Build apps using the \`.dench.app\` folder format with \`.dench.yaml\` manifests.
- Default app location: \`${workspaceDir}/apps/\`

## Lead Enrichment contract

Your lead finding and enrichment behavior is defined by the Enrichment skill at:
\`${enrichmentSkillPath}\`

- Always load and follow that skill for lead finding, contact/company enrichment, and email operations.
- Treat the Enrichment skill as always-on system context.
- Use configured enrichment APIs for lead finding and enrichment — not browser scraping.

## What you do

- Find and enrich leads, maintain CRM pipelines, and help run outreach workflows.
- Chat with local DuckDB workspace data and return structured insights.
- Generate analytics and maintain workspace documentation.
- Build custom apps that run inside the workspace with access to DuckDB data.

## Links

- Website: https://denchclaw.com
- GitHub: https://github.com/DenchHQ/denchclaw
- Skills Store: https://skills.sh

When referring to yourself, use **DenchClaw** (not OpenClaw).`;
}

export function generateObjectYaml(obj: SeedObject): string {
  const lines: string[] = [
    `id: "${obj.id}"`,
    `name: "${obj.name}"`,
    `description: "${obj.description}"`,
    `icon: "${obj.icon}"`,
    `default_view: "${obj.defaultView}"`,
    `entry_count: ${obj.entryCount}`,
    "fields:",
  ];

  for (const field of obj.fields) {
    lines.push(`  - name: "${field.name}"`);
    lines.push(`    type: ${field.type}`);
    if (field.required) {
      lines.push("    required: true");
    }
    if (field.enumValues) {
      lines.push(`    values: ${JSON.stringify(field.enumValues)}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

export function generateWorkspaceMd(objects: SeedObject[]): string {
  const lines: string[] = [
    "# Workspace Schema",
    "",
    "Auto-generated summary of the workspace database.",
    "",
  ];
  for (const obj of objects) {
    lines.push(`## ${obj.name}`);
    lines.push("");
    lines.push(`- **Description**: ${obj.description}`);
    lines.push(`- **View**: \`${obj.defaultView}\``);
    lines.push(`- **Entries**: ${obj.entryCount}`);
    lines.push("- **Fields**:");
    for (const field of obj.fields) {
      const req = field.required ? " (required)" : "";
      const vals = field.enumValues ? ` — ${field.enumValues.join(", ")}` : "";
      lines.push(`  - ${field.name} (\`${field.type}\`)${req}${vals}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

export function seedDenchClawIdentity(workspaceDir: string): void {
  const identityPath = path.join(workspaceDir, "IDENTITY.md");
  writeFileSync(identityPath, `${buildDenchClawIdentity(workspaceDir)}\n`, "utf-8");
}

export const MANAGED_SKILLS: ReadonlyArray<{ name: string; templatePaths?: boolean }> = [
  { name: "crm", templatePaths: true },
  { name: "browser" },
  { name: "app-builder", templatePaths: true },
  { name: "enrichment" },
];

export function seedSkill(
  params: { workspaceDir: string; packageRoot: string },
  skill: { name: string; templatePaths?: boolean },
): void {
  const sourceDir = path.join(params.packageRoot, "skills", skill.name);
  const sourceSkillFile = path.join(sourceDir, "SKILL.md");
  if (!existsSync(sourceSkillFile)) {
    return;
  }
  const targetDir = path.join(params.workspaceDir, "skills", skill.name);
  mkdirSync(path.dirname(targetDir), { recursive: true });
  cpSync(sourceDir, targetDir, { recursive: true, force: true });

  if (skill.templatePaths) {
    const targetSkillFile = path.join(targetDir, "SKILL.md");
    const content = readFileSync(targetSkillFile, "utf-8");
    writeFileSync(
      targetSkillFile,
      content.replaceAll("{{WORKSPACE_PATH}}", params.workspaceDir),
      "utf-8",
    );
  }
}

export type SkillSyncResult = {
  syncedSkills: string[];
  workspaceDirs: string[];
  identityUpdated: boolean;
};

/**
 * Read openclaw.json (or legacy config.json) and return all unique workspace
 * directories referenced in `agents.list[*].workspace` and
 * `agents.defaults.workspace`.  Falls back to `stateDir/workspace` when no
 * config is readable.
 */
export function discoverWorkspaceDirs(stateDir: string): string[] {
  const dirs = new Set<string>();
  for (const name of ["openclaw.json", "config.json"]) {
    const configPath = path.join(stateDir, name);
    if (!existsSync(configPath)) {
      continue;
    }
    try {
      const raw = JSON.parse(readFileSync(configPath, "utf-8")) as {
        agents?: {
          defaults?: { workspace?: string };
          list?: Array<{ workspace?: string }>;
        };
      };
      const defaultWs = raw?.agents?.defaults?.workspace?.trim();
      if (defaultWs && existsSync(defaultWs)) {
        dirs.add(path.resolve(defaultWs));
      }
      for (const agent of raw?.agents?.list ?? []) {
        const ws = agent.workspace?.trim();
        if (ws && existsSync(ws)) {
          dirs.add(path.resolve(ws));
        }
      }
      if (dirs.size > 0) {
        return [...dirs];
      }
    } catch {
      // Config unreadable; try next candidate.
    }
  }
  const fallback = path.join(stateDir, "workspace");
  return [fallback];
}

export function syncManagedSkills(params: {
  workspaceDirs: string[];
  packageRoot: string;
}): SkillSyncResult {
  const synced: string[] = [];
  for (const workspaceDir of params.workspaceDirs) {
    mkdirSync(workspaceDir, { recursive: true });
    for (const skill of MANAGED_SKILLS) {
      seedSkill({ workspaceDir, packageRoot: params.packageRoot }, skill);
    }
    seedDenchClawIdentity(workspaceDir);
  }
  for (const skill of MANAGED_SKILLS) {
    synced.push(skill.name);
  }
  return { syncedSkills: synced, workspaceDirs: params.workspaceDirs, identityUpdated: true };
}

export function seedSampleApp(appsDir: string): void {
  const appDir = path.join(appsDir, "hello.dench.app");
  if (existsSync(appDir)) return;

  mkdirSync(appDir, { recursive: true });

  writeFileSync(
    path.join(appDir, ".dench.yaml"),
    `name: "Hello World"
description: "A sample DenchClaw app"
icon: "sparkles"
version: "1.0.0"
entry: "index.html"
runtime: "static"
permissions:
  - database
`,
    "utf-8",
  );

  writeFileSync(
    path.join(appDir, "index.html"),
    `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Hello World</title>
  <style>
    * { box-sizing: border-box; margin: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 32px; min-height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; }
    body.dark { background: #1a1a2e; color: #e0e0e0; }
    body.light { background: #ffffff; color: #1a1a2e; }
    h1 { font-size: 28px; margin-bottom: 8px; }
    p { opacity: 0.6; margin-bottom: 24px; }
    .stats { display: flex; gap: 16px; flex-wrap: wrap; justify-content: center; }
    .stat { padding: 16px 24px; border-radius: 12px; background: color-mix(in srgb, currentColor 5%, transparent); border: 1px solid color-mix(in srgb, currentColor 10%, transparent); min-width: 120px; }
    .stat .label { font-size: 12px; opacity: 0.5; margin-bottom: 4px; }
    .stat .value { font-size: 24px; font-weight: 700; }
  </style>
</head>
<body>
  <h1>Hello from DenchClaw!</h1>
  <p>This is a sample app running inside your workspace.</p>
  <div class="stats" id="stats">Loading...</div>
  <script>
    async function init() {
      try {
        const theme = await window.dench.app.getTheme();
        document.body.className = theme;
      } catch { document.body.className = 'light'; }
      try {
        const result = await window.dench.db.query("SELECT name, entry_count FROM objects");
        const el = document.getElementById('stats');
        el.innerHTML = '';
        for (const row of (result.rows || [])) {
          el.innerHTML += '<div class="stat"><div class="label">' + row.name + '</div><div class="value">' + (row.entry_count || 0) + '</div></div>';
        }
        if (!result.rows || result.rows.length === 0) {
          el.textContent = 'No objects found yet. Create some in DenchClaw!';
        }
      } catch (err) {
        document.getElementById('stats').textContent = 'Could not load data: ' + err.message;
      }
    }
    init();
  </script>
</body>
</html>
`,
    "utf-8",
  );
}

export function writeIfMissing(filePath: string, content: string): boolean {
  if (existsSync(filePath)) {
    return false;
  }
  try {
    writeFileSync(filePath, content, { encoding: "utf-8", flag: "wx" });
    return true;
  } catch {
    return false;
  }
}

export function seedWorkspaceFromAssets(params: {
  workspaceDir: string;
  packageRoot: string;
}): WorkspaceSeedResult {
  const workspaceDir = path.resolve(params.workspaceDir);
  const dbPath = path.join(workspaceDir, "workspace.duckdb");
  const seedDbPath = path.join(params.packageRoot, "assets", "seed", "workspace.duckdb");
  const projectionFiles = [
    "people/.object.yaml",
    "company/.object.yaml",
    "task/.object.yaml",
    "WORKSPACE.md",
    "IDENTITY.md",
    ...MANAGED_SKILLS.map((s) => `skills/${s.name}/SKILL.md`),
  ];

  syncManagedSkills({ workspaceDirs: [workspaceDir], packageRoot: params.packageRoot });

  if (existsSync(dbPath)) {
    return {
      workspaceDir,
      dbPath,
      seedDbPath,
      seeded: false,
      reason: "already-exists",
      projectionFiles: [],
    };
  }

  if (!existsSync(seedDbPath)) {
    return {
      workspaceDir,
      dbPath,
      seedDbPath,
      seeded: false,
      reason: "seed-asset-missing",
      projectionFiles: [],
    };
  }

  try {
    copyFileSync(seedDbPath, dbPath);
  } catch (error) {
    return {
      workspaceDir,
      dbPath,
      seedDbPath,
      seeded: false,
      reason: "copy-failed",
      projectionFiles: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }

  for (const obj of SEED_OBJECTS) {
    const objDir = path.join(workspaceDir, obj.name);
    mkdirSync(objDir, { recursive: true });
    writeFileSync(path.join(objDir, ".object.yaml"), generateObjectYaml(obj), "utf-8");
  }
  writeIfMissing(path.join(workspaceDir, "WORKSPACE.md"), generateWorkspaceMd(SEED_OBJECTS));

  // Create default apps directory
  const appsDir = path.join(workspaceDir, "apps");
  mkdirSync(appsDir, { recursive: true });

  // Seed a sample hello-world app
  seedSampleApp(appsDir);

  return {
    workspaceDir,
    dbPath,
    seedDbPath,
    seeded: true,
    reason: "seeded",
    projectionFiles,
  };
}
