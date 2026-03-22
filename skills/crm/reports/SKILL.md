---
name: reports
description: Report generation with .report.json format, interactive chart types (bar, line, area, pie, donut, radar, scatter, funnel), panel sizes, filter types, inline chat reports, and post-report checklist.
metadata: { "openclaw": { "inject": true, "always": true, "emoji": "📈" } }
---

# CRM Reports

This skill covers report generation and inline chat charts. For workspace fundamentals, see the parent **crm** skill (`crm/SKILL.md`). For DuckDB queries used in report SQL, see **duckdb-operations** (`crm/duckdb-operations/SKILL.md`).

---

## Report Generation (Analytics / Charts)

Reports are JSON config files (`.report.json`) that the web app renders as live interactive dashboards using Recharts. The agent creates these files to give the user visual analytics over their CRM data.

### Report file format

Store reports as `.report.json` files in `{{WORKSPACE_PATH}}/**` (wherever appropriate / create directories if you need for better structure). The JSON schema:

```json
{
  "version": 1,
  "title": "Report Title",
  "description": "Brief description of what this report shows",
  "panels": [
    {
      "id": "unique-panel-id",
      "title": "Panel Title",
      "type": "bar",
      "sql": "SELECT ... FROM v_{object} ...",
      "mapping": { "xAxis": "column_name", "yAxis": ["value_column"] },
      "size": "half"
    }
  ],
  "filters": [
    {
      "id": "filter-id",
      "type": "dateRange",
      "label": "Date Range",
      "column": "created_at"
    }
  ]
}
```

### Chart types

| Type      | Best for                     | Required mapping                |
| --------- | ---------------------------- | ------------------------------- |
| `bar`     | Comparing categories         | `xAxis`, `yAxis`                |
| `line`    | Trends over time             | `xAxis`, `yAxis`                |
| `area`    | Volume trends                | `xAxis`, `yAxis`                |
| `pie`     | Distribution/share           | `nameKey`, `valueKey`           |
| `donut`   | Distribution (with center)   | `nameKey`, `valueKey`           |
| `radar`   | Multi-dimensional comparison | `xAxis` (or `nameKey`), `yAxis` |
| `scatter` | Correlation                  | `xAxis`, `yAxis`                |
| `funnel`  | Pipeline/conversion          | `nameKey`, `valueKey`           |

### Panel sizes

- `"full"` — spans full width (6 columns)
- `"half"` — spans half width (3 columns) — **default**
- `"third"` — spans one third (2 columns)

### Filter types

- `dateRange` — date picker (from/to), filters on `column`
- `select` — single-select dropdown, needs `sql` to fetch options
- `multiSelect` — multi-select chips, needs `sql` to fetch options
- `number` — min/max numeric range

### SQL query rules for reports

- Always use the auto-generated `v_{object}` PIVOT views — never raw EAV queries
- SQL must be SELECT-only (no INSERT/UPDATE/DELETE)
- Cast numeric fields: `"Amount"::NUMERIC` or `CAST("Amount" AS NUMERIC)`
- Use `DATE_TRUNC('month', created_at)` for time-series grouping
- Always include `ORDER BY` for consistent chart rendering
- Use aggregate functions: `COUNT(*)`, `SUM(...)`, `AVG(...)`, `MIN(...)`, `MAX(...)`
- **Double-quote field names with spaces**: `"Full Name"`, `"Email Address"`, `"Assigned To"`
- **Verify the PIVOT view exists before writing report SQL**: run `SELECT COUNT(*) FROM v_{object}` first. If the view doesn't exist, create it (see **duckdb-operations** skill).

### Before writing a report

1. **Verify the PIVOT view exists**: `duckdb {{WORKSPACE_PATH}}/workspace.duckdb "SELECT COUNT(*) FROM v_{object}"` — if this fails, the view needs to be created first.
2. **Check the view columns**: `duckdb {{WORKSPACE_PATH}}/workspace.duckdb -json "SELECT * FROM v_{object} LIMIT 1"` — use the actual column names in your SQL (they are case-sensitive and may contain spaces).
3. **Test each panel's SQL individually**: Run each query to confirm it returns data before assembling the report JSON.

### Handling empty data

If a view exists but returns 0 rows, the chart will render but show nothing. This is fine — no special handling needed. However, if the user asks "why is the chart empty?", check:
- Are there entries in the object? `SELECT COUNT(*) FROM entries WHERE object_id = (SELECT id FROM objects WHERE name = '{object}')`
- Do entries have field values? `SELECT COUNT(*) FROM entry_fields WHERE entry_id IN (SELECT id FROM entries WHERE object_id = ...)`

---

## Example Reports

### Pipeline Funnel

```json
{
  "version": 1,
  "title": "Deal Pipeline",
  "description": "Deal count and value by stage",
  "panels": [
    {
      "id": "deals-by-stage",
      "title": "Deals by Stage",
      "type": "funnel",
      "sql": "SELECT \"Stage\", COUNT(*) as count FROM v_deal GROUP BY \"Stage\" ORDER BY count DESC",
      "mapping": { "nameKey": "Stage", "valueKey": "count" },
      "size": "half"
    },
    {
      "id": "revenue-by-stage",
      "title": "Revenue by Stage",
      "type": "bar",
      "sql": "SELECT \"Stage\", SUM(\"Amount\"::NUMERIC) as total FROM v_deal GROUP BY \"Stage\" ORDER BY total DESC",
      "mapping": { "xAxis": "Stage", "yAxis": ["total"] },
      "size": "half"
    }
  ],
  "filters": [
    { "id": "date", "type": "dateRange", "label": "Created", "column": "created_at" },
    {
      "id": "assignee",
      "type": "select",
      "label": "Assigned To",
      "sql": "SELECT DISTINCT \"Assigned To\" as value FROM v_deal WHERE \"Assigned To\" IS NOT NULL",
      "column": "Assigned To"
    }
  ]
}
```

### Contact Growth

```json
{
  "version": 1,
  "title": "Contact Growth",
  "description": "New contacts over time",
  "panels": [
    {
      "id": "growth-trend",
      "title": "Contacts Over Time",
      "type": "area",
      "sql": "SELECT DATE_TRUNC('month', created_at) as month, COUNT(*) as count FROM v_people GROUP BY month ORDER BY month",
      "mapping": { "xAxis": "month", "yAxis": ["count"] },
      "size": "full"
    }
  ]
}
```

---

## Inline Chat Reports

When a user asks for analytics in chat (without explicitly asking to save a report), emit the report JSON inside a fenced code block with language `report-json`. The web UI will render interactive charts inline:

````
Here's your pipeline analysis:

```report-json
{"version":1,"title":"Deals by Stage","panels":[{"id":"p1","title":"Deal Count","type":"bar","sql":"SELECT \"Stage\", COUNT(*) as count FROM v_deal GROUP BY \"Stage\" ORDER BY count DESC","mapping":{"xAxis":"Stage","yAxis":["count"]},"size":"full"}]}
```

Most deals are currently in the Discovery stage.
````

The user can then "Pin" the inline report to save it as a `.report.json` file.

---

## Post-Report Checklist

After creating a `.report.json` file:

- [ ] **Verify the PIVOT view exists**: `duckdb {{WORKSPACE_PATH}}/workspace.duckdb "SELECT COUNT(*) FROM v_{object}"` — create the view if missing
- [ ] **Test each panel's SQL individually**: Run each query against the DB to confirm it returns valid data
- [ ] Verify the report JSON is valid (proper JSON syntax, no trailing commas)
- [ ] Choose which directory the report should be created in `{{WORKSPACE_PATH}}` based on the context of the conversation, if nothing very relevant, create/use the `{{WORKSPACE_PATH}}/reports/` directory.
- [ ] Write the file: `{{WORKSPACE_PATH}}/**/{slug}.report.json`
- [ ] Tell the user they can view it in the workspace sidebar under whichever directory it was rightfully placed in based on the context.

---

## Choosing the Right Chart Type

- **Comparing categories** (status breakdown, source distribution): `bar` or `pie`
- **Time series** (growth, trends, revenue over time): `line` or `area`
- **Pipeline/conversion** (deal stages, lead funnel): `funnel`
- **Distribution/proportion** (market share, segment split): `pie` or `donut`
- **Multi-metric comparison** (performance scores): `radar`
- **Correlation** (price vs. size, score vs. revenue): `scatter`
- When in doubt, `bar` is the safest default
