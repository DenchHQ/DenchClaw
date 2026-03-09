import {
  duckdbPathAsync,
  parseRelationValue,
  resolveDuckdbBin,
  findDuckDBForObjectAsync,
  duckdbQueryOnFileAsync,
  discoverDuckDBPathsAsync,
  getObjectViews,
  duckdbExecOnFileAsync,
} from "./workspace";
import { deserializeFilters, buildWhereClause, buildOrderByClause, type FieldMeta } from "./object-filters";
import type { ReverseRelation, WorkspaceObjectData } from "./workspace-shell-types";

type ObjectRow = {
  id: string;
  name: string;
  description?: string;
  icon?: string;
  default_view?: string;
  display_field?: string;
  immutable?: boolean;
  created_at?: string;
  updated_at?: string;
};

type FieldRow = {
  id: string;
  name: string;
  type: string;
  description?: string;
  required?: boolean;
  enum_values?: string;
  enum_colors?: string;
  enum_multiple?: boolean;
  related_object_id?: string;
  relationship_type?: string;
  sort_order?: number;
};

type StatusRow = {
  id: string;
  name: string;
  color?: string;
  sort_order?: number;
  is_default?: boolean;
};

type EavRow = {
  entry_id: string;
  created_at: string;
  updated_at: string;
  field_name: string;
  value: string | null;
};

export type WorkspaceObjectDataResult =
  | { ok: true; data: WorkspaceObjectData }
  | { ok: false; status: number; error: string; code?: string };

const migratedDbs = new Map<string, Promise<void>>();

async function ensureDisplayFieldColumn(dbFile: string): Promise<void> {
  const existing = migratedDbs.get(dbFile);
  if (existing) {return existing;}
  const promise = duckdbExecOnFileAsync(
    dbFile,
    "ALTER TABLE objects ADD COLUMN IF NOT EXISTS display_field VARCHAR",
  ).then(() => undefined);
  migratedDbs.set(dbFile, promise);
  return promise;
}

async function q<T = Record<string, unknown>>(dbFile: string, sql: string): Promise<T[]> {
  return duckdbQueryOnFileAsync<T>(dbFile, sql);
}

function pivotEavRows(rows: EavRow[]): Record<string, unknown>[] {
  const grouped = new Map<string, Record<string, unknown>>();

  for (const row of rows) {
    let entry = grouped.get(row.entry_id);
    if (!entry) {
      entry = {
        entry_id: row.entry_id,
        created_at: row.created_at,
        updated_at: row.updated_at,
      };
      grouped.set(row.entry_id, entry);
    }
    if (row.field_name) {
      entry[row.field_name] = row.value;
    }
  }

  return Array.from(grouped.values());
}

function tryParseJson(value: unknown): unknown {
  if (typeof value !== "string") {return value;}
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function sqlEscape(s: string): string {
  return s.replace(/'/g, "''");
}

function resolveDisplayField(
  obj: ObjectRow,
  objFields: FieldRow[],
): string {
  if (obj.display_field) {return obj.display_field;}

  const nameField = objFields.find(
    (f) =>
      /\bname\b/i.test(f.name) || /\btitle\b/i.test(f.name),
  );
  if (nameField) {return nameField.name;}

  const textField = objFields.find((f) => f.type === "text");
  if (textField) {return textField.name;}

  return objFields[0]?.name ?? "id";
}

async function resolveRelationLabels(
  dbFile: string,
  fields: FieldRow[],
  entries: Record<string, unknown>[],
): Promise<{
  labels: Record<string, Record<string, string>>;
  relatedObjectNames: Record<string, string>;
}> {
  const labels: Record<string, Record<string, string>> = {};
  const relatedObjectNames: Record<string, string> = {};

  const relationFields = fields.filter(
    (f) => f.type === "relation" && f.related_object_id,
  );

  for (const rf of relationFields) {
    const relatedObjs = await q<ObjectRow>(dbFile,
      `SELECT * FROM objects WHERE id = '${sqlEscape(rf.related_object_id!)}' LIMIT 1`,
    );
    if (relatedObjs.length === 0) {continue;}
    const relObj = relatedObjs[0];
    relatedObjectNames[rf.name] = relObj.name;

    const relFields = await q<FieldRow>(dbFile,
      `SELECT * FROM fields WHERE object_id = '${sqlEscape(relObj.id)}' ORDER BY sort_order`,
    );
    const displayFieldName = resolveDisplayField(relObj, relFields);

    const entryIds = new Set<string>();
    for (const entry of entries) {
      const val = entry[rf.name];
      if (val == null || val === "") {
        continue;
      }
      const valStr =
        typeof val === "object" && val !== null
          ? JSON.stringify(val)
          : typeof val === "string"
            ? val
            : typeof val === "number" || typeof val === "boolean"
              ? String(val)
              : "";
      for (const id of parseRelationValue(valStr)) {
        entryIds.add(id);
      }
    }

    if (entryIds.size === 0) {
      labels[rf.name] = {};
      continue;
    }

    const idList = Array.from(entryIds)
      .map((id) => `'${sqlEscape(id)}'`)
      .join(",");
    const displayRows = await q<{ entry_id: string; value: string }>(dbFile,
      `SELECT e.id as entry_id, ef.value
       FROM entries e
       JOIN entry_fields ef ON ef.entry_id = e.id
       JOIN fields f ON f.id = ef.field_id
       WHERE e.id IN (${idList})
       AND f.object_id = '${sqlEscape(relObj.id)}'
       AND f.name = '${sqlEscape(displayFieldName)}'`,
    );

    const labelMap: Record<string, string> = {};
    for (const row of displayRows) {
      labelMap[row.entry_id] = row.value || row.entry_id;
    }
    for (const id of entryIds) {
      if (!labelMap[id]) {labelMap[id] = id;}
    }

    labels[rf.name] = labelMap;
  }

  return { labels, relatedObjectNames };
}

async function findReverseRelations(objectId: string): Promise<ReverseRelation[]> {
  const dbPaths = await discoverDuckDBPathsAsync();
  const result: ReverseRelation[] = [];

  for (const db of dbPaths) {
    const reverseFields = await q<
      FieldRow & { source_object_id: string; source_object_name: string }
    >(db,
      `SELECT f.*, f.object_id as source_object_id, o.name as source_object_name
       FROM fields f
       JOIN objects o ON o.id = f.object_id
       WHERE f.type = 'relation'
       AND f.related_object_id = '${sqlEscape(objectId)}'`,
    );

    for (const rrf of reverseFields) {
      const sourceObjs = await q<ObjectRow>(db,
        `SELECT * FROM objects WHERE id = '${sqlEscape(rrf.source_object_id)}' LIMIT 1`,
      );
      if (sourceObjs.length === 0) {continue;}

      const sourceFields = await q<FieldRow>(db,
        `SELECT * FROM fields WHERE object_id = '${sqlEscape(rrf.source_object_id)}' ORDER BY sort_order`,
      );
      const displayFieldName = resolveDisplayField(sourceObjs[0], sourceFields);

      const refRows = await q<{ source_entry_id: string; target_value: string }>(db,
        `SELECT ef.entry_id as source_entry_id, ef.value as target_value
         FROM entry_fields ef
         WHERE ef.field_id = '${sqlEscape(rrf.id)}'
         AND ef.value IS NOT NULL
         AND ef.value != ''`,
      );

      if (refRows.length === 0) {continue;}

      const sourceEntryIds = [...new Set(refRows.map((r) => r.source_entry_id))];
      const idList = sourceEntryIds.map((id) => `'${sqlEscape(id)}'`).join(",");
      const displayRows = await q<{ entry_id: string; value: string }>(db,
        `SELECT ef.entry_id, ef.value
         FROM entry_fields ef
         JOIN fields f ON f.id = ef.field_id
         WHERE ef.entry_id IN (${idList})
         AND f.name = '${sqlEscape(displayFieldName)}'
         AND f.object_id = '${sqlEscape(rrf.source_object_id)}'`,
      );

      const displayMap: Record<string, string> = {};
      for (const row of displayRows) {
        displayMap[row.entry_id] = row.value || row.entry_id;
      }

      const entriesMap: Record<string, Array<{ id: string; label: string }>> = {};
      for (const row of refRows) {
        const targetIds = parseRelationValue(row.target_value);
        for (const targetId of targetIds) {
          if (!entriesMap[targetId]) {entriesMap[targetId] = [];}
          entriesMap[targetId].push({
            id: row.source_entry_id,
            label: displayMap[row.source_entry_id] || row.source_entry_id,
          });
        }
      }

      result.push({
        fieldName: rrf.name,
        sourceObjectName: rrf.source_object_name,
        sourceObjectId: rrf.source_object_id,
        displayField: displayFieldName,
        entries: entriesMap,
      });
    }
  }

  return result;
}

export function isValidWorkspaceObjectName(name: string): boolean {
  return /^[a-zA-Z_][a-zA-Z0-9_-]*$/.test(name);
}

function normalizeObjectSearchParams(
  input?: URLSearchParams | string | URL,
): URLSearchParams {
  if (!input) {return new URLSearchParams();}
  if (typeof input === "string") {return new URLSearchParams(input);}
  if (input instanceof URL) {return input.searchParams;}
  return input;
}

export async function getWorkspaceObjectData(
  name: string,
  input?: URLSearchParams | string | URL,
): Promise<WorkspaceObjectDataResult> {
  if (!resolveDuckdbBin()) {
    return {
      ok: false,
      status: 503,
      error: "DuckDB CLI is not installed",
      code: "DUCKDB_NOT_INSTALLED",
    };
  }

  if (!isValidWorkspaceObjectName(name)) {
    return {
      ok: false,
      status: 400,
      error: "Invalid object name",
    };
  }

  const dbFile = await findDuckDBForObjectAsync(name);
  if (!dbFile) {
    if (!await duckdbPathAsync()) {
      return {
        ok: false,
        status: 404,
        error: "DuckDB database not found",
      };
    }
    return {
      ok: false,
      status: 404,
      error: `Object '${name}' not found`,
    };
  }

  await ensureDisplayFieldColumn(dbFile);

  const objects = await q<ObjectRow>(dbFile,
    `SELECT * FROM objects WHERE name = '${name}' LIMIT 1`,
  );

  if (objects.length === 0) {
    return {
      ok: false,
      status: 404,
      error: `Object '${name}' not found`,
    };
  }

  const obj = objects[0];

  const fields = await q<FieldRow>(
    dbFile,
    `SELECT * FROM fields WHERE object_id = '${obj.id}' ORDER BY sort_order`,
  );
  const statuses = await q<StatusRow>(
    dbFile,
    `SELECT * FROM statuses WHERE object_id = '${obj.id}' ORDER BY sort_order`,
  );

  const params = normalizeObjectSearchParams(input);
  const filtersParam = params.get("filters");
  const sortParam = params.get("sort");
  const searchParam = params.get("search");
  const pageParam = params.get("page");
  const pageSizeParam = params.get("pageSize");

  const filterGroup = filtersParam ? deserializeFilters(filtersParam) : undefined;
  const fieldsMeta: FieldMeta[] = fields.map((f) => ({ name: f.name, type: f.type }));

  let whereClause = "";
  if (filterGroup) {
    const where = buildWhereClause(filterGroup, fieldsMeta);
    if (where) {whereClause = ` WHERE ${where}`;}
  }

  let orderByClause = " ORDER BY created_at DESC, entry_id DESC";
  if (sortParam) {
    try {
      const sortRules = JSON.parse(sortParam);
      const orderBy = buildOrderByClause(sortRules);
      if (orderBy) {orderByClause = ` ORDER BY ${orderBy}, entry_id DESC`;}
    } catch {
      // keep default sort
    }
  }

  const page = Math.max(1, Number(pageParam) || 1);
  const pageSize = Math.min(5000, Math.max(1, Number(pageSizeParam) || 100));
  const offset = (page - 1) * pageSize;
  const limitClause = ` LIMIT ${pageSize} OFFSET ${offset}`;

  if (searchParam && searchParam.trim()) {
    const textFields = fields.filter((f) => ["text", "richtext", "email"].includes(f.type));
    if (textFields.length > 0) {
      const searchConditions = textFields
        .map((f) => `LOWER(CAST("${f.name.replace(/"/g, "\"\"")}" AS VARCHAR)) LIKE '%${sqlEscape(searchParam.toLowerCase())}%'`)
        .join(" OR ");
      whereClause = whereClause
        ? `${whereClause} AND (${searchConditions})`
        : ` WHERE (${searchConditions})`;
    }
  }

  let entries: Record<string, unknown>[] = [];
  let totalCount = 0;

  try {
    const countResult = await q<{ cnt: number }>(dbFile,
      `SELECT COUNT(*) as cnt FROM v_${name}${whereClause}`,
    );
    totalCount = countResult[0]?.cnt ?? 0;

    const pivotEntries = await q(dbFile,
      `SELECT * FROM v_${name}${whereClause}${orderByClause}${limitClause}`,
    );
    entries = pivotEntries;
  } catch {
    const rawRows = await q<EavRow>(dbFile,
      `SELECT e.id as entry_id, e.created_at, e.updated_at,
              f.name as field_name, ef.value
       FROM entries e
       JOIN entry_fields ef ON ef.entry_id = e.id
       JOIN fields f ON f.id = ef.field_id
       WHERE e.object_id = '${obj.id}'
       ORDER BY e.created_at DESC, e.id DESC
       LIMIT 5000`,
    );
    entries = pivotEavRows(rawRows);
  }

  const parsedFields = fields.map((f) => ({
    ...f,
    enum_values: f.enum_values ? tryParseJson(f.enum_values) as string[] | undefined : undefined,
    enum_colors: f.enum_colors ? tryParseJson(f.enum_colors) as string[] | undefined : undefined,
  }));

  const { labels: relationLabels, relatedObjectNames } =
    await resolveRelationLabels(dbFile, fields, entries);

  const enrichedFields = parsedFields.map((f) => ({
    ...f,
    related_object_name:
      f.type === "relation" ? relatedObjectNames[f.name] : undefined,
  }));

  const reverseRelations = await findReverseRelations(obj.id);
  const effectiveDisplayField = resolveDisplayField(obj, fields);
  const { views: savedViews, activeView, viewSettings } = getObjectViews(name);

  return {
    ok: true,
    data: {
      object: obj,
      fields: enrichedFields,
      statuses,
      entries,
      relationLabels,
      reverseRelations,
      effectiveDisplayField,
      savedViews,
      activeView,
      viewSettings,
      totalCount,
      page,
      pageSize,
    },
  };
}
