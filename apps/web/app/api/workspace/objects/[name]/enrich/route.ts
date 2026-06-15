import {
	duckdbQueryOnFile,
	duckdbExecOnFile,
	findDuckDBForObject,
} from "@/lib/workspace";
import {
	getIntegrationsState,
	resolveDenchGatewayCredentials,
} from "@/lib/integrations";
import {
	extractDomain,
	extractEnrichmentValue,
	getEnrichFieldsForApolloPath,
	getEnrichmentColumns,
	isEligibleInputField,
	type EnrichmentColumnDef,
} from "@/lib/enrichment-columns";
import {
	gatewayCompanySearch,
	gatewayPersonContact,
	pollEnrichmentJobWithTimeout,
	type EnrichFieldToken,
} from "@/lib/dench-gateway-enrichment";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function sqlEscape(s: string): string {
	return s.replace(/'/g, "''");
}

type EnrichRequestBody = {
	fieldId: string;
	apolloPath: string;
	category: "people" | "company";
	inputFieldName: string;
	scope: "all" | "empty" | number;
	/**
	 * Optional explicit list of entry IDs to enrich. When provided, the SQL
	 * scope is narrowed to these entries (intersected with the `scope`
	 * filter, so e.g. `scope: "empty"` + `entryIds: [...]` enriches only
	 * those listed entries that don't already have a value). Used by the
	 * row-selection "Enrich" bulk action so the user can target the rows
	 * they checked instead of the whole table.
	 *
	 * Capped at MAX_ENTRY_IDS to keep the SQL `IN (...)` clause bounded
	 * and to make abuse via huge payloads obvious.
	 */
	entryIds?: string[];
};

const MAX_ENTRY_IDS = 5000;
const ENTRY_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

/**
 * POST /api/workspace/objects/[name]/enrich
 * Enriches entries via the Dench Cloud gateway (FullEnrich-backed APIs).
 * Streams progress as SSE so the frontend can show a waterfall effect.
 */
export async function POST(
	req: Request,
	{ params }: { params: Promise<{ name: string }> },
) {
	const { name } = await params;

	if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
		return Response.json({ error: "Invalid object name" }, { status: 400 });
	}

	// --- Gating checks ---
	const state = getIntegrationsState();
	if (!state.denchCloud.isPrimaryProvider) {
		return Response.json({ error: "Dench Cloud is not the active provider." }, { status: 403 });
	}
	if (!state.denchCloud.hasKey) {
		return Response.json({ error: "No Dench Cloud API key configured." }, { status: 403 });
	}
	const apollo = state.integrations.find((i) => i.id === "apollo");
	if (!apollo?.enabled) {
		return Response.json({ error: "Apollo integration is not enabled." }, { status: 403 });
	}

	const { apiKey, gatewayUrl } = resolveDenchGatewayCredentials();
	if (!apiKey || !gatewayUrl) {
		return Response.json({ error: "Gateway credentials unavailable." }, { status: 500 });
	}

	const body: EnrichRequestBody = await req.json();
	const { fieldId, apolloPath, category, inputFieldName, scope, entryIds } = body;

	if (!fieldId || !apolloPath || !category || !inputFieldName) {
		return Response.json({ error: "Missing required fields." }, { status: 400 });
	}

	if (category !== "people" && category !== "company") {
		return Response.json({ error: "Invalid category." }, { status: 400 });
	}

	// Validate entryIds early so a malformed payload fails fast instead of
	// landing as a SQL error mid-stream. Empty array is treated as "no narrowing"
	// (i.e. fall through to the regular scope filter) so callers don't have to
	// special-case the "no-selection" path on the client.
	let narrowedEntryIds: string[] | undefined;
	if (entryIds !== undefined) {
		if (!Array.isArray(entryIds)) {
			return Response.json({ error: "entryIds must be an array." }, { status: 400 });
		}
		if (entryIds.length > MAX_ENTRY_IDS) {
			return Response.json(
				{ error: `Too many entryIds (max ${MAX_ENTRY_IDS}).` },
				{ status: 400 },
			);
		}
		const cleaned: string[] = [];
		for (const id of entryIds) {
			if (typeof id !== "string" || !ENTRY_ID_PATTERN.test(id)) {
				return Response.json({ error: "Invalid entry ID." }, { status: 400 });
			}
			cleaned.push(id);
		}
		if (cleaned.length > 0) {
			narrowedEntryIds = cleaned;
		}
	}

	// Resolve the canonical column def (for requiredFields + extraction fallbacks).
	// Falls back to a synthetic column when callers pass a custom apolloPath so
	// existing integrations keep working without bypassing extraction.
	const matchedColumn: EnrichmentColumnDef = getEnrichmentColumns(category).find(
		(candidate) => candidate.apolloPath === apolloPath,
	) ?? {
		label: "",
		key: apolloPath,
		fieldType: "text",
		apolloPath,
		// Unknown column: never send a narrowing contract; gateway uses its default
		// backfill list (getRequiredFieldsForApolloPath would yield [] here anyway).
		requiredFields: [],
	};

	if (
		scope !== "all"
		&& scope !== "empty"
		&& (
			typeof scope !== "number"
			|| scope <= 0
			|| !Number.isFinite(scope)
			|| !Number.isInteger(scope)
		)
	) {
		return Response.json({ error: "Invalid scope." }, { status: 400 });
	}

	const dbFile = findDuckDBForObject(name);
	if (!dbFile) {
		return Response.json({ error: "DuckDB not found." }, { status: 404 });
	}

	// Resolve object
	const objects = duckdbQueryOnFile<{ id: string }>(
		dbFile,
		`SELECT id FROM objects WHERE name = '${sqlEscape(name)}' LIMIT 1`,
	);
	if (objects.length === 0) {
		return Response.json({ error: `Object '${name}' not found.` }, { status: 404 });
	}
	const objectId = objects[0].id;

	// Resolve the input field ID by name
	const inputFields = duckdbQueryOnFile<{ id: string; name: string; type: string }>(
		dbFile,
		`SELECT id, name, type FROM fields WHERE object_id = '${sqlEscape(objectId)}' AND name = '${sqlEscape(inputFieldName)}'`,
	);
	if (inputFields.length === 0) {
		return Response.json({ error: `Input field '${inputFieldName}' not found.` }, { status: 404 });
	}
	if (!isEligibleInputField(category, inputFields[0])) {
		return Response.json({ error: `Input field '${inputFieldName}' is not supported for ${category} enrichment.` }, { status: 400 });
	}
	const inputFieldId = inputFields[0].id;

	// Verify enrichment field exists
	const enrichField = duckdbQueryOnFile<{ id: string }>(
		dbFile,
		`SELECT id FROM fields WHERE id = '${sqlEscape(fieldId)}' AND object_id = '${sqlEscape(objectId)}'`,
	);
	if (enrichField.length === 0) {
		return Response.json({ error: "Enrichment field not found." }, { status: 404 });
	}

	// Load entries with their input values
	let entrySql = `
		SELECT e.id as entry_id, ef.value as input_value
		FROM entries e
		LEFT JOIN entry_fields ef ON ef.entry_id = e.id AND ef.field_id = '${sqlEscape(inputFieldId)}'
		WHERE e.object_id = '${sqlEscape(objectId)}'
	`;

	if (narrowedEntryIds && narrowedEntryIds.length > 0) {
		// Compose with the `scope` filter rather than replacing it: lets
		// callers say "enrich the selected rows that are still empty" when
		// the row selection includes already-enriched entries.
		const inList = narrowedEntryIds.map((id) => `'${sqlEscape(id)}'`).join(",");
		entrySql += ` AND e.id IN (${inList})`;
	}

	if (scope === "empty") {
		entrySql += `
			AND e.id NOT IN (
				SELECT ef2.entry_id FROM entry_fields ef2
				WHERE ef2.field_id = '${sqlEscape(fieldId)}'
				AND ef2.value IS NOT NULL AND ef2.value != ''
			)
		`;
	}

	if (typeof scope === "number" && scope > 0) {
		entrySql += ` LIMIT ${scope}`;
	}

	const entries = duckdbQueryOnFile<{ entry_id: string; input_value: string | null }>(
		dbFile,
		entrySql,
	);

	const total = entries.length;

	// Set up SSE stream
	const encoder = new TextEncoder();
	let cancelled = false;
	const stream = new ReadableStream({
		async start(controller) {
			function send(data: Record<string, unknown>) {
				controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
			}

			let enriched = 0;
			let failed = 0;

			for (let i = 0; i < entries.length; i++) {
				if (cancelled) break;
				const entry = entries[i];
				const inputValue = entry.input_value?.trim();

				if (!inputValue) {
					failed++;
					send({
						type: "error",
						entryId: entry.entry_id,
						error: "No input value",
						current: i + 1,
						total,
					});
					continue;
				}

				try {
					const enrichFields = getEnrichFieldsForApolloPath(
						category,
						matchedColumn.apolloPath,
					);
					const result = await callDenchGateway(
						gatewayUrl,
						apiKey,
						category,
						inputValue,
						enrichFields,
					);
					if (cancelled) break;

					if (!result.ok) {
						if (result.pending && result.enrichmentId) {
							send({
								type: "pending",
								entryId: entry.entry_id,
								enrichmentId: result.enrichmentId,
								current: i + 1,
								total,
							});
						}
						failed++;
						send({
							type: "error",
							entryId: entry.entry_id,
							error: result.error,
							current: i + 1,
							total,
						});
						continue;
					}

					const value = extractEnrichmentValue(
						result.payload,
						matchedColumn,
					);

					if (value == null) {
						failed++;
						send({
							type: "error",
							entryId: entry.entry_id,
							error: "Field not found in response",
							current: i + 1,
							total,
						});
						continue;
					}

					patchEntryField(dbFile, entry.entry_id, fieldId, value);

					enriched++;
					send({
						type: "progress",
						entryId: entry.entry_id,
						value,
						current: i + 1,
						total,
					});
				} catch (err) {
					if (cancelled) break;
					failed++;
					send({
						type: "error",
						entryId: entry.entry_id,
						error: err instanceof Error ? err.message : "Unknown error",
						current: i + 1,
						total,
					});
				}
			}

			if (!cancelled) {
				send({ type: "done", enriched, failed, total });
				controller.close();
			}
		},
		cancel() {
			cancelled = true;
		},
	});

	return new Response(stream, {
		headers: {
			"Content-Type": "text/event-stream",
			"Cache-Control": "no-cache",
			Connection: "keep-alive",
		},
	});
}

type GatewayCallResult =
	| { ok: true; payload: Record<string, unknown> }
	| { ok: false; error: string; pending?: boolean; enrichmentId?: string };

async function callDenchGateway(
	gatewayUrl: string,
	apiKey: string,
	category: "people" | "company",
	inputValue: string,
	enrichFields: EnrichFieldToken[] | undefined,
): Promise<GatewayCallResult> {
	if (category === "people") {
		if (inputValue.includes("linkedin.com")) {
			const contact = await gatewayPersonContact(gatewayUrl, apiKey, {
				linkedinUrl: inputValue,
				enrichFields,
			});
			if (!contact.ok) {
				return { ok: false, error: contact.error };
			}
			if (contact.result.kind === "person") {
				return { ok: true, payload: contact.result.person };
			}
			if (contact.result.kind === "empty") {
				return { ok: false, error: contact.result.reason };
			}

			const poll = await pollEnrichmentJobWithTimeout(
				gatewayUrl,
				apiKey,
				contact.result.enrichmentId,
			);
			if (!poll.ok) {
				return {
					ok: false,
					error: poll.error,
					pending: poll.pending,
					enrichmentId: contact.result.enrichmentId,
				};
			}
			return { ok: true, payload: poll.person };
		}
		if (inputValue.includes("@")) {
			return { ok: false, error: "People enrichment requires a LinkedIn URL" };
		}
		return { ok: false, error: "Unsupported people identifier" };
	}

	const domain = extractDomain(inputValue);
	if (!domain) {
		return { ok: false, error: "Could not extract domain" };
	}

	const company = await gatewayCompanySearch(gatewayUrl, apiKey, domain, 1);
	if (!company.ok) {
		return { ok: false, error: company.error };
	}
	if (!company.company) {
		return { ok: false, error: "No data returned" };
	}
	return { ok: true, payload: { organization: company.company } };
}

function patchEntryField(
	dbFile: string,
	entryId: string,
	fieldId: string,
	value: string,
) {
	const escapedValue = `'${sqlEscape(value)}'`;

	const existing = duckdbQueryOnFile<{ cnt: number }>(
		dbFile,
		`SELECT COUNT(*) as cnt FROM entry_fields WHERE entry_id = '${sqlEscape(entryId)}' AND field_id = '${sqlEscape(fieldId)}'`,
	);

	if (existing[0]?.cnt > 0) {
		duckdbExecOnFile(
			dbFile,
			`UPDATE entry_fields SET value = ${escapedValue} WHERE entry_id = '${sqlEscape(entryId)}' AND field_id = '${sqlEscape(fieldId)}'`,
		);
	} else {
		duckdbExecOnFile(
			dbFile,
			`INSERT INTO entry_fields (entry_id, field_id, value) VALUES ('${sqlEscape(entryId)}', '${sqlEscape(fieldId)}', ${escapedValue})`,
		);
	}

	const now = new Date().toISOString();
	duckdbExecOnFile(
		dbFile,
		`UPDATE entries SET updated_at = '${now}' WHERE id = '${sqlEscape(entryId)}'`,
	);
}
