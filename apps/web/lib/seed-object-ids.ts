/**
 * Stable IDs for the CRM seed objects (people, company, email_thread, ...).
 *
 * Defined in a client-safe module — no DuckDB / fs imports — so React
 * components can compare a relation's `related_object_id` against these
 * constants to decide whether to route to a dedicated CRM profile
 * (`PersonProfile` / `CompanyProfile`) or fall back to the generic
 * entry-detail modal.
 *
 * The server-side migration code in `workspace-schema-migrations.ts`
 * re-exports these via `ONBOARDING_OBJECT_IDS`.
 */

export const SEED_OBJECT_IDS = {
	people: "seed_obj_people_00000000000000",
	company: "seed_obj_company_0000000000000",
	email_thread: "seed_obj_email_thread_000000000",
	email_message: "seed_obj_email_message_00000000",
	calendar_event: "seed_obj_calendar_event_0000000",
	interaction: "seed_obj_interaction_00000000000",
} as const;

export type SeedObjectKey = keyof typeof SEED_OBJECT_IDS;

/** Convenience predicates used by the workspace UI for relation routing. */
export function isSeedPeopleObjectId(id: string | null | undefined): boolean {
	return !!id && id === SEED_OBJECT_IDS.people;
}

export function isSeedCompanyObjectId(id: string | null | undefined): boolean {
	return !!id && id === SEED_OBJECT_IDS.company;
}
