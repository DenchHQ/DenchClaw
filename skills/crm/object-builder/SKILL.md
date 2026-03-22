---
name: object-builder
description: Full 3-step workflow for creating workspace objects (SQL → filesystem → verify), CRM patterns for common object types, kanban boards, and the post-mutation checklist.
metadata: { "openclaw": { "inject": true, "always": true, "emoji": "🏗️" } }
---

# CRM Object Builder

This skill covers creating and modifying workspace objects end-to-end. For DuckDB schema and SQL reference, see **duckdb-operations** (`crm/duckdb-operations/SKILL.md`). For workspace fundamentals, see the parent **crm** skill (`crm/SKILL.md`).

---

## Full Workflow: Create CRM Structure in One Shot

EVERY object creation MUST complete ALL THREE steps below. Never stop after the SQL.

**Step 1 — SQL: Create object + fields + view** (single exec call):

```sql
BEGIN TRANSACTION;

-- 1a. Create object
INSERT INTO objects (name, description, icon, default_view)
VALUES ('lead', 'Sales leads tracking', 'user-plus', 'table')
ON CONFLICT (name) DO NOTHING;

-- 1b. Create all fields
INSERT INTO fields (object_id, name, type, required, sort_order) VALUES
  ((SELECT id FROM objects WHERE name = 'lead'), 'Full Name', 'text', true, 0),
  ((SELECT id FROM objects WHERE name = 'lead'), 'Email Address', 'email', true, 1),
  ((SELECT id FROM objects WHERE name = 'lead'), 'Phone Number', 'phone', false, 2),
  ((SELECT id FROM objects WHERE name = 'lead'), 'Score', 'number', false, 4),
  ((SELECT id FROM objects WHERE name = 'lead'), 'Notes', 'richtext', false, 7)
ON CONFLICT (object_id, name) DO NOTHING;

INSERT INTO fields (object_id, name, type, enum_values, enum_colors, sort_order) VALUES
  ((SELECT id FROM objects WHERE name = 'lead'), 'Status', 'enum',
   '["New","Contacted","Qualified","Converted"]'::JSON,
   '["#94a3b8","#3b82f6","#f59e0b","#22c55e"]'::JSON, 3),
  ((SELECT id FROM objects WHERE name = 'lead'), 'Source', 'enum',
   '["Website","Referral","Cold Call","Social"]'::JSON, NULL, 5)
ON CONFLICT (object_id, name) DO NOTHING;

-- 1b-2. Link to company object if it exists (proactive relation)
INSERT INTO fields (object_id, name, type, related_object_id, relationship_type, sort_order)
SELECT
  (SELECT id FROM objects WHERE name = 'lead'),
  'Company',
  'relation',
  (SELECT id FROM objects WHERE name = 'company'),
  'many_to_one',
  6
WHERE EXISTS (SELECT 1 FROM objects WHERE name = 'company')
ON CONFLICT (object_id, name) DO NOTHING;

-- 1c. MANDATORY: auto-generate PIVOT view (list all non-action fields in IN clause)
CREATE OR REPLACE VIEW v_lead AS
PIVOT (
  SELECT e.id as entry_id, e.created_at, e.updated_at,
         f.name as field_name, ef.value
  FROM entries e
  JOIN entry_fields ef ON ef.entry_id = e.id
  JOIN fields f ON f.id = ef.field_id
  WHERE e.object_id = (SELECT id FROM objects WHERE name = 'lead')
    AND f.type != 'action'
) ON field_name IN ('Full Name', 'Email Address', 'Phone Number', 'Status', 'Score', 'Source', 'Company', 'Notes') USING first(value);

COMMIT;
```

**Step 2 — Filesystem: Create object directory + .object.yaml** (exec call):

```bash
mkdir -p {{WORKSPACE_PATH}}/lead

# Query actual values from DuckDB (do NOT use placeholder strings)
OBJ_ID=$(duckdb {{WORKSPACE_PATH}}/workspace.duckdb -noheader -list "SELECT id FROM objects WHERE name = 'lead'")
ENTRY_COUNT=$(duckdb {{WORKSPACE_PATH}}/workspace.duckdb -noheader -list "SELECT COUNT(*) FROM entries WHERE object_id = '$OBJ_ID'")

# Write .object.yaml using the actual queried values (note: no 'YAML' — we need variable expansion)
cat > {{WORKSPACE_PATH}}/lead/.object.yaml << EOF
id: "$OBJ_ID"
name: "lead"
description: "Sales leads tracking"
icon: "user-plus"
default_view: "table"
entry_count: $ENTRY_COUNT
fields:
  - name: "Full Name"
    type: text
    required: true
  - name: "Email Address"
    type: email
    required: true
  - name: "Phone Number"
    type: phone
  - name: "Status"
    type: enum
    values: ["New", "Contacted", "Qualified", "Converted"]
  - name: "Score"
    type: number
  - name: "Source"
    type: enum
    values: ["Website", "Referral", "Cold Call", "Social"]
  - name: "Company"
    type: relation
    related_object: company
    relationship_type: many_to_one
  - name: "Notes"
    type: richtext
EOF
```

**Step 3 — Verify**: Confirm both the view and filesystem exist:

```bash
# Verify view works
duckdb {{WORKSPACE_PATH}}/workspace.duckdb "SELECT COUNT(*) FROM v_lead"
# Verify .object.yaml exists
cat {{WORKSPACE_PATH}}/lead/.object.yaml
```

---

## Kanban Boards

When creating task/board objects, use `default_view = 'kanban'` and auto-create Status + Assigned To fields. Set `view_settings.kanbanField` to the enum field that defines columns. Remember: ALL THREE STEPS are required.

**Step 1 — SQL:**

```sql
BEGIN TRANSACTION;
INSERT INTO objects (name, description, icon, default_view)
VALUES ('task', 'Task tracking board', 'check-square', 'kanban')
ON CONFLICT (name) DO NOTHING;

-- Auto-create Status field with kanban-appropriate values
INSERT INTO fields (object_id, name, type, enum_values, enum_colors, sort_order)
VALUES ((SELECT id FROM objects WHERE name = 'task'), 'Status', 'enum',
  '["In Queue","In Progress","Done"]'::JSON,
  '["#94a3b8","#3b82f6","#22c55e"]'::JSON, 0)
ON CONFLICT (object_id, name) DO NOTHING;

-- Auto-create Assigned To field (user type)
INSERT INTO fields (object_id, name, type, sort_order)
VALUES ((SELECT id FROM objects WHERE name = 'task'), 'Assigned To', 'user', 1)
ON CONFLICT (object_id, name) DO NOTHING;

-- Auto-create default statuses
INSERT INTO statuses (object_id, name, color, sort_order, is_default) VALUES
  ((SELECT id FROM objects WHERE name = 'task'), 'In Queue', '#94a3b8', 0, true),
  ((SELECT id FROM objects WHERE name = 'task'), 'In Progress', '#3b82f6', 1, false),
  ((SELECT id FROM objects WHERE name = 'task'), 'Done', '#22c55e', 2, false)
ON CONFLICT (object_id, name) DO NOTHING;

CREATE OR REPLACE VIEW v_task AS
PIVOT (
  SELECT e.id as entry_id, e.created_at, e.updated_at,
         f.name as field_name, ef.value
  FROM entries e
  JOIN entry_fields ef ON ef.entry_id = e.id
  JOIN fields f ON f.id = ef.field_id
  WHERE e.object_id = (SELECT id FROM objects WHERE name = 'task')
    AND f.type != 'action'
) ON field_name IN ('Title', 'Description', 'Status', 'Priority', 'Due Date', 'Assigned To', 'Notes') USING first(value);

COMMIT;
```

**Step 2 — Filesystem (MANDATORY):**

```bash
mkdir -p {{WORKSPACE_PATH}}/task
OBJ_ID=$(duckdb {{WORKSPACE_PATH}}/workspace.duckdb -noheader -list "SELECT id FROM objects WHERE name = 'task'")

cat > {{WORKSPACE_PATH}}/task/.object.yaml << EOF
id: "$OBJ_ID"
name: "task"
description: "Task tracking board"
icon: "check-square"
default_view: "kanban"
entry_count: 0
view_settings:
  kanbanField: "Status"
fields:
  - name: "Status"
    type: enum
    values: ["In Queue", "In Progress", "Done"]
  - name: "Assigned To"
    type: user
EOF
```

**Step 3 — Verify:** `duckdb {{WORKSPACE_PATH}}/workspace.duckdb "SELECT COUNT(*) FROM v_task"` and `cat {{WORKSPACE_PATH}}/task/.object.yaml`.

---

## Proactive Relation Creation (IMPORTANT)

**When creating multiple objects, ALWAYS create relation fields to link them — even if the user did not explicitly ask for it.** Real-world data is interconnected. If two objects are obviously related, link them. The user expects this; not linking them is a missed opportunity that forces manual work later.

### When to create relations automatically

- **People + Company** → add "Company" relation on people (many_to_one → company)
- **Deal/Opportunity + Contact** → add "Primary Contact" relation on deal (many_to_one → people)
- **Deal + Company** → add "Company" relation on deal (many_to_one → company)
- **Task + Project** → add "Project" relation on task (many_to_one → project)
- **Task + Contact/Person** → add "Related Contact" relation on task (many_to_one → people)
- **Case + Client** → add "Client" relation on case (many_to_one → people or company)
- **Invoice + Company** → add "Company" relation on invoice (many_to_one → company)
- **Invoice + Deal** → add "Deal" relation on invoice (many_to_one → deal)
- **Property + Agent** → add "Agent" relation on property (many_to_one → people)
- **Any child object + parent object** → link child to parent

**General rule**: If you're creating object B and object A already exists (or is being created alongside), ask yourself: "Would an entry in B logically belong to or reference an entry in A?" If yes, add a relation field.

### Relation field SQL pattern

```sql
INSERT INTO fields (object_id, name, type, related_object_id, relationship_type, sort_order)
VALUES (
  (SELECT id FROM objects WHERE name = 'people'),
  'Company',
  'relation',
  (SELECT id FROM objects WHERE name = 'company'),
  'many_to_one',
  3
) ON CONFLICT (object_id, name) DO NOTHING;
```

Use `many_to_one` when each entry links to exactly one entry in the other object (most common). Use `many_to_many` when an entry can link to multiple entries (e.g., project → team members).

**Relation fields must be created via SQL** — the API does not support the `relation` type.

---

## CRM Patterns

### Contact/Customer

- Full Name (text, required), Email Address (email, required), Phone Number (phone), **Company (relation → company, many_to_one)**, Notes (richtext)
- Universal pattern for clients, customers, patients, members
- **Always link to company** if a company object exists or is being created

### Lead/Prospect

- Full Name (text, required), Email Address (email, required), Phone Number (phone), Status (enum: New/Contacted/Qualified/Converted), Source (enum: Website/Referral/Cold Call/Social), Score (number), **Company (relation → company, many_to_one)**, Assigned To (user), Notes (richtext)
- Sales, legal intake, real estate prospects
- **Link to company** when company object exists; **link to deal** if deal pipeline is also being set up

### Company/Organization

- Company Name (text, required), Industry (enum), Website (url), Type (enum: Client/Partner/Vendor), Relationship Status (enum), Notes (richtext)
- B2B relationships, vendor management
- Other objects typically link TO company (people, deals, invoices), not the other way around

### Deal/Opportunity

- Deal Name (text, required), Amount (number), Stage (enum: Discovery/Proposal/Negotiation/Closed Won/Closed Lost), Close Date (date), Probability (number), **Primary Contact (relation → people, many_to_one)**, **Company (relation → company, many_to_one)**, Assigned To (user), Notes (richtext)
- Sales pipeline, project bids
- **Always link to contact AND company** — a deal without a contact or company is incomplete

### Case/Project

- Case Number (text, required), Title (text, required), **Client (relation → people or company, many_to_one)**, Status (enum: Open/In Progress/Closed), Priority (enum: Low/Medium/High/Urgent), Due Date (date), Assigned To (user), Notes (richtext)
- Legal cases, client projects
- **Always link to client** (person or company depending on context)

### Property/Asset

- Address (text, required), Property Type (enum), Price (number), Status (enum: Available/Under Contract/Sold), Square Footage (number), Bedrooms (number), **Agent (relation → people, many_to_one)**, **Client (relation → people, many_to_one)**, Notes (richtext)
- Real estate listings, asset management
- **Link to agent and/or client** when people object exists

### Task/Activity (use kanban)

- Title (text, required), Description (text), Assigned To (user), Due Date (date), Status (enum: In Queue/In Progress/Done), Priority (enum: Low/Medium/High), **Related To (relation → contextual parent, many_to_one)**, Notes (richtext)
- Use `default_view = 'kanban'` — auto-creates Status and Assigned To fields
- **Link to parent object** (project, deal, case, etc.) whenever tasks are created alongside another object

### Invoice/Payment

- Invoice Number (text, required), Amount (number), Status (enum: Draft/Sent/Paid/Overdue), Due Date (date), **Company (relation → company, many_to_one)**, **Deal (relation → deal, many_to_one)**, Notes (richtext)
- Billing, payments
- **Always link to company and optionally to deal**

---

## Post-Mutation Checklist (MANDATORY)

You MUST complete ALL steps below after ANY schema mutation (create/update/delete object, field, or entry). Do NOT skip any step. Do NOT consider the operation complete until all steps are done.

### After creating or modifying an OBJECT or its FIELDS:

- [ ] `CREATE OR REPLACE VIEW v_{object_name}` — regenerate the PIVOT view
- [ ] `mkdir -p {{WORKSPACE_PATH}}/{object_name}/` — create the object directory
- [ ] Write `{{WORKSPACE_PATH}}/{object_name}/.object.yaml` — metadata projection with id, name, description, icon, default_view, entry_count, and full field list
- [ ] If object has a `parent_document_id`, place directory inside the parent document's directory
- [ ] Update `WORKSPACE.md` if it exists

### After adding or updating ENTRIES:

- [ ] Update `entry_count` in the corresponding `.object.yaml`
- [ ] Verify the view returns correct data: `SELECT * FROM v_{object} LIMIT 5`

### After deleting an OBJECT:

- [ ] `DROP VIEW IF EXISTS v_{object_name}` — remove the view
- [ ] `rm -rf {{WORKSPACE_PATH}}/{object_name}/` — remove the directory (unless it contains nested documents that need relocating)
- [ ] Update `WORKSPACE.md`

### After creating or modifying a DOCUMENT:

- [ ] Write the `.md` file to the correct path in `{{WORKSPACE_PATH}}/**`
- [ ] `INSERT INTO documents` — ensure metadata row exists with correct `file_path`, `parent_id`, or `parent_object_id`

### After adding ACTION FIELDS to an object:

- [ ] `mkdir -p {{WORKSPACE_PATH}}/{object_name}/.actions/` — create the actions directory
- [ ] **Write every script file** referenced by `scriptPath` in the action config (e.g. `.actions/send-email.js`)
- [ ] Regenerate PIVOT view (exclude action fields with `AND f.type != 'action'`)
- [ ] Update `.object.yaml` with the action field including `action_config`
- [ ] Verify script files exist: `ls {{WORKSPACE_PATH}}/{object_name}/.actions/`

See the **actions** child skill (`crm/actions/SKILL.md`) for the complete end-to-end action creation walkthrough.

These steps ensure the filesystem always mirrors DuckDB. The sidebar depends on `.object.yaml` files — if they are missing, objects will not appear.

---

## Common Mistakes and Recovery

### Object exists in DuckDB but doesn't appear in the sidebar
The `.object.yaml` file is missing. Regenerate it:

```bash
OBJ_ID=$(duckdb {{WORKSPACE_PATH}}/workspace.duckdb -noheader -list "SELECT id FROM objects WHERE name = 'lead'")
mkdir -p {{WORKSPACE_PATH}}/lead
# Then write .object.yaml with the correct id, name, fields, and entry_count
```

### PIVOT view returns wrong columns or errors
The `IN (...)` field list is out of date. Regenerate the view by querying current fields:

```bash
duckdb {{WORKSPACE_PATH}}/workspace.duckdb -json "SELECT name FROM fields WHERE object_id = (SELECT id FROM objects WHERE name = 'lead') AND type != 'action' ORDER BY sort_order"
# Use the output to rebuild the IN clause in the PIVOT view
```

### `.object.yaml` is out of sync with DuckDB
Query the current state and rewrite the file:

```bash
OBJ_ID=$(duckdb {{WORKSPACE_PATH}}/workspace.duckdb -noheader -list "SELECT id FROM objects WHERE name = 'lead'")
ENTRY_COUNT=$(duckdb {{WORKSPACE_PATH}}/workspace.duckdb -noheader -list "SELECT COUNT(*) FROM entries WHERE object_id = '$OBJ_ID'")
duckdb {{WORKSPACE_PATH}}/workspace.duckdb -json "SELECT name, type, required, enum_values, default_value FROM fields WHERE object_id = '$OBJ_ID' ORDER BY sort_order"
# Use these values to rebuild .object.yaml
```

### DuckDB name doesn't match directory name
All three must be identical: the DuckDB `objects.name`, the filesystem directory name, and `.object.yaml` `name`. If they diverge, rename them to match. See the "Renaming / Moving Objects" section in the parent CRM skill.
