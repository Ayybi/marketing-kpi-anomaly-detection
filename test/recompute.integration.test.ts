import { describe, it, expect, beforeEach, afterAll } from "vitest"
import type { Db } from "mongodb"
import { COLLECTIONS } from "@/lib/mongo"
import { recomputeAllHealthScores } from "@/lib/health-score"
import { freshDb, teardown, insertClient } from "./helpers"

let db: Db
beforeEach(async () => { db = await freshDb() })
afterAll(teardown)

async function addFlag(db: Db, clientId: string, severity: "red" | "amber", status = "open") {
  await db.collection(COLLECTIONS.kpiFlags).insertOne({
    id: `${clientId}-${severity}-${Math.random()}`, client_id: clientId, source: severity === "red" ? "no_leads" : "lead_drop",
    severity, message: "m", evidence: {}, status, snoozed_until: null, checklist_item_id: null,
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  })
}

describe("recomputeAllHealthScores (B6)", () => {
  it("persists one snapshot per non-churned client with the right score/band", async () => {
    const healthy = await insertClient(db, { slug: "healthy", last_touched_at: new Date().toISOString() })
    const risky = await insertClient(db, { slug: "risky", status: "late", last_touched_at: new Date().toISOString() })
    await addFlag(db, risky, "red")
    await addFlag(db, risky, "amber")

    const { clientsScored } = await recomputeAllHealthScores()
    expect(clientsScored).toBe(2)

    const snaps = db.collection(COLLECTIONS.clientHealthScores)
    const healthySnap = await snaps.findOne({ client_id: healthy })
    expect(healthySnap!.score).toBe(100)
    expect(healthySnap!.band).toBe("green")

    // risky: 1 red (-20) + 1 amber (-8) + billing late (-15) = 43 -> 57 amber
    const riskySnap = await snaps.findOne({ client_id: risky })
    expect(riskySnap!.score).toBe(57)
    expect(riskySnap!.band).toBe("amber")
  })

  it("excludes churned and soft-deleted clients", async () => {
    await insertClient(db, { slug: "churned", stage: "churned" })
    await insertClient(db, { slug: "deleted", deleted_at: new Date().toISOString() })
    const live = await insertClient(db, { slug: "live" })
    const { clientsScored } = await recomputeAllHealthScores()
    expect(clientsScored).toBe(1)
    const snap = await db.collection(COLLECTIONS.clientHealthScores).findOne({})
    expect(snap!.client_id).toBe(live)
  })

  it("only counts OPEN flags, not resolved/snoozed", async () => {
    const c = await insertClient(db, { last_touched_at: new Date().toISOString() })
    await addFlag(db, c, "red", "resolved")
    await addFlag(db, c, "amber", "snoozed")
    await recomputeAllHealthScores()
    const snap = await db.collection(COLLECTIONS.clientHealthScores).findOne({ client_id: c })
    expect(snap!.score).toBe(100) // resolved/snoozed do not deduct
  })

  it("returns zero and writes nothing when there are no clients", async () => {
    const { clientsScored } = await recomputeAllHealthScores()
    expect(clientsScored).toBe(0)
    expect(await db.collection(COLLECTIONS.clientHealthScores).countDocuments()).toBe(0)
  })
})
