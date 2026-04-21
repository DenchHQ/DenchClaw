/**
 * Idempotent DuckDB schema migrations for the Gmail/Calendar onboarding.
 *
 * Reads existing rows from `objects` and `fields` and adds anything missing
 * — never drops or rewrites user-curated rows. Safe to call on first init
 * or on every web-app startup.
 *
 * For brand-new workspaces, `assets/seed/schema.sql` already includes the
 * full schema; this module exists for the (large) population of existing
 * `workspace.duckdb` files that pre-date the onboarding feature.
 */

import {
  duckdbExecAsync,
  duckdbExecOnFileAsync,
  duckdbQueryAsync,
  duckdbQueryOnFileAsync,
  duckdbPathAsync,
  findObjectDir,
  readObjectYaml,
  writeObjectYaml,
} from "./workspace";
import { SEED_OBJECT_IDS } from "./seed-object-ids";

// ---------------------------------------------------------------------------
// Object IDs (seed_*) — must stay stable so re-runs are idempotent.
// Single source of truth lives in `./seed-object-ids` so client components
// can compare relation `related_object_id`s without pulling in server deps.
// ---------------------------------------------------------------------------

const PEOPLE_OBJECT_ID = SEED_OBJECT_IDS.people;
const COMPANY_OBJECT_ID = SEED_OBJECT_IDS.company;
const EMAIL_THREAD_OBJECT_ID = SEED_OBJECT_IDS.email_thread;
const EMAIL_MESSAGE_OBJECT_ID = SEED_OBJECT_IDS.email_message;
const CALENDAR_EVENT_OBJECT_ID = SEED_OBJECT_IDS.calendar_event;
const INTERACTION_OBJECT_ID = SEED_OBJECT_IDS.interaction;

const SOURCE_ENUM_VALUES = '["Manual","Gmail","Calendar"]';
const SOURCE_ENUM_COLORS = '["#94a3b8","#ef4444","#3b82f6"]';

const SENDER_TYPE_ENUM_VALUES =
  '["Person","Marketing","Transactional","Notification","Mailing List","Automated"]';
const SENDER_TYPE_ENUM_COLORS =
  '["#22c55e","#ef4444","#3b82f6","#f59e0b","#8b5cf6","#94a3b8"]';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type FieldDef = {
  /** 32-char-ish stable ID, padded to fit existing seed_fld_* convention. */
  id: string;
  name: string;
  type:
    | "text"
    | "email"
    | "phone"
    | "url"
    | "richtext"
    | "number"
    | "date"
    | "boolean"
    | "enum"
    | "relation";
  required?: boolean;
  enumValues?: string;
  enumColors?: string;
  enumMultiple?: boolean;
  relatedObjectId?: string;
  relationshipType?: "many_to_one" | "many_to_many";
  sortOrder: number;
};

type ObjectDef = {
  id: string;
  name: string;
  description: string;
  icon: string;
  defaultView: "table" | "kanban" | "calendar" | "timeline" | "gallery" | "list";
  immutable?: boolean;
  sortOrder: number;
  fields: FieldDef[];
};

export type MigrationResult = {
  ok: boolean;
  workspaceDb: string | null;
  changedObjects: string[];
  addedFields: Array<{ object: string; field: string }>;
  recreatedViews: string[];
  error?: string;
};

// ---------------------------------------------------------------------------
// Field definitions — additions to existing objects
// ---------------------------------------------------------------------------

const PEOPLE_NEW_FIELDS: FieldDef[] = [
  {
    id: "seed_fld_people_source_00000000",
    name: "Source",
    type: "enum",
    enumValues: SOURCE_ENUM_VALUES,
    enumColors: SOURCE_ENUM_COLORS,
    sortOrder: 10,
  },
  {
    id: "seed_fld_people_strength_000000",
    name: "Strength Score",
    type: "number",
    sortOrder: 11,
  },
  {
    id: "seed_fld_people_lastinter_00000",
    name: "Last Interaction At",
    type: "date",
    sortOrder: 12,
  },
  {
    id: "seed_fld_people_jobtitle_000000",
    name: "Job Title",
    type: "text",
    sortOrder: 13,
  },
  {
    id: "seed_fld_people_linkedin_000000",
    name: "LinkedIn URL",
    type: "url",
    sortOrder: 14,
  },
  {
    id: "seed_fld_people_avatar_url_0000",
    name: "Avatar URL",
    type: "url",
    sortOrder: 15,
  },
];

const COMPANY_NEW_FIELDS: FieldDef[] = [
  {
    id: "seed_fld_company_source_0000000",
    name: "Source",
    type: "enum",
    enumValues: SOURCE_ENUM_VALUES,
    enumColors: SOURCE_ENUM_COLORS,
    sortOrder: 10,
  },
  {
    id: "seed_fld_company_domain_0000000",
    name: "Domain",
    type: "text",
    sortOrder: 11,
  },
  {
    id: "seed_fld_company_strength_00000",
    name: "Strength Score",
    type: "number",
    sortOrder: 12,
  },
  {
    id: "seed_fld_company_lastinter_0000",
    name: "Last Interaction At",
    type: "date",
    sortOrder: 13,
  },
];

// ---------------------------------------------------------------------------
// Object definitions — wholesale new tables
// ---------------------------------------------------------------------------

const NEW_OBJECTS: ObjectDef[] = [
  {
    id: EMAIL_THREAD_OBJECT_ID,
    name: "email_thread",
    description: "Email thread synced from Gmail",
    icon: "messages-square",
    defaultView: "table",
    immutable: true,
    sortOrder: 10,
    fields: [
      {
        id: "seed_fld_emthread_subject_0000",
        name: "Subject",
        type: "text",
        required: true,
        sortOrder: 0,
      },
      {
        id: "seed_fld_emthread_lastat_00000",
        name: "Last Message At",
        type: "date",
        sortOrder: 1,
      },
      {
        id: "seed_fld_emthread_count_000000",
        name: "Message Count",
        type: "number",
        sortOrder: 2,
      },
      {
        id: "seed_fld_emthread_people_00000",
        name: "Participants",
        type: "relation",
        relatedObjectId: PEOPLE_OBJECT_ID,
        relationshipType: "many_to_many",
        sortOrder: 3,
      },
      {
        id: "seed_fld_emthread_company_0000",
        name: "Companies",
        type: "relation",
        relatedObjectId: COMPANY_OBJECT_ID,
        relationshipType: "many_to_many",
        sortOrder: 4,
      },
      {
        id: "seed_fld_emthread_threadid_000",
        name: "Gmail Thread ID",
        type: "text",
        required: true,
        sortOrder: 5,
      },
    ],
  },
  {
    id: EMAIL_MESSAGE_OBJECT_ID,
    name: "email_message",
    description: "Single email message synced from Gmail",
    icon: "mail",
    defaultView: "table",
    immutable: true,
    sortOrder: 11,
    fields: [
      {
        id: "seed_fld_emmsg_subject_0000000",
        name: "Subject",
        type: "text",
        sortOrder: 0,
      },
      {
        id: "seed_fld_emmsg_sentat_000000000",
        name: "Sent At",
        type: "date",
        sortOrder: 1,
      },
      {
        id: "seed_fld_emmsg_from_00000000000",
        name: "From",
        type: "relation",
        relatedObjectId: PEOPLE_OBJECT_ID,
        relationshipType: "many_to_one",
        sortOrder: 2,
      },
      {
        id: "seed_fld_emmsg_to_0000000000000",
        name: "To",
        type: "relation",
        relatedObjectId: PEOPLE_OBJECT_ID,
        relationshipType: "many_to_many",
        sortOrder: 3,
      },
      {
        id: "seed_fld_emmsg_cc_0000000000000",
        name: "Cc",
        type: "relation",
        relatedObjectId: PEOPLE_OBJECT_ID,
        relationshipType: "many_to_many",
        sortOrder: 4,
      },
      {
        id: "seed_fld_emmsg_thread_000000000",
        name: "Thread",
        type: "relation",
        relatedObjectId: EMAIL_THREAD_OBJECT_ID,
        relationshipType: "many_to_one",
        sortOrder: 5,
      },
      {
        id: "seed_fld_emmsg_preview_00000000",
        name: "Body Preview",
        type: "text",
        sortOrder: 6,
      },
      {
        id: "seed_fld_emmsg_body_00000000000",
        name: "Body",
        type: "richtext",
        sortOrder: 7,
      },
      {
        id: "seed_fld_emmsg_attach_0000000000",
        name: "Has Attachments",
        type: "boolean",
        sortOrder: 8,
      },
      {
        id: "seed_fld_emmsg_msgid_0000000000",
        name: "Gmail Message ID",
        type: "text",
        required: true,
        sortOrder: 9,
      },
      {
        id: "seed_fld_emmsg_sndtype_00000000",
        name: "Sender Type",
        type: "enum",
        enumValues: SENDER_TYPE_ENUM_VALUES,
        enumColors: SENDER_TYPE_ENUM_COLORS,
        sortOrder: 10,
      },
    ],
  },
  {
    id: CALENDAR_EVENT_OBJECT_ID,
    name: "calendar_event",
    description: "Calendar event synced from Google Calendar",
    icon: "calendar",
    defaultView: "calendar",
    immutable: true,
    sortOrder: 12,
    fields: [
      {
        id: "seed_fld_calev_title_0000000000",
        name: "Title",
        type: "text",
        required: true,
        sortOrder: 0,
      },
      {
        id: "seed_fld_calev_start_0000000000",
        name: "Start At",
        type: "date",
        required: true,
        sortOrder: 1,
      },
      {
        id: "seed_fld_calev_end_000000000000",
        name: "End At",
        type: "date",
        sortOrder: 2,
      },
      {
        id: "seed_fld_calev_organ_0000000000",
        name: "Organizer",
        type: "relation",
        relatedObjectId: PEOPLE_OBJECT_ID,
        relationshipType: "many_to_one",
        sortOrder: 3,
      },
      {
        id: "seed_fld_calev_attend_000000000",
        name: "Attendees",
        type: "relation",
        relatedObjectId: PEOPLE_OBJECT_ID,
        relationshipType: "many_to_many",
        sortOrder: 4,
      },
      {
        id: "seed_fld_calev_company_00000000",
        name: "Companies",
        type: "relation",
        relatedObjectId: COMPANY_OBJECT_ID,
        relationshipType: "many_to_many",
        sortOrder: 5,
      },
      {
        id: "seed_fld_calev_meettype_0000000",
        name: "Meeting Type",
        type: "enum",
        enumValues: '["One on One","Small Group","Large Group"]',
        enumColors: '["#22c55e","#3b82f6","#94a3b8"]',
        sortOrder: 6,
      },
      {
        id: "seed_fld_calev_eventid_00000000",
        name: "Google Event ID",
        type: "text",
        required: true,
        sortOrder: 7,
      },
    ],
  },
  {
    id: INTERACTION_OBJECT_ID,
    name: "interaction",
    description: "Email or meeting between you and a contact (used for ranking)",
    icon: "activity",
    defaultView: "timeline",
    immutable: true,
    sortOrder: 13,
    fields: [
      {
        id: "seed_fld_inter_type_00000000000",
        name: "Type",
        type: "enum",
        enumValues: '["Email","Meeting"]',
        enumColors: '["#3b82f6","#22c55e"]',
        sortOrder: 0,
      },
      {
        id: "seed_fld_inter_occurred_0000000",
        name: "Occurred At",
        type: "date",
        required: true,
        sortOrder: 1,
      },
      {
        id: "seed_fld_inter_person_000000000",
        name: "Person",
        type: "relation",
        relatedObjectId: PEOPLE_OBJECT_ID,
        relationshipType: "many_to_one",
        sortOrder: 2,
      },
      {
        id: "seed_fld_inter_company_00000000",
        name: "Company",
        type: "relation",
        relatedObjectId: COMPANY_OBJECT_ID,
        relationshipType: "many_to_one",
        sortOrder: 3,
      },
      {
        id: "seed_fld_inter_email_0000000000",
        name: "Email",
        type: "relation",
        relatedObjectId: EMAIL_MESSAGE_OBJECT_ID,
        relationshipType: "many_to_one",
        sortOrder: 4,
      },
      {
        id: "seed_fld_inter_event_0000000000",
        name: "Event",
        type: "relation",
        relatedObjectId: CALENDAR_EVENT_OBJECT_ID,
        relationshipType: "many_to_one",
        sortOrder: 5,
      },
      {
        id: "seed_fld_inter_direction_000000",
        name: "Direction",
        type: "enum",
        enumValues: '["Sent","Received","Internal"]',
        enumColors: '["#22c55e","#3b82f6","#94a3b8"]',
        sortOrder: 6,
      },
      {
        id: "seed_fld_inter_score_0000000000",
        name: "Score Contribution",
        type: "number",
        sortOrder: 7,
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// SQL helpers
// ---------------------------------------------------------------------------

function escSql(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) {return "NULL";}
  if (typeof value === "boolean") {return value ? "true" : "false";}
  if (typeof value === "number") {return String(value);}
  return `'${value.replace(/'/g, "''")}'`;
}

function buildFieldInsertSql(objectId: string, def: FieldDef): string {
  const parts = [
    escSql(def.id),
    escSql(objectId),
    escSql(def.name),
    escSql(def.type),
    def.required === true ? "true" : "false",
    def.relatedObjectId ? escSql(def.relatedObjectId) : "NULL",
    def.relationshipType ? escSql(def.relationshipType) : "NULL",
    def.enumValues ? `${escSql(def.enumValues)}::JSON` : "NULL",
    def.enumColors ? `${escSql(def.enumColors)}::JSON` : "NULL",
    def.enumMultiple === true ? "true" : "false",
    String(def.sortOrder),
  ].join(", ");

  return `INSERT INTO fields (id, object_id, name, type, required, related_object_id, relationship_type, enum_values, enum_colors, enum_multiple, sort_order) VALUES (${parts});`;
}

function buildObjectInsertSql(def: ObjectDef): string {
  // Icon is intentionally NOT written here — it lives only in
  // `<objectDir>/.object.yaml` (single source of truth). `def.icon` is kept
  // on the type so the matching yaml seed in `ensureOnboardingObjectDirs`
  // can pick it up.
  const parts = [
    escSql(def.id),
    escSql(def.name),
    escSql(def.description),
    escSql(def.defaultView),
    def.immutable === true ? "true" : "false",
    String(def.sortOrder),
  ].join(", ");

  return `INSERT INTO objects (id, name, description, default_view, immutable, sort_order) VALUES (${parts});`;
}

function buildPivotViewSql(viewName: string, objectId: string, fieldNames: string[]): string {
  if (fieldNames.length === 0) {
    return `DROP VIEW IF EXISTS ${viewName};`;
  }
  const inList = fieldNames.map((name) => `'${name.replace(/'/g, "''")}'`).join(", ");
  return `CREATE OR REPLACE VIEW ${viewName} AS
PIVOT (
  SELECT e.id as entry_id, e.created_at, e.updated_at,
         f.name as field_name, ef.value
  FROM entries e
  JOIN entry_fields ef ON ef.entry_id = e.id
  JOIN fields f ON f.id = ef.field_id
  WHERE e.object_id = '${objectId}'
) ON field_name IN (${inList}) USING first(value);`;
}

// ---------------------------------------------------------------------------
// Introspection
// ---------------------------------------------------------------------------

async function fetchObjectIds(): Promise<Set<string>> {
  const rows = await duckdbQueryAsync<{ id: string }>(`SELECT id FROM objects;`);
  return new Set(rows.map((row) => row.id));
}

async function fetchFieldNames(objectId: string): Promise<Set<string>> {
  const safeId = objectId.replace(/'/g, "''");
  const rows = await duckdbQueryAsync<{ name: string }>(
    `SELECT name FROM fields WHERE object_id = '${safeId}';`,
  );
  return new Set(rows.map((row) => row.name));
}

async function fetchAllFieldNames(objectId: string): Promise<string[]> {
  const safeId = objectId.replace(/'/g, "''");
  const rows = await duckdbQueryAsync<{ name: string; sort_order: number | null }>(
    `SELECT name, sort_order FROM fields WHERE object_id = '${safeId}' ORDER BY sort_order, name;`,
  );
  return rows.map((row) => row.name);
}

// ---------------------------------------------------------------------------
// Per-object migrations
// ---------------------------------------------------------------------------

async function ensureFieldsForObject(
  dbPath: string,
  objectName: string,
  objectId: string,
  newFields: FieldDef[],
): Promise<{ added: string[] }> {
  const existing = await fetchFieldNames(objectId);
  const additions = newFields.filter((field) => !existing.has(field.name));
  if (additions.length === 0) {
    return { added: [] };
  }
  const sql = additions.map((def) => buildFieldInsertSql(objectId, def)).join("\n");
  const ok = await duckdbExecOnFileAsync(dbPath, sql);
  if (!ok) {
    throw new Error(`Failed to add ${additions.length} field(s) to ${objectName}.`);
  }
  return { added: additions.map((field) => field.name) };
}

async function ensureNewObject(
  dbPath: string,
  def: ObjectDef,
  existingObjectIds: Set<string>,
): Promise<{ created: boolean; addedFields: string[] }> {
  const exists = existingObjectIds.has(def.id);
  let created = false;
  if (!exists) {
    const ok = await duckdbExecOnFileAsync(dbPath, buildObjectInsertSql(def));
    if (!ok) {
      throw new Error(`Failed to create ${def.name} object.`);
    }
    created = true;
  }

  const added = await ensureFieldsForObject(dbPath, def.name, def.id, def.fields);
  return { created, addedFields: added.added };
}

// ---------------------------------------------------------------------------
// Public entry
// ---------------------------------------------------------------------------

const VIEW_NAMES: Array<{ object: string; objectId: string; viewName: string }> = [
  { object: "people", objectId: PEOPLE_OBJECT_ID, viewName: "v_people" },
  { object: "company", objectId: COMPANY_OBJECT_ID, viewName: "v_company" },
  { object: "email_thread", objectId: EMAIL_THREAD_OBJECT_ID, viewName: "v_email_thread" },
  { object: "email_message", objectId: EMAIL_MESSAGE_OBJECT_ID, viewName: "v_email_message" },
  { object: "calendar_event", objectId: CALENDAR_EVENT_OBJECT_ID, viewName: "v_calendar_event" },
  { object: "interaction", objectId: INTERACTION_OBJECT_ID, viewName: "v_interaction" },
];

/**
 * One-shot migration that retires the legacy `objects.icon` column.
 *
 * Icons are now stored only in `<objectDir>/.object.yaml`. For each row in
 * `objects` whose `icon` is non-null, copy the value into the matching yaml
 * (only if the yaml is missing one — yaml always wins on conflict). After
 * the copy, DROP the column. Both steps swallow errors so this stays
 * idempotent: re-running on a workspace whose column has already been
 * dropped (or whose yaml already has icons) is a no-op.
 */
async function migrateIconsFromDuckdbToYaml(dbPath: string): Promise<void> {
  let rows: Array<{ name: string; icon: string | null }> = [];
  try {
    rows = await duckdbQueryOnFileAsync<{ name: string; icon: string | null }>(
      dbPath,
      "SELECT name, icon FROM objects WHERE icon IS NOT NULL",
    );
  } catch {
    // Column already dropped (or table missing on a brand-new DB) — done.
    return;
  }

  for (const row of rows) {
    if (!row.icon || typeof row.icon !== "string") {continue;}
    const dir = findObjectDir(row.name);
    if (!dir) {continue;}
    const existing = readObjectYaml(dir) ?? {};
    if (typeof existing.icon === "string" && existing.icon.trim() !== "") {
      // Yaml already declares an icon — yaml wins, leave it alone.
      continue;
    }
    try {
      writeObjectYaml(dir, { icon: row.icon });
    } catch {
      // Skip — best effort. The user can edit yaml by hand if needed.
    }
  }

  try {
    await duckdbExecOnFileAsync(dbPath, "ALTER TABLE objects DROP COLUMN icon;");
  } catch {
    // Column may already be gone, or DuckDB may not support DROP COLUMN
    // on this version — non-fatal. The read paths no longer depend on it.
  }
}

/**
 * Stable seed IDs for fields that participate in one-shot type migrations.
 * Hard-coded here so the migration paths don't depend on `fetchFieldNames`
 * (which only resolves by name) and stay idempotent across re-runs.
 */
const PEOPLE_COMPANY_FIELD_ID = "seed_fld_people_company_0000000";
const COMPANY_DOMAIN_FIELD_ID = "seed_fld_company_domain_0000000";

/** Single-quote escape for inline SQL values. */
function sqlEsc(value: string): string {
  return value.replace(/'/g, "''");
}

/**
 * One-shot migration that converts `people.Company` from a `text` field
 * (storing the company name string) into a `relation` field pointing at
 * `company` (storing the company entry id). Idempotent: re-running on a
 * workspace where the field is already a relation is a no-op.
 *
 * After the type flip, existing text values are backfilled to company
 * entry ids by case-insensitive name match against `company.Company Name`.
 * Rows that don't match a known company are left untouched — sync will
 * overwrite them on the next run, or a user can clean them up by hand.
 */
async function migratePeopleCompanyToRelation(dbPath: string): Promise<void> {
  let typeRows: Array<{ type: string | null }> = [];
  try {
    typeRows = await duckdbQueryOnFileAsync<{ type: string | null }>(
      dbPath,
      `SELECT type FROM fields WHERE id = '${PEOPLE_COMPANY_FIELD_ID}'`,
    );
  } catch {
    return;
  }
  const currentType = typeRows[0]?.type;
  if (!currentType || currentType === "relation") {return;}

  const flipOk = await duckdbExecOnFileAsync(
    dbPath,
    `UPDATE fields SET type = 'relation', `
      + `related_object_id = '${COMPANY_OBJECT_ID}', `
      + `relationship_type = 'many_to_one' `
      + `WHERE id = '${PEOPLE_COMPANY_FIELD_ID}';`,
  );
  if (!flipOk) {return;}

  // Build a name → company entry id map from the company table.
  let companyRows: Array<{ entry_id: string; value: string | null }> = [];
  try {
    companyRows = await duckdbQueryOnFileAsync<{ entry_id: string; value: string | null }>(
      dbPath,
      `SELECT e.id AS entry_id, ef.value
         FROM entries e
         JOIN entry_fields ef ON ef.entry_id = e.id
         JOIN fields f ON f.id = ef.field_id
        WHERE e.object_id = '${COMPANY_OBJECT_ID}'
          AND f.name = 'Company Name'
          AND ef.value IS NOT NULL`,
    );
  } catch {
    return;
  }
  const companyEntryIds = new Set<string>();
  const companyByName = new Map<string, string>();
  for (const row of companyRows) {
    companyEntryIds.add(row.entry_id);
    if (!row.value) {continue;}
    const key = row.value.trim().toLowerCase();
    if (!key) {continue;}
    if (!companyByName.has(key)) {companyByName.set(key, row.entry_id);}
  }

  let peopleRows: Array<{ entry_id: string; value: string | null }> = [];
  try {
    peopleRows = await duckdbQueryOnFileAsync<{ entry_id: string; value: string | null }>(
      dbPath,
      `SELECT entry_id, value FROM entry_fields WHERE field_id = '${PEOPLE_COMPANY_FIELD_ID}'`,
    );
  } catch {
    return;
  }

  const updates: Array<{ entryId: string; companyId: string }> = [];
  for (const row of peopleRows) {
    if (!row.value) {continue;}
    // Already a company entry id (from a partial re-run); skip.
    if (companyEntryIds.has(row.value)) {continue;}
    const key = row.value.trim().toLowerCase();
    if (!key) {continue;}
    const cid = companyByName.get(key);
    if (cid) {updates.push({ entryId: row.entry_id, companyId: cid });}
  }
  if (updates.length === 0) {return;}

  const sqlParts = updates.map(
    (u) =>
      `UPDATE entry_fields SET value = '${sqlEsc(u.companyId)}' `
      + `WHERE field_id = '${PEOPLE_COMPANY_FIELD_ID}' `
      + `AND entry_id = '${sqlEsc(u.entryId)}';`,
  );
  await duckdbExecOnFileAsync(dbPath, sqlParts.join("\n"));
}

/**
 * One-shot migration that flips `company.Domain` from `text` to `url` so
 * the cell renders with the URL formatter (favicon, link preview hover)
 * once `normalizeUrl` is taught to accept bare domains. Idempotent: skips
 * if the field is already typed `url`.
 */
async function migrateCompanyDomainToUrl(dbPath: string): Promise<void> {
  let typeRows: Array<{ type: string | null }> = [];
  try {
    typeRows = await duckdbQueryOnFileAsync<{ type: string | null }>(
      dbPath,
      `SELECT type FROM fields WHERE id = '${COMPANY_DOMAIN_FIELD_ID}'`,
    );
  } catch {
    return;
  }
  const currentType = typeRows[0]?.type;
  if (!currentType || currentType === "url") {return;}

  await duckdbExecOnFileAsync(
    dbPath,
    `UPDATE fields SET type = 'url' WHERE id = '${COMPANY_DOMAIN_FIELD_ID}';`,
  );
}

/**
 * Apply all onboarding-related migrations against the active workspace's
 * DuckDB. Idempotent: returns details about anything actually changed.
 */
export async function ensureLatestSchema(): Promise<MigrationResult> {
  const dbPath = await duckdbPathAsync();
  if (!dbPath) {
    return {
      ok: false,
      workspaceDb: null,
      changedObjects: [],
      addedFields: [],
      recreatedViews: [],
      error: "No workspace database found.",
    };
  }

  const result: MigrationResult = {
    ok: true,
    workspaceDb: dbPath,
    changedObjects: [],
    addedFields: [],
    recreatedViews: [],
  };

  try {
    // ── 0. Schema columns that are new since v1 ───────────────────────────
    // `hidden_in_sidebar` lets the workspace tree skip CRM-only objects
    // (email_thread, email_message, calendar_event, interaction) that have
    // dedicated UI. Idempotent: ALTER TABLE … ADD COLUMN IF NOT EXISTS.
    const columnSql = [
      `ALTER TABLE objects ADD COLUMN IF NOT EXISTS hidden_in_sidebar BOOLEAN DEFAULT false;`,
      `UPDATE objects SET hidden_in_sidebar = true WHERE name IN (`
        + `'email_thread', 'email_message', 'calendar_event', 'interaction'`
        + `) AND (hidden_in_sidebar IS NULL OR hidden_in_sidebar = false);`,
    ].join("\n");
    const colsOk = await duckdbExecOnFileAsync(dbPath, columnSql);
    if (!colsOk) {
      // Non-fatal — table doesn't exist yet on a brand-new DB; the seed
      // schema already includes the column.
    }

    // ── 0b. Retire the legacy `objects.icon` column ───────────────────────
    // Icons now live exclusively in `<objectDir>/.object.yaml`. For any
    // existing workspace where the column still has data, copy each
    // non-null icon into yaml first (only if yaml is missing one), then
    // DROP the column. Idempotent: a workspace whose column is already
    // dropped silently no-ops.
    await migrateIconsFromDuckdbToYaml(dbPath);

    // ── 0c. Convert `people.Company` from text → relation ─────────────────
    // Existing workspaces stored the company name as text on the people
    // object. Flip the field type to a many_to_one relation pointing at
    // the company object and backfill text values to company entry ids by
    // case-insensitive name match. Sync writes (Gmail/Calendar) emit ids
    // going forward. Idempotent.
    await migratePeopleCompanyToRelation(dbPath);

    // ── 0d. Flip `company.Domain` from text → url ─────────────────────────
    // Lets the URL cell formatter (favicon + link preview) render the
    // column once `normalizeUrl` accepts bare domains. Idempotent.
    await migrateCompanyDomainToUrl(dbPath);

    const existingObjectIds = await fetchObjectIds();

    // Existing-object field additions
    const peopleAdditions = await ensureFieldsForObject(
      dbPath,
      "people",
      PEOPLE_OBJECT_ID,
      PEOPLE_NEW_FIELDS,
    );
    if (peopleAdditions.added.length > 0) {
      result.changedObjects.push("people");
      for (const field of peopleAdditions.added) {
        result.addedFields.push({ object: "people", field });
      }
    }

    const companyAdditions = await ensureFieldsForObject(
      dbPath,
      "company",
      COMPANY_OBJECT_ID,
      COMPANY_NEW_FIELDS,
    );
    if (companyAdditions.added.length > 0) {
      result.changedObjects.push("company");
      for (const field of companyAdditions.added) {
        result.addedFields.push({ object: "company", field });
      }
    }

    // New objects
    for (const def of NEW_OBJECTS) {
      const out = await ensureNewObject(dbPath, def, existingObjectIds);
      if (out.created) {
        result.changedObjects.push(def.name);
      }
      for (const field of out.addedFields) {
        result.addedFields.push({ object: def.name, field });
      }
    }

    // Views — always rebuild so they reflect the current set of fields.
    const viewSqlParts: string[] = [];
    for (const view of VIEW_NAMES) {
      const fieldNames = await fetchAllFieldNames(view.objectId);
      if (fieldNames.length === 0) {
        continue;
      }
      viewSqlParts.push(buildPivotViewSql(view.viewName, view.objectId, fieldNames));
      result.recreatedViews.push(view.viewName);
    }
    if (viewSqlParts.length > 0) {
      const ok = await duckdbExecOnFileAsync(dbPath, viewSqlParts.join("\n"));
      if (!ok) {
        // Non-fatal — schema is fine without views, but flag it.
        result.error = "View regeneration failed; schema is intact but v_* views may be stale.";
      }
    }

    return result;
  } catch (err) {
    result.ok = false;
    result.error = err instanceof Error ? err.message : String(err);
    return result;
  }
}

// ---------------------------------------------------------------------------
// Helpers exported for the sync pipeline
// ---------------------------------------------------------------------------

export const ONBOARDING_OBJECT_IDS = {
  people: PEOPLE_OBJECT_ID,
  company: COMPANY_OBJECT_ID,
  email_thread: EMAIL_THREAD_OBJECT_ID,
  email_message: EMAIL_MESSAGE_OBJECT_ID,
  calendar_event: CALENDAR_EVENT_OBJECT_ID,
  interaction: INTERACTION_OBJECT_ID,
} as const;

/**
 * Fetch a map of `{ field name → field id }` for an object so the sync
 * pipeline can do `INSERT INTO entry_fields (entry_id, field_id, value)`
 * without re-querying for every row.
 */
export async function fetchFieldIdMap(objectId: string): Promise<Record<string, string>> {
  const safeId = objectId.replace(/'/g, "''");
  const rows = await duckdbQueryAsync<{ id: string; name: string }>(
    `SELECT id, name FROM fields WHERE object_id = '${safeId}';`,
  );
  const out: Record<string, string> = {};
  for (const row of rows) {
    out[row.name] = row.id;
  }
  return out;
}

/** Convenience: drop in DDL to ensure schema before any sync work. */
export async function runIdempotentMigrations(): Promise<MigrationResult> {
  // Touch the duckdb path through the standard helper so we honour
  // OPENCLAW_WORKSPACE / active workspace overrides.
  void (await duckdbExecAsync(`SELECT 1;`));
  return ensureLatestSchema();
}
