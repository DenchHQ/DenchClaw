# Actions — Executable Buttons on CRM Objects

Actions are a field type (`type: "action"`) that renders clickable buttons on object entries. Each button executes a server-side script in **any language** — JavaScript, Python, bash, Ruby, Go, or any executable installed on the machine.

---

## Table of Contents

1. [Creating Action Fields](#creating-action-fields)
2. [Post-Creation Checklist (MANDATORY)](#post-creation-checklist-mandatory)
3. [Action Configuration](#action-configuration)
4. [Script Modes](#script-modes)
5. [Script Protocol](#script-protocol)
6. [Environment Variables](#environment-variables)
7. [Inline JS SDK (inline scripts only)](#inline-js-sdk-inline-scripts-only)
8. [Action Runs](#action-runs)
9. [Bulk Execution](#bulk-execution)
10. [UI Rendering](#ui-rendering)
11. [Complete End-to-End Example](#complete-end-to-end-example)
12. [More Examples](#more-examples)
13. [Common Mistakes](#common-mistakes)

---

## Creating Action Fields

Create via SQL like any field, with `type = 'action'` and the action config in `default_value`:

```sql
INSERT INTO fields (id, object_id, name, type, default_value, sort_order)
VALUES (
  (SELECT gen_random_uuid()::VARCHAR),
  (SELECT id FROM objects WHERE name = 'lead'),
  'Actions',
  'action',
  '{"actions":[{"id":"act_send_email","label":"Send Email","icon":"mail","variant":"primary","scriptPath":".actions/send-email.js","confirmMessage":"Send email to this contact?","loadingLabel":"Sending...","successLabel":"Sent!","autoResetMs":3000}]}',
  10
);
```

You can also create action fields via the API:

```
POST /api/workspace/objects/{objectName}/fields
{
  "name": "Actions",
  "type": "action",
  "action_config": {
    "actions": [...]
  }
}
```

---

## Post-Creation Checklist (MANDATORY)

**You MUST complete ALL steps below after creating an action field. The button will NOT work if any step is missing. Do NOT consider the operation complete until every step is done.**

### After creating an action field with file-based scripts (`scriptPath`):

- [ ] **CREATE the `.actions/` directory**: `mkdir -p {{WORKSPACE_PATH}}/{object_name}/.actions/`
- [ ] **WRITE every script file** referenced by `scriptPath` in the action config. If you defined `"scriptPath": ".actions/send-email.js"`, then `{{WORKSPACE_PATH}}/{object_name}/.actions/send-email.js` MUST exist with working code.
- [ ] **Regenerate the PIVOT view** — action fields are excluded from PIVOT (they store no entry_fields values), but the view must be refreshed to reflect the new field list.
- [ ] **Update `.object.yaml`** — include the action field with its `action_config` in the fields list.
- [ ] **Verify** — confirm the script file exists: `ls {{WORKSPACE_PATH}}/{object_name}/.actions/`

### After creating an action field with inline scripts (`script` + `runtime: "inline"`):

- [ ] **Regenerate the PIVOT view** — same as above.
- [ ] **Update `.object.yaml`** — include the action field.
- [ ] No filesystem scripts needed — inline code is stored in the field's `default_value`.

### CRITICAL: If you skip creating the script file, clicking the button will show "Script not found" error.

---

## Action Configuration

Each action field's `default_value` is a JSON object with an `actions` array:

```json
{
  "actions": [
    {
      "id": "act_unique_id",
      "label": "Button Label",
      "icon": "mail",
      "variant": "primary",
      "scriptPath": ".actions/my-script.js",
      "runtime": "auto",
      "confirmMessage": "Are you sure?",
      "loadingLabel": "Running...",
      "successLabel": "Done!",
      "errorLabel": "Failed",
      "autoResetMs": 3000,
      "timeout": 60000
    }
  ]
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | yes | Unique identifier for this action |
| `label` | string | yes | Button text displayed in idle state |
| `icon` | string | no | Icon name (decorative, not rendered from icon set yet) |
| `variant` | string | no | `"default"` \| `"primary"` \| `"destructive"` \| `"success"` \| `"warning"` |
| `scriptPath` | string | conditional | Path to script file relative to object directory |
| `script` | string | conditional | Inline JavaScript code (for simple actions) |
| `runtime` | string | no | `"auto"` \| `"inline"` \| `"node"` \| `"python"` \| `"bash"` \| `"ruby"` |
| `confirmMessage` | string | no | If set, shows confirmation dialog before running |
| `loadingLabel` | string | no | Text shown while script is running |
| `successLabel` | string | no | Text shown on success |
| `errorLabel` | string | no | Text shown on failure |
| `autoResetMs` | number | no | Milliseconds before button resets to idle (default: 3000) |
| `timeout` | number | no | Milliseconds before killing the script (default: 60000) |

Either `scriptPath` or `script` must be provided. If both are present, `scriptPath` takes precedence unless `runtime` is `"inline"`.

---

## Script Modes

### File-based scripts (`scriptPath`)

Scripts live as files in the workspace alongside the object:

```
workspace/
  leads/
    .object.yaml
    .actions/
      send-email.js
      generate-report.py
      deploy-webhook.sh
```

Runtime auto-detection by file extension:
- `.js`, `.mjs`, `.cjs` → `node`
- `.ts` → `npx tsx`
- `.py` → `python3`
- `.sh` → `bash`
- `.rb` → `ruby`
- No extension → direct execution (must be chmod +x)

### Inline scripts (`script`)

Short JavaScript snippets stored directly in the action config. Executed server-side via `node` with the Dench SDK pre-loaded:

```json
{
  "id": "act_mark_contacted",
  "label": "Mark Contacted",
  "variant": "success",
  "script": "await dench.objects.update(context.objectName, context.entryId, { Status: 'Contacted' });\nreturn { message: 'Updated' };",
  "runtime": "inline"
}
```

---

## Script Protocol

Scripts communicate results via **NDJSON on stdout**. Each line is a JSON object:

```jsonl
{"type":"progress","percent":50,"message":"Processing..."}
{"type":"log","level":"info","message":"Fetched 42 records"}
{"type":"result","status":"success","data":{"emailsSent":5}}
```

### Message types

| Type | Fields | Description |
|------|--------|-------------|
| `progress` | `percent`, `message?` | Updates progress bar in UI |
| `log` | `level`, `message` | Streamed to action output (`info`, `warn`, `error`) |
| `result` | `status`, `data?` | Final result. `status` is `"success"` or `"error"`. Terminates. |

Non-JSON stdout lines are treated as `log` messages with `level: "info"`.

Exit code: 0 = success, non-zero = error (standard Unix convention). If no `result` message is emitted, the exit code determines success/failure.

---

## Environment Variables

Every script receives these environment variables:

| Variable | Description |
|----------|-------------|
| `DENCH_ENTRY_ID` | The entry ID this action is running on |
| `DENCH_ENTRY_DATA` | Full entry data as JSON string |
| `DENCH_OBJECT_NAME` | Object name (e.g. `"leads"`) |
| `DENCH_OBJECT_ID` | Object ID |
| `DENCH_ACTION_ID` | Action ID from config |
| `DENCH_FIELD_ID` | Field ID the action belongs to |
| `DENCH_WORKSPACE_PATH` | Absolute path to workspace root |
| `DENCH_DB_PATH` | Absolute path to `workspace.duckdb` |
| `DENCH_API_URL` | Base URL for workspace REST APIs |

This means **any language** can participate — just read env vars and print JSON to stdout.

### File-Based Script Patterns

File-based scripts do NOT have the `dench` SDK. Use env vars + CLI/HTTP instead:

**Read entry data (any language):**
```bash
# Entry data is already in env as JSON
echo "$DENCH_ENTRY_DATA" | jq '.["Full Name"]'
```

**Query DuckDB from a file-based script:**
```bash
duckdb "$DENCH_DB_PATH" -json "SELECT * FROM v_lead WHERE entry_id = '$DENCH_ENTRY_ID'"
```

**Update DuckDB from a file-based script:**
```bash
FIELD_ID=$(duckdb "$DENCH_DB_PATH" -noheader -list \
  "SELECT id FROM fields WHERE object_id = '$DENCH_OBJECT_ID' AND name = 'Status'")
duckdb "$DENCH_DB_PATH" \
  "INSERT INTO entry_fields (entry_id, field_id, value)
   VALUES ('$DENCH_ENTRY_ID', '$FIELD_ID', 'Contacted')
   ON CONFLICT (entry_id, field_id) DO UPDATE SET value = excluded.value, updated_at = now()"
```

**Call the workspace REST API from a file-based script:**
```bash
curl -s -X PATCH "$DENCH_API_URL/workspace/objects/$DENCH_OBJECT_NAME/entries/$DENCH_ENTRY_ID" \
  -H "Content-Type: application/json" \
  -d '{"fields":{"Status":"Contacted"}}'
```

### Python example

```python
import os, json, requests

entry = json.loads(os.environ['DENCH_ENTRY_DATA'])
api = os.environ['DENCH_API_URL']
email = entry.get('Email Address', '')

print(json.dumps({"type": "progress", "percent": 50, "message": "Sending..."}))

requests.post(f"{api}/workspace/objects/people/entries/{os.environ['DENCH_ENTRY_ID']}", 
    json={"fields": {"Status": "Contacted"}},
    headers={"Content-Type": "application/json"})

print(json.dumps({"type": "result", "status": "success", "data": {"email": email}}))
```

### Bash example

```bash
#!/bin/bash
ENTRY=$(echo "$DENCH_ENTRY_DATA" | jq -r '.["Email Address"]')
echo "{\"type\":\"log\",\"level\":\"info\",\"message\":\"Processing $ENTRY\"}"
curl -s -X PATCH "$DENCH_API_URL/workspace/objects/$DENCH_OBJECT_NAME/entries/$DENCH_ENTRY_ID" \
  -H "Content-Type: application/json" \
  -d '{"fields":{"Status":"Contacted"}}'
echo '{"type":"result","status":"success","data":{"sent":true}}'
```

---

## Inline JS SDK (inline scripts only)

**The `dench` global and `context` object are ONLY available for inline scripts (`runtime: "inline"`).** File-based scripts do NOT have access to the SDK — they must use environment variables and raw HTTP/CLI calls (see [Environment Variables](#environment-variables) and [File-Based Script Patterns](#file-based-script-patterns) below).

For inline JS actions, the `dench` global provides:

| Method | Description |
|--------|-------------|
| `dench.objects.get(name, id)` | Get entry by object name and ID |
| `dench.objects.list(name)` | List entries for an object |
| `dench.objects.create(name, fields)` | Create a new entry |
| `dench.objects.update(name, id, fields)` | Update entry fields |
| `dench.objects.delete(name, id)` | Delete an entry |
| `dench.objects.bulkDelete(name, ids)` | Bulk delete entries |
| `dench.db.query(sql)` | Run read-only SQL on workspace DB |
| `dench.db.execute(sql)` | Execute SQL (write operations) |
| `dench.files.read(path)` | Read a workspace file |
| `dench.files.write(path, content)` | Write a workspace file |
| `dench.http.fetch(url, opts)` | Standard fetch (no proxy) |
| `dench.exec(cmd)` | Run a shell command synchronously |
| `dench.progress(percent, message)` | Report progress to UI |
| `dench.log(message, level)` | Log a message |
| `dench.complete(data)` | Signal successful completion |
| `dench.fail(message)` | Signal failure and exit |
| `dench.env.*` | Access all DENCH_* env vars as properties |

The `context` object is also available:
- `context.entryId`, `context.entryData`, `context.objectName`, `context.objectId`
- `context.actionId`, `context.fieldId`, `context.workspacePath`, `context.dbPath`, `context.apiUrl`

---

## Action Runs

Every execution is persisted in the `action_runs` table:

```sql
CREATE TABLE IF NOT EXISTS action_runs (
  id VARCHAR PRIMARY KEY DEFAULT (gen_random_uuid()::VARCHAR),
  action_id VARCHAR NOT NULL,
  field_id VARCHAR NOT NULL,
  entry_id VARCHAR NOT NULL,
  object_id VARCHAR NOT NULL,
  status VARCHAR NOT NULL DEFAULT 'pending',
  started_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ,
  result VARCHAR,
  error VARCHAR,
  stdout VARCHAR,
  exit_code INTEGER
);
```

Query recent runs:
```
GET /api/workspace/objects/{name}/actions/runs?fieldId=...&entryId=...&limit=20
```

---

## Bulk Execution

When the user selects multiple rows in the table and clicks an action button in the bulk action bar:

1. The UI sends a single POST with all selected `entryIds`.
2. The server spawns up to 8 concurrent child processes (one per entry).
3. Each process gets its own `DENCH_ENTRY_ID` and `DENCH_ENTRY_DATA`.
4. Results stream back as SSE events per entry.
5. The UI updates each entry's button state independently.

---

## UI Rendering

Action buttons appear in:

1. **Table view**: As a column. Multiple actions show as compact buttons per row. Checkbox column (first, sticky) enables multi-row selection for bulk actions.
2. **Entry detail panel**: Full-width buttons in a dedicated "Actions" section below properties.
3. **Kanban cards**: Compact (icon-only) buttons at the bottom of each card.
4. **Bulk action bar**: Fixed bottom toolbar when rows are selected. Shows all available action buttons + a default "Delete" button.

Button states: idle → loading (with optional progress bar) → success/error → auto-reset to idle.

---

## Complete End-to-End Example

This example creates an action button on a "lead" object that marks a lead as "Contacted". **Follow every step — skipping any will leave a broken button.**

**Step 1 — SQL: Create the action field** (single exec call):

```sql
INSERT INTO fields (id, object_id, name, type, default_value, sort_order)
VALUES (
  (SELECT gen_random_uuid()::VARCHAR),
  (SELECT id FROM objects WHERE name = 'lead'),
  'Actions',
  'action',
  '{"actions":[{"id":"act_mark_contacted","label":"Mark Contacted","icon":"phone","variant":"primary","scriptPath":".actions/mark-contacted.sh","loadingLabel":"Updating...","successLabel":"Contacted!","autoResetMs":3000},{"id":"act_export","label":"Export","icon":"download","variant":"default","scriptPath":".actions/export-csv.py","loadingLabel":"Exporting...","successLabel":"Exported!"}]}',
  99
);
```

**Step 2 — Regenerate the PIVOT view** (action fields are excluded):

```sql
CREATE OR REPLACE VIEW v_lead AS
PIVOT (
  SELECT e.id as entry_id, e.created_at, e.updated_at,
         f.name as field_name, ef.value
  FROM entries e
  JOIN entry_fields ef ON ef.entry_id = e.id
  JOIN fields f ON f.id = ef.field_id
  WHERE e.object_id = (SELECT id FROM objects WHERE name = 'lead')
    AND f.type != 'action'
) ON field_name IN ('Full Name', 'Email Address', 'Phone Number', 'Status', 'Score', 'Source', 'Notes') USING first(value);
```

**Step 3 — Create the `.actions/` directory and write EVERY script file**:

```bash
mkdir -p {{WORKSPACE_PATH}}/lead/.actions
```

Write `.actions/mark-contacted.sh`:

```bash
#!/bin/bash
# .actions/mark-contacted.sh — Updates lead status to "Contacted"
echo '{"type":"progress","percent":30,"message":"Looking up lead..."}'

FIELD_ID=$(duckdb "$DENCH_DB_PATH" -noheader -list \
  "SELECT id FROM fields WHERE object_id = '$DENCH_OBJECT_ID' AND name = 'Status'")

if [ -z "$FIELD_ID" ]; then
  echo '{"type":"result","status":"error","data":{"message":"Status field not found"}}'
  exit 1
fi

echo '{"type":"progress","percent":70,"message":"Updating status..."}'

duckdb "$DENCH_DB_PATH" \
  "INSERT INTO entry_fields (entry_id, field_id, value)
   VALUES ('$DENCH_ENTRY_ID', '$FIELD_ID', 'Contacted')
   ON CONFLICT (entry_id, field_id) DO UPDATE SET value = excluded.value, updated_at = now()"

echo '{"type":"result","status":"success","data":{"newStatus":"Contacted"}}'
```

Write `.actions/export-csv.py`:

```python
# .actions/export-csv.py — Exports entry data to CSV
import os, json, csv, subprocess

entry = json.loads(os.environ['DENCH_ENTRY_DATA'])
workspace = os.environ['DENCH_WORKSPACE_PATH']
entry_id = os.environ['DENCH_ENTRY_ID']

print(json.dumps({"type": "progress", "percent": 50, "message": "Generating CSV..."}))

output_path = os.path.join(workspace, 'exports', f"{entry_id}.csv")
os.makedirs(os.path.dirname(output_path), exist_ok=True)

with open(output_path, 'w', newline='') as f:
    writer = csv.writer(f)
    writer.writerow(entry.keys())
    writer.writerow(entry.values())

print(json.dumps({"type": "result", "status": "success", "data": {"path": output_path}}))
```

**Step 4 — Update `.object.yaml`** (include action_config in the fields list):

```yaml
# Add to the fields section of lead/.object.yaml:
fields:
  - name: "Full Name"
    type: text
    required: true
  - name: "Email Address"
    type: email
    required: true
  # ... other fields ...
  - name: "Actions"
    type: action
    action_config:
      actions:
        - id: act_mark_contacted
          label: "Mark Contacted"
          icon: phone
          variant: primary
          scriptPath: ".actions/mark-contacted.sh"
          loadingLabel: "Updating..."
          successLabel: "Contacted!"
          autoResetMs: 3000
        - id: act_export
          label: "Export"
          icon: download
          variant: default
          scriptPath: ".actions/export-csv.py"
          loadingLabel: "Exporting..."
          successLabel: "Exported!"
```

**Step 5 — Verify everything**:

```bash
# Verify scripts exist
ls -la {{WORKSPACE_PATH}}/lead/.actions/
# Verify .object.yaml includes the action field
cat {{WORKSPACE_PATH}}/lead/.object.yaml
# Verify the view works
duckdb {{WORKSPACE_PATH}}/workspace.duckdb "SELECT COUNT(*) FROM v_lead"
```

---

## More Examples

### Simple status update (inline — no script files needed)

```json
{
  "id": "act_mark_done",
  "label": "Mark Done",
  "variant": "success",
  "script": "await dench.objects.update(context.objectName, context.entryId, { Status: 'Done' });\nreturn { message: 'Marked as done' };",
  "runtime": "inline",
  "successLabel": "Done!",
  "autoResetMs": 2000
}
```

### Send Slack notification (Node.js file)

```javascript
// .actions/send-notification.js
// File-based scripts use env vars — the `dench` SDK is NOT available here.
const entry = JSON.parse(process.env.DENCH_ENTRY_DATA);
const name = entry['Full Name'] || 'Unknown';

console.log(JSON.stringify({type: "progress", percent: 30, message: "Preparing notification..."}));

const result = await fetch('https://hooks.slack.com/services/YOUR/WEBHOOK/URL', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ text: `New lead: ${name}` }),
});

if (result.ok) {
  console.log(JSON.stringify({type: "result", status: "success", data: {notified: true}}));
} else {
  console.log(JSON.stringify({type: "result", status: "error", data: {message: "Slack notification failed"}}));
  process.exit(1);
}
```

### DuckDB query from Node.js file

```javascript
// .actions/enrich-lead.js
// Use child_process to query DuckDB directly from file-based scripts
const { execSync } = require('child_process');
const entry = JSON.parse(process.env.DENCH_ENTRY_DATA);
const dbPath = process.env.DENCH_DB_PATH;
const entryId = process.env.DENCH_ENTRY_ID;
const objectId = process.env.DENCH_OBJECT_ID;

console.log(JSON.stringify({type: "progress", percent: 20, message: "Enriching..."}));

const fieldId = execSync(
  `duckdb '${dbPath}' -noheader -list "SELECT id FROM fields WHERE object_id = '${objectId}' AND name = 'Score'"`,
  { encoding: 'utf-8' }
).trim();

if (fieldId) {
  execSync(
    `duckdb '${dbPath}' "INSERT INTO entry_fields (entry_id, field_id, value) VALUES ('${entryId}', '${fieldId}', '85') ON CONFLICT (entry_id, field_id) DO UPDATE SET value = excluded.value, updated_at = now()"`,
    { encoding: 'utf-8' }
  );
}

console.log(JSON.stringify({type: "result", status: "success", data: {score: 85}}));
```

### Destructive action with confirmation

```json
{
  "id": "act_archive",
  "label": "Archive",
  "variant": "destructive",
  "confirmMessage": "This will move the entry to the archive. Continue?",
  "scriptPath": ".actions/archive.sh",
  "loadingLabel": "Archiving...",
  "successLabel": "Archived",
  "errorLabel": "Archive failed"
}
```

The script file `.actions/archive.sh` must also be created:

```bash
#!/bin/bash
# .actions/archive.sh
echo '{"type":"progress","percent":50,"message":"Archiving entry..."}'
duckdb "$DENCH_DB_PATH" "DELETE FROM entries WHERE id = '$DENCH_ENTRY_ID'"
echo '{"type":"result","status":"success","data":{"archived":true}}'
```

---

## Common Mistakes

**1. Creating action field SQL but forgetting to write the script files.**
The button renders in the UI but clicking it shows "Script not found: .actions/my-script.js". You MUST `mkdir -p` the `.actions/` directory and write every script file referenced by `scriptPath`.

**2. Using the `dench` SDK in file-based scripts.**
The `dench` global and `context` object are ONLY available for inline scripts (`runtime: "inline"`). File-based scripts must use `process.env.DENCH_*` variables and shell/HTTP calls. See [File-Based Script Patterns](#file-based-script-patterns).

**3. Forgetting to update `.object.yaml` with the action field.**
The `.object.yaml` must include the action field with `action_config` in its fields list. Without it, the sidebar and UI may not render the action buttons correctly.

**4. Not regenerating the PIVOT view after adding an action field.**
Action fields are excluded from PIVOT views (`type != 'action'`), but the view must be regenerated to reflect the updated field list. Use the `IN (...)` clause listing only non-action field names.

**5. Using `uuid()` instead of `gen_random_uuid()` for field IDs.**
The correct function is `gen_random_uuid()::VARCHAR`. The `uuid()` function may not exist in all DuckDB versions.

**6. Script exits with non-zero code but no error message.**
Always emit a `{"type":"result","status":"error","data":{"message":"..."}}` line before exiting with a non-zero code, so the UI shows a meaningful error instead of a generic failure.
