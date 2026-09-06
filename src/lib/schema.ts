// B4 — Schema. RE-IMPLEMENTED from the spec's Postgres DDL to MongoDB, preserving every
// enforced constraint:
//   - CHECK (source IN (...)) / (severity IN ...) / (status IN ...) / (band IN ...) / score 0..100
//        -> $jsonSchema collection validators
//   - partial UNIQUE indexes (one open flag per (client_id, source); one per checklist_item_id;
//     one global rule per rule_key; one client override per (rule_key, client_id))
//        -> MongoDB partial + unique indexes
//   - RLS (ENABLE/FORCE ROW LEVEL SECURITY) has NO MongoDB equivalent; multi-tenant isolation
//     (the spec's `org_id` new-work) must be enforced at the application layer. Documented, not silent.
import type { Db, IndexDescription } from "mongodb"
import { COLLECTIONS } from "@/lib/mongo"

// The full, grown-across-migrations source CHECK enum (B4).
export const KPI_FLAG_SOURCES = [
  "onboarding_delay", "onboarding_stage_delay", "no_leads", "fb_spend_zero", "payment_failed",
  "fb_cpl_high", "fb_no_leads_7d", "fb_ctr_low", "lsa_no_impressions", "lsa_no_leads",
  "lsa_cpl_up", "lsa_lead_drop", "lead_drop", "seo_traffic_drop", "seo_no_movement",
  "seo_no_organic_leads", "gbp_views_drop", "campaign_paused", "client_dissatisfied", "access_lost",
  "ai_website_seo_sla",
] as const

const kpiFlagsValidator = {
  $jsonSchema: {
    bsonType: "object",
    required: ["id", "client_id", "source", "severity", "message", "status", "created_at", "updated_at"],
    properties: {
      id: { bsonType: "string" },
      client_id: { bsonType: "string" },
      source: { enum: [...KPI_FLAG_SOURCES] },
      severity: { enum: ["amber", "red"] },
      message: { bsonType: "string" },
      evidence: { bsonType: "object" },
      status: { enum: ["open", "resolved", "snoozed"] },
      snoozed_until: { bsonType: ["string", "null"] },
      checklist_item_id: { bsonType: ["string", "null"] },
      created_at: { bsonType: "string" },
      updated_at: { bsonType: "string" },
    },
  },
}

const kpiRulesValidator = {
  $jsonSchema: {
    bsonType: "object",
    required: ["id", "rule_key", "label", "window_days", "severity", "scope", "enabled", "config"],
    properties: {
      id: { bsonType: "string" },
      rule_key: { bsonType: "string" },
      label: { bsonType: "string" },
      service: { bsonType: ["string", "null"] },
      window_days: { bsonType: ["int", "long", "double"] },
      severity: { enum: ["amber", "red"] },
      scope: { enum: ["global", "client"] },
      client_id: { bsonType: ["string", "null"] },
      enabled: { bsonType: "bool" },
      config: { bsonType: "object" },
    },
  },
}

const clientHealthScoresValidator = {
  $jsonSchema: {
    bsonType: "object",
    required: ["id", "client_id", "score", "band", "components", "calculated_at"],
    properties: {
      id: { bsonType: "string" },
      client_id: { bsonType: "string" },
      score: { bsonType: ["int", "long", "double"], minimum: 0, maximum: 100 },
      band: { enum: ["green", "amber", "red"] },
      components: { bsonType: "object" },
      calculated_at: { bsonType: "string" },
    },
  },
}

const kpiFlagsIndexes: IndexDescription[] = [
  { key: { id: 1 }, name: "uq_kpi_flags_id", unique: true },
  { key: { client_id: 1, status: 1 }, name: "idx_kpi_flags_client_status" },
  { key: { severity: 1 }, name: "idx_kpi_flags_severity", partialFilterExpression: { status: "open" } },
  // one open TASK flag per checklist_item_id (checklist_item_id present as a string)
  {
    key: { checklist_item_id: 1 },
    name: "uq_kpi_flags_open_task",
    unique: true,
    partialFilterExpression: { status: "open", checklist_item_id: { $type: "string" } },
  },
  // one open PERFORMANCE/MANUAL flag per (client_id, source) (checklist_item_id null) — the reconcile key
  {
    key: { client_id: 1, source: 1 },
    name: "uq_kpi_flags_open_stage",
    unique: true,
    partialFilterExpression: { status: "open", checklist_item_id: { $type: "null" } },
  },
]

const kpiRulesIndexes: IndexDescription[] = [
  { key: { id: 1 }, name: "uq_kpi_rules_id", unique: true },
  { key: { rule_key: 1 }, name: "uq_kpi_rules_global", unique: true, partialFilterExpression: { scope: "global" } },
  {
    key: { rule_key: 1, client_id: 1 },
    name: "uq_kpi_rules_client",
    unique: true,
    partialFilterExpression: { scope: "client" },
  },
]

const clientHealthScoresIndexes: IndexDescription[] = [
  { key: { id: 1 }, name: "uq_client_health_scores_id", unique: true },
  { key: { client_id: 1, calculated_at: -1 }, name: "idx_client_health_scores_client_calc" },
]

const syncLogValidator = {
  $jsonSchema: {
    bsonType: "object",
    required: ["id", "source", "status", "detail", "ran_at", "created_at"],
    properties: {
      id: { bsonType: "string" },
      source: { bsonType: "string" },
      status: { enum: ["ok", "partial", "error"] },
      detail: { bsonType: "object" },
      ran_at: { bsonType: "string" },
      created_at: { bsonType: "string" },
    },
  },
}

const syncLogIndexes: IndexDescription[] = [
  { key: { id: 1 }, name: "uq_sync_log_id", unique: true },
  { key: { source: 1, ran_at: -1 }, name: "idx_sync_log_source_ran" },
]

async function ensureCollection(
  db: Db,
  name: string,
  validator?: Record<string, unknown>,
): Promise<void> {
  const existing = await db.listCollections({ name }).toArray()
  if (existing.length === 0) {
    await db.createCollection(name, validator ? { validator } : undefined)
  } else if (validator) {
    await db.command({ collMod: name, validator })
  }
}

async function ensureIndexes(db: Db, name: string, indexes: IndexDescription[]): Promise<void> {
  if (indexes.length > 0) await db.collection(name).createIndexes(indexes)
}

/**
 * Prerequisite tables (B4): the product schema references clients(id) and the recompute code reads
 * clients.status/stage/deleted_at/last_touched_at. Create the stub FIRST — the product schema is
 * meaningless without it (mirrors "the migration will fail without the stub").
 */
export async function applyPrerequisiteSchema(db: Db): Promise<void> {
  await ensureCollection(db, COLLECTIONS.clients)
  await ensureCollection(db, COLLECTIONS.clientServices)
  await ensureCollection(db, COLLECTIONS.users)
  await db.collection(COLLECTIONS.clients).createIndexes([{ key: { id: 1 }, name: "uq_clients_id", unique: true }])
  await db.collection(COLLECTIONS.clientServices).createIndexes([
    { key: { id: 1 }, name: "uq_client_services_id", unique: true },
    { key: { client_id: 1, status: 1 }, name: "idx_client_services_client_status" },
  ])
  await db.collection(COLLECTIONS.users).createIndexes([{ key: { id: 1 }, name: "uq_users_id", unique: true }])
}

/** Product schema (B4): kpi_flags, kpi_rules, client_health_scores with validators + indexes. */
export async function applyProductSchema(db: Db): Promise<void> {
  await ensureCollection(db, COLLECTIONS.kpiFlags, kpiFlagsValidator)
  await ensureCollection(db, COLLECTIONS.kpiRules, kpiRulesValidator)
  await ensureCollection(db, COLLECTIONS.clientHealthScores, clientHealthScoresValidator)
  await ensureCollection(db, COLLECTIONS.syncLog, syncLogValidator)
  await ensureIndexes(db, COLLECTIONS.kpiFlags, kpiFlagsIndexes)
  await ensureIndexes(db, COLLECTIONS.kpiRules, kpiRulesIndexes)
  await ensureIndexes(db, COLLECTIONS.clientHealthScores, clientHealthScoresIndexes)
  await ensureIndexes(db, COLLECTIONS.syncLog, syncLogIndexes)
}

/** Run both, in the mandated order. */
export async function applyAllSchema(db: Db): Promise<void> {
  await applyPrerequisiteSchema(db)
  await applyProductSchema(db)
}
