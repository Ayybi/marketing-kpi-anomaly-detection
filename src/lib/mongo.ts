// B2 — Foundation DB client. RE-IMPLEMENTED for MongoDB (replaces the spec's
// `src/lib/supabase.ts`). Same contract: a single, shared, service-level handle used by
// all server/cron code. Dropping @supabase/supabase-js also removes the spec's
// "Node 22 WebSocket" gotcha — the mongodb driver runs on Node 20.19+.
import { MongoClient, type Db, type Collection } from "mongodb"
import type {
  KpiRuleRow,
  KpiFlagRow,
  ClientHealthScoreRow,
  ClientRow,
  ClientServiceRow,
  SyncLogRow,
} from "@/lib/types"

const uri = process.env.MONGODB_URI ?? "mongodb://127.0.0.1:27017"
const dbName = process.env.MONGODB_DB ?? "kpi_engine"

export const COLLECTIONS = {
  clients: "clients",
  clientServices: "client_services",
  users: "users",
  kpiFlags: "kpi_flags",
  kpiRules: "kpi_rules",
  clientHealthScores: "client_health_scores",
  syncLog: "sync_log",
} as const

// Cache the client across hot reloads / repeated imports so we do not leak connections.
type Cache = { client: MongoClient | null; promise: Promise<MongoClient> | null }
const globalForMongo = globalThis as unknown as { __kpiMongo?: Cache }
const cache: Cache = (globalForMongo.__kpiMongo ??= { client: null, promise: null })

export async function getMongoClient(): Promise<MongoClient> {
  if (cache.client) return cache.client
  if (!cache.promise) {
    cache.promise = new MongoClient(uri, {
      // Fail fast rather than hang if Mongo is unreachable — an unreachable store is an
      // ERROR (surfaced), never a silent empty result (the three-state read discipline).
      serverSelectionTimeoutMS: 5_000,
    }).connect()
  }
  cache.client = await cache.promise
  return cache.client
}

export async function getDb(): Promise<Db> {
  const client = await getMongoClient()
  return client.db(dbName)
}

/** Typed collection accessors — the equivalent of `supabaseAdmin.from("...")`. */
export async function collections(): Promise<{
  clients: Collection<ClientRow>
  clientServices: Collection<ClientServiceRow>
  kpiFlags: Collection<KpiFlagRow>
  kpiRules: Collection<KpiRuleRow>
  clientHealthScores: Collection<ClientHealthScoreRow>
  syncLog: Collection<SyncLogRow>
}> {
  const db = await getDb()
  return {
    clients: db.collection<ClientRow>(COLLECTIONS.clients),
    clientServices: db.collection<ClientServiceRow>(COLLECTIONS.clientServices),
    kpiFlags: db.collection<KpiFlagRow>(COLLECTIONS.kpiFlags),
    kpiRules: db.collection<KpiRuleRow>(COLLECTIONS.kpiRules),
    clientHealthScores: db.collection<ClientHealthScoreRow>(COLLECTIONS.clientHealthScores),
    syncLog: db.collection<SyncLogRow>(COLLECTIONS.syncLog),
  }
}

/** For scripts and tests. */
export async function closeMongo(): Promise<void> {
  if (cache.client) {
    await cache.client.close()
    cache.client = null
    cache.promise = null
  }
}
