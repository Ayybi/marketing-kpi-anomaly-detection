import { describe, it, expect, beforeEach, afterAll } from "vitest"
import { randomUUID } from "node:crypto"
import type { Db } from "mongodb"
import { COLLECTIONS } from "@/lib/mongo"
import {
  classifyCron, staleAfterMinutes, getCronHealth, CRON_SPECS,
  CRON_SOURCE_KPI_ENGINE, CRON_SOURCE_HEALTH_SCORE, type CronSpec,
} from "@/lib/health/crons"
import type { SyncLogRow } from "@/lib/types"
import { freshDb, teardown } from "./helpers"

const kpiSpec: CronSpec = { source: "kpi-engine", label: "KPI", intervalMinutes: 30 }
const now = new Date("2026-09-06T12:00:00Z")

function row(source: string, status: "ok" | "partial" | "error", ranAt: Date): SyncLogRow {
  return { id: randomUUID(), source, status, detail: {}, ran_at: ranAt.toISOString(), created_at: ranAt.toISOString() }
}

describe("classifyCron (Section 15 crons.ts) — pure freshness classification", () => {
  it("staleAfter = min(3 x interval, interval + 48h)", () => {
    expect(staleAfterMinutes(30)).toBe(90) // 3*30=90 < 30+2880
    expect(staleAfterMinutes(24 * 60)).toBe(24 * 60 + 48 * 60) // daily: 2880 (interval+grace) < 4320
  })

  it("never_logged -> fail (absent, distinct from an error)", () => {
    const r = classifyCron(kpiSpec, null, now)
    expect(r.freshness).toBe("never_logged")
    expect(r.overall).toBe("fail")
  })

  it("fresh + ok -> ok", () => {
    const r = classifyCron(kpiSpec, row("kpi-engine", "ok", new Date(now.getTime() - 10 * 60_000)), now)
    expect(r.freshness).toBe("ok")
    expect(r.overall).toBe("ok")
    expect(r.ageMinutes).toBe(10)
  })

  it("older than staleAfter -> stale/fail even if last status was ok", () => {
    const r = classifyCron(kpiSpec, row("kpi-engine", "ok", new Date(now.getTime() - 200 * 60_000)), now)
    expect(r.freshness).toBe("stale")
    expect(r.overall).toBe("fail")
  })

  it("fresh + partial -> warn; fresh + error -> fail", () => {
    expect(classifyCron(kpiSpec, row("kpi-engine", "partial", new Date(now.getTime() - 5 * 60_000)), now).overall).toBe("warn")
    expect(classifyCron(kpiSpec, row("kpi-engine", "error", new Date(now.getTime() - 5 * 60_000)), now).overall).toBe("fail")
  })
})

describe("getCronHealth (DB-backed)", () => {
  let db: Db
  beforeEach(async () => { db = await freshDb() })
  afterAll(teardown)

  it("classifies each configured cron from the latest sync_log row", async () => {
    const col = db.collection(COLLECTIONS.syncLog)
    // kpi-engine: a recent ok run; plus an older row to prove we take the LATEST
    await col.insertOne(row(CRON_SOURCE_KPI_ENGINE, "error", new Date(Date.now() - 60 * 60_000)))
    await col.insertOne(row(CRON_SOURCE_KPI_ENGINE, "ok", new Date(Date.now() - 5 * 60_000)))
    // health-score: never logged

    const health = await getCronHealth(new Date(), CRON_SPECS)
    const kpi = health.find(h => h.source === CRON_SOURCE_KPI_ENGINE)!
    const hs = health.find(h => h.source === CRON_SOURCE_HEALTH_SCORE)!
    expect(kpi.overall).toBe("ok") // latest row wins over the older error
    expect(kpi.lastStatus).toBe("ok")
    expect(hs.freshness).toBe("never_logged")
    expect(hs.overall).toBe("fail")
  })
})
