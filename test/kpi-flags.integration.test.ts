import { describe, it, expect, beforeEach, afterAll } from "vitest"
import type { Db } from "mongodb"
import { COLLECTIONS } from "@/lib/mongo"
import {
  createManualFlag, resolveFlag, snoozeFlag, unsnoozeFlag, reopenExpiredSnoozedFlags,
  listClientOpenFlags, listAtRiskClients, resolveClient,
} from "@/lib/kpi-flags"
import { freshDb, teardown, insertClient, openFlags } from "./helpers"

let db: Db

beforeEach(async () => { db = await freshDb() })
afterAll(teardown)

describe("flag lifecycle (B8)", () => {
  it("createManualFlag inserts, then upserts in place on the same (client, source)", async () => {
    const cid = await insertClient(db, { slug: "acme" })

    const r1 = await createManualFlag({ slugOrId: "acme", source: "client_dissatisfied", severity: "red", message: "unhappy", actorId: "u1" })
    expect(r1.ok).toBe(true)
    let flags = await openFlags(db, cid)
    expect(flags).toHaveLength(1)
    expect(flags[0]!.evidence).toMatchObject({ manual: true, raisedBy: "u1" })

    // same (client, source) again -> update in place, not a duplicate
    const r2 = await createManualFlag({ slugOrId: cid, source: "client_dissatisfied", severity: "amber", message: "still unhappy", actorId: "u2" })
    expect(r2.ok).toBe(true)
    flags = await openFlags(db, cid)
    expect(flags).toHaveLength(1)
    expect(flags[0]!.severity).toBe("amber")
    expect(flags[0]!.message).toBe("still unhappy")
  })

  it("resolveClient resolves by uuid or slug and returns null when missing", async () => {
    const cid = await insertClient(db, { slug: "beta", status: "late", stage: "onboarding" })
    expect(await resolveClient("beta")).toMatchObject({ id: cid, status: "late", stage: "onboarding" })
    expect(await resolveClient(cid)).toMatchObject({ id: cid })
    expect(await resolveClient("nope")).toBeNull()
  })

  it("createManualFlag on a missing client returns a not-found error", async () => {
    const r = await createManualFlag({ slugOrId: "ghost", source: "access_lost", severity: "red", message: "x" })
    expect(r).toEqual({ ok: false, error: "client not found" })
  })

  it("resolve / snooze / unsnooze transition status", async () => {
    const cid = await insertClient(db, { slug: "gamma" })
    await createManualFlag({ slugOrId: cid, source: "access_lost", severity: "red", message: "lost GA4" })
    const id = (await openFlags(db, cid))[0]!.id as string

    const until = new Date(Date.now() + 7 * 86_400_000).toISOString()
    expect(await snoozeFlag(id, until)).toBe(true)
    expect(await openFlags(db, cid)).toHaveLength(0)
    let doc = await db.collection(COLLECTIONS.kpiFlags).findOne({ id })
    expect(doc!.status).toBe("snoozed")
    expect(doc!.snoozed_until).toBe(until)

    expect(await unsnoozeFlag(id)).toBe(true)
    expect(await openFlags(db, cid)).toHaveLength(1)

    expect(await resolveFlag(id)).toBe(true)
    doc = await db.collection(COLLECTIONS.kpiFlags).findOne({ id })
    expect(doc!.status).toBe("resolved")
  })

  it("reopenExpiredSnoozedFlags reopens only past-due snoozes", async () => {
    const cid = await insertClient(db, { slug: "delta" })
    await createManualFlag({ slugOrId: cid, source: "access_lost", severity: "red", message: "x" })
    const id = (await openFlags(db, cid))[0]!.id as string

    const past = new Date(Date.now() - 86_400_000).toISOString()
    await snoozeFlag(id, past)
    const reopened = await reopenExpiredSnoozedFlags()
    expect(reopened).toBe(1)
    expect(await openFlags(db, cid)).toHaveLength(1)

    // a future snooze is left alone
    const future = new Date(Date.now() + 86_400_000).toISOString()
    await snoozeFlag(id, future)
    expect(await reopenExpiredSnoozedFlags()).toBe(0)
  })

  it("the partial unique index refuses a second open flag for one (client, source)", async () => {
    const cid = await insertClient(db, { slug: "epsilon" })
    await db.collection(COLLECTIONS.kpiFlags).insertOne({
      id: "f1", client_id: cid, source: "no_leads", severity: "red", message: "a", evidence: {},
      status: "open", snoozed_until: null, checklist_item_id: null,
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    })
    await expect(
      db.collection(COLLECTIONS.kpiFlags).insertOne({
        id: "f2", client_id: cid, source: "no_leads", severity: "amber", message: "b", evidence: {},
        status: "open", snoozed_until: null, checklist_item_id: null,
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      }),
    ).rejects.toThrow(/duplicate key/i)
  })

  it("listAtRiskClients groups open flags worst-first", async () => {
    const a = await insertClient(db, { slug: "a" })
    const b = await insertClient(db, { slug: "b" })
    await createManualFlag({ slugOrId: a, source: "access_lost", severity: "red", message: "r" })
    await createManualFlag({ slugOrId: b, source: "client_dissatisfied", severity: "red", message: "r" })
    await db.collection(COLLECTIONS.kpiFlags).insertOne({
      id: "extra", client_id: b, source: "no_leads", severity: "red", message: "r2", evidence: {},
      status: "open", snoozed_until: null, checklist_item_id: null,
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    })
    const atRisk = await listAtRiskClients()
    expect(atRisk[0]!.clientId).toBe(b) // 2 red > 1 red
    expect(atRisk[0]!.red).toBe(2)
    expect(await listClientOpenFlags(a)).toHaveLength(1)
  })

  it("the $jsonSchema validator rejects an out-of-enum source (CHECK equivalent)", async () => {
    const cid = await insertClient(db, {})
    await expect(
      db.collection(COLLECTIONS.kpiFlags).insertOne({
        id: "bad", client_id: cid, source: "not_a_real_rule", severity: "red", message: "x", evidence: {},
        status: "open", snoozed_until: null, checklist_item_id: null,
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      } as never),
    ).rejects.toThrow(/document failed validation/i)
  })
})
