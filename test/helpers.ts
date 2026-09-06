import { randomUUID } from "node:crypto"
import type { Db } from "mongodb"
import { getDb, closeMongo, COLLECTIONS } from "@/lib/mongo"
import { applyAllSchema } from "@/lib/schema"
import { seedRuleCatalog } from "@/lib/seed"

/** Fresh, fully-migrated + seeded test DB for a single test. */
export async function freshDb(): Promise<Db> {
  const db = await getDb()
  await db.dropDatabase()
  await applyAllSchema(db)
  await seedRuleCatalog(db)
  return db
}

export async function teardown(): Promise<void> {
  await closeMongo()
}

const nowIso = () => new Date().toISOString()

export async function insertClient(
  db: Db,
  c: { id?: string; status?: string | null; stage?: string | null; deleted_at?: string | null; last_touched_at?: string | null; slug?: string | null },
): Promise<string> {
  const id = c.id ?? randomUUID()
  await db.collection(COLLECTIONS.clients).insertOne({
    id,
    status: c.status ?? "active",
    stage: c.stage ?? "maintenance",
    deleted_at: c.deleted_at ?? null,
    last_touched_at: c.last_touched_at ?? null,
    slug: c.slug ?? null,
  })
  return id
}

export async function insertService(
  db: Db,
  s: { client_id: string; service_type: string; status?: string | null; started_at?: string | null; amount?: number | null },
): Promise<void> {
  await db.collection(COLLECTIONS.clientServices).insertOne({
    id: randomUUID(),
    client_id: s.client_id,
    service_type: s.service_type,
    status: s.status ?? "active",
    started_at: s.started_at ?? nowIso(),
    created_at: nowIso(),
    amount: s.amount ?? 0,
  })
}

/** Enable/disable a rule by key (all seeded rules are global scope). */
export async function setRuleEnabled(db: Db, ruleKey: string, enabled: boolean): Promise<void> {
  await db.collection(COLLECTIONS.kpiRules).updateOne({ rule_key: ruleKey, scope: "global" }, { $set: { enabled } })
}

/** Leave only the given rule keys enabled; disable the rest (keeps engine tests focused). */
export async function onlyEnableRules(db: Db, ruleKeys: string[]): Promise<void> {
  await db.collection(COLLECTIONS.kpiRules).updateMany({ scope: "global" }, { $set: { enabled: false } })
  await db.collection(COLLECTIONS.kpiRules).updateMany({ scope: "global", rule_key: { $in: ruleKeys } }, { $set: { enabled: true } })
}

export async function openFlags(db: Db, clientId?: string): Promise<Array<Record<string, unknown>>> {
  const q: Record<string, unknown> = { status: "open" }
  if (clientId) q.client_id = clientId
  return db.collection(COLLECTIONS.kpiFlags).find(q).toArray() as unknown as Array<Record<string, unknown>>
}

/** A daily-breakdown row generator: `days` most-recent dates ending yesterday, each with `per`. */
export function daily(
  days: number,
  per: (i: number) => { leads?: number; spend?: number; impressions?: number; ctr?: number; clicks?: number },
  endDaysAgo = 1,
): Array<{ date: string; leads: number; spend: number; impressions: number; ctr: number; clicks?: number }> {
  const out = []
  for (let i = 0; i < days; i++) {
    const d = new Date(Date.now() - (endDaysAgo + i) * 86_400_000)
    const p = per(i)
    out.push({
      date: d.toISOString().split("T")[0]!,
      leads: p.leads ?? 0,
      spend: p.spend ?? 0,
      impressions: p.impressions ?? 0,
      ctr: p.ctr ?? 0,
      ...(p.clicks !== undefined ? { clicks: p.clicks } : {}),
    })
  }
  return out
}
