---
name: composio-apps
description: Connected app tool recipes for Dench Integrations (Gmail, Slack, GitHub, Notion, Google Calendar, Linear, Stripe)
---

# Dench Integrations connected apps

Use the **Dench Integrations tools** only. In DenchClaw, always search first with `composio_search_tools`, inspect the returned full schemas plus plan/pitfall guidance, then execute the chosen tool via `composio_call_tool`. Ranked search is the only supported discovery path. Some sessions may still expose direct tool names like `GMAIL_FETCH_EMAILS`, but do not rely on that as the default path.

Do **not** use:
- `gog`
- shell CLIs for Gmail / Calendar / Drive / Slack / GitHub / Notion / Linear
- `curl`
- raw gateway HTTP calls
- direct provider REST calls

If the user mentions Dench Integrations, the connected-app layer, rube, map, MCP, or says an app is already connected, this is the only allowed integration path. If the integration wrapper tools are unavailable in the current session, stop and report repair guidance instead of bypassing them.

Do not rely on workspace cache files like `composio-tool-index.json`, `composio-tool-catalog.json`, or `composio-mcp-status.json` as runtime truth. `composio_search_tools` is the source of truth because it returns official integration search results, full `input_schema`, connection/account status, `recommended_plan_steps`, `known_pitfalls`, and a gateway-issued `execution_ref` inside `dispatcher_input`.

## General rules

- Tool names are **uppercase** with underscores (e.g. `GMAIL_FETCH_EMAILS`).
- Execute searched tools through `composio_call_tool` with the returned `execution_ref` and the final `arguments` object.
- Do not invent or alter `dispatcher_input`; copy it from `composio_search_tools` unchanged and only add the final `arguments`.
- Pass **JSON-shaped** arguments as the tool schema requires: arrays are arrays, not comma-separated strings.
- Read the returned `input_schema` before filling arguments. Use exact field names and types from that schema.
- Treat the live schema as authoritative over any recipe table below. Pay attention to `required`, property `type`, nested objects/arrays, enums, defaults, and pagination fields.
- If a call fails on argument shape, fix the types and retry once before escalating.
- If `composio_search_tools` says account selection is required, ask the user which connected account to use before calling `composio_call_tool`.
- If the returned search result includes pagination fields such as `starting_after`, `next_cursor`, `page`, or `page_token`, keep paginating until complete when the user asked for the full dataset.
- Never fall back to `gog`, curl, or raw gateway HTTP for a connected app task unless the user explicitly asks for that non-integration path.

## Gmail

| Intent | Tool | Defaults / notes |
|--------|------|------------------|
| List / read recent mail | `GMAIL_FETCH_EMAILS` | `label_ids`: `["INBOX"]`, `max_results`: `10` |
| Read one message | `GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID` | `message_id` from list results |
| Send mail | `GMAIL_SEND_EMAIL` | `to`, `subject`, `body` (use schema field names) |

**Gotcha:** `label_ids` must be an array like `["INBOX"]`, never a single string.

## Slack

| Intent | Tool | Defaults / notes |
|--------|------|------------------|
| Send a message | `SLACK_SEND_MESSAGE` | `channel`, `text` |
| List channels / DMs | `SLACK_LIST_CONVERSATIONS` | Use schema filters if needed |

**Gotcha:** `channel` is usually a channel ID (often starts with `C`), not the display name.

## GitHub

| Intent | Tool | Defaults / notes |
|--------|------|------------------|
| List repos for user | `GITHUB_LIST_REPOSITORIES_FOR_THE_AUTHENTICATED_USER` | Pagination per schema |
| Find / search pull requests | `GITHUB_FIND_PULL_REQUESTS` | Best first path for "recent PRs" or broad PR search |
| List pull requests in a repo | `GITHUB_LIST_PULL_REQUESTS` | Requires `owner` and `repo` |
| Get one pull request | `GITHUB_GET_A_PULL_REQUEST` | `owner`, `repo`, `pull_number` |
| Repo metadata | `GITHUB_GET_A_REPOSITORY` | `owner`, `repo` |
| Create issue | `GITHUB_CREATE_AN_ISSUE` | `owner`, `repo`, `title`, `body` |

## Notion

| Intent | Tool | Defaults / notes |
|--------|------|------------------|
| Search | `NOTION_SEARCH` | Query string per schema |
| Read page | `NOTION_GET_PAGE` | Page ID |
| Create page | `NOTION_CREATE_PAGE` | Parent object per schema |

## Google Calendar

| Intent | Tool | Defaults / notes |
|--------|------|------------------|
| List calendars | `GOOGLE_CALENDAR_CALENDAR_LIST` | Optional params per schema |
| Upcoming events | `GOOGLE_CALENDAR_EVENTS_LIST` | Prefer a clear time window when possible |
| List events | `GOOGLE_CALENDAR_EVENTS_LIST` | `calendar_id`, time range (`time_min` / `time_max` as RFC3339) |
| Find event | `GOOGLE_CALENDAR_EVENTS_LIST` | Use search text / date window fields supported by the schema |
| Create event | `GOOGLE_CALENDAR_CREATE_EVENT` | Calendar id + event payload per schema |

**Gotcha:** Datetimes should be RFC3339 strings.

## Linear

| Intent | Tool | Defaults / notes |
|--------|------|------------------|
| List issues | `LINEAR_LIST_ISSUES` | Filters per schema |
| Get issue | `LINEAR_GET_ISSUE` | Issue id |
| Create issue | `LINEAR_CREATE_ISSUE` | Team id, title, description per schema |

## Stripe

| Intent | Tool | Defaults / notes |
|--------|------|------------------|
| List subscriptions | `STRIPE_LIST_SUBSCRIPTIONS` | Use schema filters when needed; good starting point for ARR / trials / billing analysis |
| Search subscriptions | `STRIPE_SEARCH_SUBSCRIPTIONS` | Prefer when the user mentions a customer or subscription-specific filter |
| List customers | `STRIPE_LIST_CUSTOMERS` | Use for customer lookup and account drill-down |
| List invoices | `STRIPE_LIST_INVOICES` | Useful for billing status and revenue workflows |
| List charges | `STRIPE_LIST_CHARGES` | Good for payment activity and charge inspection |
| Retrieve balance | `STRIPE_RETRIEVE_BALANCE` | Good for current Stripe balance snapshots |

## Subagent handoff

When delegating, include: which app, the exact tool name, the `execution_ref`, and the argument object you intend (copy shapes from the live tool schema or `composio_search_tools`).
