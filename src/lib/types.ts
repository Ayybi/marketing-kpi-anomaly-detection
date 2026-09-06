// B3 — Types (verbatim from the spec). These are storage-agnostic and unchanged by the
// MongoDB swap.

export type KpiFlagStatus = "open" | "resolved" | "snoozed"
export type KpiSeverity = "amber" | "red"
export type HealthBand = "green" | "amber" | "red"

export type KpiRule = {
  id: string
  ruleKey: string
  label: string
  service: string | null
  windowDays: number
  severity: KpiSeverity
  scope: "global" | "client"
  clientId: string | null
  enabled: boolean
  config: Record<string, unknown>
}

export type KpiFlag = {
  id: string
  clientId: string
  source: string
  severity: KpiSeverity
  message: string
  evidence: Record<string, unknown>
  status: KpiFlagStatus
  snoozedUntil: string | null
  checklistItemId: string | null
  createdAt: string
}

export type HealthScore = {
  score: number
  band: HealthBand
  components: Record<string, number>
}

// ---------------------------------------------------------------------------
// Persistence-shape types (MongoDB documents). The public types above use camelCase
// per the spec; the stored documents use snake_case to match the DDL column names so
// the reconcile/query code reads identically to the spec's Supabase calls.
// ---------------------------------------------------------------------------

/** A row of `kpi_rules` as stored/loaded. */
export type KpiRuleRow = {
  id: string
  rule_key: string
  label: string
  service: string | null
  window_days: number
  severity: KpiSeverity
  scope: "global" | "client"
  client_id: string | null
  enabled: boolean
  config: Record<string, unknown>
  created_at: string
  updated_at: string
}

/** A row of `kpi_flags` as stored/loaded. */
export type KpiFlagRow = {
  id: string
  client_id: string
  source: string
  severity: KpiSeverity
  message: string
  evidence: Record<string, unknown>
  status: KpiFlagStatus
  snoozed_until: string | null
  checklist_item_id: string | null
  created_at: string
  updated_at: string
}

/** A row of `client_health_scores` as stored. */
export type ClientHealthScoreRow = {
  id: string
  client_id: string
  score: number
  band: HealthBand
  components: Record<string, number>
  calculated_at: string
}

/** Minimal `clients` shape read by the engine (the tenant/identity seam). */
export type ClientRow = {
  id: string
  status: string | null
  stage: string | null
  deleted_at: string | null
  last_touched_at: string | null
  // Optional slug for the manual-flag resolver (B8's resolveClient).
  slug?: string | null
}

/**
 * `sync_log` — the observability seam (Section 2/15). One row per cron/integration run; the System
 * Health monitor reads the latest row per source to classify freshness.
 */
export type SyncLogStatus = "ok" | "partial" | "error"
export type SyncLogRow = {
  id: string
  source: string // e.g. "kpi-engine" | "health-score"
  status: SyncLogStatus
  detail: Record<string, unknown>
  ran_at: string
  created_at: string
}

/**
 * `client_services` — part of the clients+client_services identity seam (Section 2). Drives
 * scope (a live service status) and per-rule service-gating (a client's live service types).
 */
export type ClientServiceRow = {
  id: string
  client_id: string
  service_type: string // "facebook" | "lsa" | "seo" (matches kpi_rules.service seed values)
  status: string | null // live set: active | late | promo | on_us | pending
  started_at: string | null
  created_at: string | null
  amount: number | null // monthly amount, summed into MRR for the status board
}
