---
name: lead-enrichment
description: Find leads, enrich contacts/companies, discover emails, and scrape data via enrichment APIs (Apollo, Hunter, Firecrawl). Supports direct API keys or Obul.
metadata: { "openclaw": { "inject": true, "always": true, "emoji": "🔍" } }
---

# Lead Finding & Enrichment

You have access to enrichment APIs for people search, contact/company enrichment, email discovery, LinkedIn scraping, and web scraping. Two provider modes are supported — check env vars to determine which to use.

## Provider Detection

Check available environment variables to determine your provider mode:

1. **If `OBUL_API_KEY` is set** → use **Obul mode** (all services via single key)
2. **If individual keys are set** (`APOLLO_API_KEY`, `HUNTER_API_KEY`, `FIRECRAWL_API_KEY`) → use **Direct mode** (native API endpoints)
3. **Only call providers whose keys are available** — skip services without configured keys
4. Both modes can coexist — e.g. use Direct for Apollo + Obul for StableEnrich

---

## Capabilities

| Capability | Services | Notes |
|------------|----------|-------|
| People Search | Apollo | Find leads by title, location, company, seniority, keywords |
| Person Enrichment | Apollo | Enrich by email, LinkedIn URL, or name + company |
| Company Enrichment | Apollo | Enrich by domain — funding, size, industry, tech stack |
| Email Finding | Hunter | Find email from first name + last name + domain |
| Email Verification | Hunter | Check deliverability status and confidence score |
| Domain Search | Hunter | Find all emails at a company domain |
| LinkedIn Scraping | StableEnrich (Obul only) | Full profile data via Clado — no direct API equivalent |
| Web Scraping | Firecrawl | Any URL to markdown |
| Bulk Operations | Apollo | Batch enrich up to 100 records per request |

---

## Provider Reference: Direct Mode

Use native API endpoints with individual API keys.

### Apollo (APOLLO_API_KEY)

- **Base URL**: `https://api.apollo.io`
- **Auth**: `-H "x-api-key: $APOLLO_API_KEY"`

#### Search People

```bash
curl -s -X POST "https://api.apollo.io/api/v1/mixed_people/search" \
  -H "x-api-key: $APOLLO_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "person_titles": ["CTO", "VP Engineering"],
    "organization_locations": ["United States"],
    "organization_num_employees_ranges": ["51,200"],
    "per_page": 25,
    "page": 1
  }'
```

Key filters: `person_titles`, `person_locations`, `organization_locations`, `organization_domains`, `organization_num_employees_ranges` (e.g. `"1,10"`, `"11,50"`, `"51,200"`, `"201,500"`, `"501,1000"`, `"1001,5000"`, `"5001,10000"`), `q_keywords`, `person_seniorities` (e.g. `"c_suite"`, `"vp"`, `"director"`, `"manager"`).

Response includes: `people[]` with `first_name`, `last_name`, `title`, `organization.name`, `email`, `linkedin_url`, `city`, `state`, `country`.

#### Enrich Person (by email or LinkedIn)

```bash
curl -s -X POST "https://api.apollo.io/api/v1/people/match" \
  -H "x-api-key: $APOLLO_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com"
  }'
```

Can also match by: `linkedin_url`, `first_name` + `last_name` + `organization_name`.

Response: `person` object with full profile — `title`, `headline`, `organization` (name, website, industry, size), `phone_numbers`, `email`, `linkedin_url`, `city`, `state`, `country`, `departments`, `seniority`.

#### Enrich Company (by domain)

```bash
curl -s -X POST "https://api.apollo.io/api/v1/organizations/enrich" \
  -H "x-api-key: $APOLLO_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "domain": "example.com"
  }'
```

Response: `organization` with `name`, `website_url`, `linkedin_url`, `founded_year`, `industry`, `estimated_num_employees`, `total_funding`, `latest_funding_round_date`, `technologies`, `city`, `state`, `country`, `short_description`.

#### Bulk Enrich (up to 100 people per request)

```bash
curl -s -X POST "https://api.apollo.io/api/v1/people/bulk_match" \
  -H "x-api-key: $APOLLO_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "details": [
      {"email": "person1@example.com"},
      {"email": "person2@example.com"},
      {"linkedin_url": "https://linkedin.com/in/person3"}
    ]
  }'
```

Response: `matches[]` array with full person objects.

### Hunter (HUNTER_API_KEY)

- **Base URL**: `https://api.hunter.io`
- **Auth**: `?api_key=$HUNTER_API_KEY` (query parameter)

#### Find Email (name + domain)

```bash
curl -s "https://api.hunter.io/v2/email-finder?domain=example.com&first_name=John&last_name=Doe&api_key=$HUNTER_API_KEY"
```

Response: `data.email`, `data.score` (confidence 0-100), `data.position`, `data.company`.

#### Verify Email

```bash
curl -s "https://api.hunter.io/v2/email-verifier?email=user@example.com&api_key=$HUNTER_API_KEY"
```

Response: `data.result` (`deliverable`, `undeliverable`, `risky`, `unknown`), `data.score`, `data.regexp`, `data.mx_records`.

#### Domain Search (all emails at a company)

```bash
curl -s "https://api.hunter.io/v2/domain-search?domain=example.com&limit=20&api_key=$HUNTER_API_KEY"
```

Response: `data.emails[]` with `value`, `type` (personal/generic), `confidence`, `first_name`, `last_name`, `position`.

### Firecrawl (FIRECRAWL_API_KEY)

- **Base URL**: `https://api.firecrawl.dev`
- **Auth**: `-H "Authorization: Bearer $FIRECRAWL_API_KEY"`

#### Scrape URL to Markdown

```bash
curl -s -X POST "https://api.firecrawl.dev/v1/scrape" \
  -H "Authorization: Bearer $FIRECRAWL_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com/about",
    "formats": ["markdown"]
  }'
```

Response: `data.markdown` — full page content as markdown.

#### Map Site URLs

```bash
curl -s -X POST "https://api.firecrawl.dev/v1/map" \
  -H "Authorization: Bearer $FIRECRAWL_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com"
  }'
```

Response: `links[]` — all discoverable URLs on the site.

#### Crawl Site

```bash
curl -s -X POST "https://api.firecrawl.dev/v1/crawl" \
  -H "Authorization: Bearer $FIRECRAWL_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com",
    "limit": 10,
    "scrapeOptions": { "formats": ["markdown"] }
  }'
```

Response: returns a job ID — poll `GET /v1/crawl/{id}` for results.

---

## Provider Reference: Obul Mode

All requests use Obul with a single API key. Obul handles x402 payment negotiation automatically.

- **Auth header**: `-H "x-obul-api-key: $OBUL_API_KEY"`
- **URL pattern**: `https://proxy.obul.ai/proxy/https/{upstream-host}/{path}`

> **Important**: Obul routes through x402 wrapper services — the upstream hosts differ from native API endpoints.

### Apollo via x402

**Base**: `proxy.obul.ai/proxy/https/x402.orth.sh/apollo`

> **Note**: The search endpoint path is `/api_search` (not `/search`).

#### Search People

```bash
curl -s -X POST "https://proxy.obul.ai/proxy/https/x402.orth.sh/apollo/api/v1/mixed_people/api_search" \
  -H "x-obul-api-key: $OBUL_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "person_titles": ["CTO", "VP Engineering"],
    "organization_locations": ["United States"],
    "organization_num_employees_ranges": ["51,200"],
    "per_page": 25,
    "page": 1
  }'
```

#### Enrich Person

```bash
curl -s -X POST "https://proxy.obul.ai/proxy/https/x402.orth.sh/apollo/api/v1/people/match" \
  -H "x-obul-api-key: $OBUL_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com"
  }'
```

#### Enrich Company

```bash
curl -s -X POST "https://proxy.obul.ai/proxy/https/x402.orth.sh/apollo/api/v1/organizations/enrich" \
  -H "x-obul-api-key: $OBUL_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "domain": "example.com"
  }'
```

#### Bulk Enrich

```bash
curl -s -X POST "https://proxy.obul.ai/proxy/https/x402.orth.sh/apollo/api/v1/people/bulk_match" \
  -H "x-obul-api-key: $OBUL_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "details": [
      {"email": "person1@example.com"},
      {"email": "person2@example.com"},
      {"linkedin_url": "https://linkedin.com/in/person3"}
    ]
  }'
```

### Hunter via x402

**Base**: `proxy.obul.ai/proxy/https/x402.orth.sh/hunter`

> **Note**: Auth is via header (not query param) — Obul handles this.

#### Find Email

```bash
curl -s "https://proxy.obul.ai/proxy/https/x402.orth.sh/hunter/v2/email-finder?domain=example.com&first_name=John&last_name=Doe" \
  -H "x-obul-api-key: $OBUL_API_KEY"
```

#### Verify Email

```bash
curl -s "https://proxy.obul.ai/proxy/https/x402.orth.sh/hunter/v2/email-verifier?email=user@example.com" \
  -H "x-obul-api-key: $OBUL_API_KEY"
```

#### Domain Search

```bash
curl -s "https://proxy.obul.ai/proxy/https/x402.orth.sh/hunter/v2/domain-search?domain=example.com&limit=20" \
  -H "x-obul-api-key: $OBUL_API_KEY"
```

### StableEnrich (Obul only)

**Base**: `proxy.obul.ai/proxy/https/stableenrich.dev`

StableEnrich is an aggregator available only through Obul. It provides access to multiple enrichment sources through a unified API, including Clado for LinkedIn scraping.

#### People Search (via Apollo)

```bash
curl -s -X POST "https://proxy.obul.ai/proxy/https/stableenrich.dev/api/apollo/people-search" \
  -H "x-obul-api-key: $OBUL_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "person_titles": ["CTO"],
    "organization_locations": ["United States"],
    "per_page": 25
  }'
```

#### LinkedIn Profile Scrape (via Clado)

```bash
curl -s -X POST "https://proxy.obul.ai/proxy/https/stableenrich.dev/api/clado/linkedin-profile" \
  -H "x-obul-api-key: $OBUL_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "linkedin_url": "https://www.linkedin.com/in/username"
  }'
```

Response: Full LinkedIn profile — `headline`, `summary`, `experience[]`, `education[]`, `skills[]`, `connections_count`, `location`.

#### Email Finder (via Hunter)

```bash
curl -s -X POST "https://proxy.obul.ai/proxy/https/stableenrich.dev/api/hunter/email-finder" \
  -H "x-obul-api-key: $OBUL_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "domain": "example.com",
    "first_name": "John",
    "last_name": "Doe"
  }'
```

#### Google Maps Places Search

```bash
curl -s -X POST "https://proxy.obul.ai/proxy/https/stableenrich.dev/api/google-maps/search" \
  -H "x-obul-api-key: $OBUL_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "coffee shops in San Francisco"
  }'
```

### Firecrawl via x402

**Base**: `proxy.obul.ai/proxy/https/firecrawl.x402endpoints.com`

> **Note**: Different host from native Firecrawl (`firecrawl.x402endpoints.com` not `api.firecrawl.dev`).

#### Scrape URL to Markdown

```bash
curl -s -X POST "https://proxy.obul.ai/proxy/https/firecrawl.x402endpoints.com/v1/scrape" \
  -H "x-obul-api-key: $OBUL_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com/about",
    "formats": ["markdown"]
  }'
```

### Obul Pricing

| Task | API | Cost |
|------|-----|------|
| Search people | Apollo via x402 | $0.01/req |
| Enrich person | Apollo via x402 | $0.01/req |
| Enrich company | Apollo via x402 | $0.01/req |
| Bulk enrich | Apollo via x402 | $0.05/batch |
| Find email | Hunter via x402 | $0.01/req |
| Verify email | Hunter via x402 | $0.01/req |
| Domain search | Hunter via x402 | $0.01/req |
| LinkedIn scrape | StableEnrich/Clado | $0.02/req |
| People search (aggregated) | StableEnrich/Apollo | $0.01/req |
| Web scrape | Firecrawl via x402 | $0.001/req |

---

## Workflows

### Find Leads

When the user asks to find leads matching criteria:

1. **Search** with Apollo people search using their filters (title, location, company size, etc.)
2. **Store** results in the CRM `people` table (see CRM Integration below)
3. **Report** count found, sample results, and estimated cost

### Enrich Existing Contacts

When the user has contacts in their CRM that need enrichment:

1. **Read** contacts from DuckDB that have missing fields
2. **Enrich** each via Apollo person match (by email or LinkedIn URL)
   - Use **bulk match** if 10+ contacts (cheaper at scale)
3. **Update** CRM records with enriched data
4. **Report** fields filled, success rate, cost

### Email Discovery

When the user needs email addresses:

1. **Try Hunter email-finder** first (name + domain → email)
2. **Verify** the found email with Hunter email-verifier
3. **Fallback**: If Hunter misses, try Apollo person match which often includes email
4. **Store** verified emails in CRM with verification status

### Company Research

When the user wants company intelligence:

1. **Apollo org enrich** by domain → structured company data
2. **Firecrawl scrape** company website for additional context
3. **Hunter domain search** to find key contacts
4. **Store** in CRM `companies` table

---

## CRM Integration

Map API responses to DuckDB fields. Always check existing schema first with:
```sql
DESCRIBE people;
DESCRIBE companies;
```

### People Field Mapping

| API Field | CRM Field | Source |
|-----------|-----------|--------|
| `first_name` | `first_name` | Apollo/Hunter |
| `last_name` | `last_name` | Apollo/Hunter |
| `email` | `email` | Apollo/Hunter |
| `title` | `job_title` | Apollo |
| `organization.name` | `company` | Apollo |
| `linkedin_url` | `linkedin_url` | Apollo/StableEnrich |
| `phone_numbers[0].sanitized_number` | `phone` | Apollo |
| `city`, `state`, `country` | `location` | Apollo |
| Hunter `data.result` | `email_verified` | Hunter |
| `headline` | `headline` | Apollo/StableEnrich |
| `seniority` | `seniority` | Apollo |

### Companies Field Mapping

| API Field | CRM Field | Source |
|-----------|-----------|--------|
| `name` | `name` | Apollo |
| `website_url` | `website` | Apollo |
| `industry` | `industry` | Apollo |
| `estimated_num_employees` | `employee_count` | Apollo |
| `total_funding` | `funding` | Apollo |
| `short_description` | `description` | Apollo |
| `linkedin_url` | `linkedin_url` | Apollo |
| `founded_year` | `founded` | Apollo |
| `technologies` | `tech_stack` | Apollo |

If CRM fields don't exist yet, create them with appropriate types before inserting data.

---

## Cost Guidelines

- **Always prefer the cheapest API** that can fulfil the request
- **Log estimated costs** when running batch operations: `echo "Estimated cost: N requests × $X = $Y"`
- **Use bulk endpoints** when processing 6+ records (Apollo bulk match handles up to 100)
- **Firecrawl first** for simple web data before reaching for enrichment APIs
- **Cache results**: Before calling an API, check if the CRM already has the data
- **Confirm with user** before operations estimated to cost > $1.00
