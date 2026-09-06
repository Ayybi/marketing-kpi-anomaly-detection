import { describe, it, expect } from "vitest"
import {
  pctChange, sumLastDays, fbSpendZeroFinding, todayInTimeZone, num,
  graceAccountsForSource, buildLiveServiceTypes, earliestServiceStart, inWinterHold,
} from "@/lib/kpi-engine-logic"

describe("pctChange — THE zero-baseline invariant", () => {
  it("returns null when previous <= 0 (no signal, not a 100% drop)", () => {
    expect(pctChange(0, 0)).toBeNull()
    expect(pctChange(5, 0)).toBeNull()
    expect(pctChange(5, -3)).toBeNull()
  })
  it("computes a normal percentage change otherwise", () => {
    expect(pctChange(50, 100)).toBe(-50)
    expect(pctChange(150, 100)).toBe(50)
  })
})

describe("sumLastDays", () => {
  const rows = [
    { date: "2026-01-05", leads: 5 },
    { date: "2026-01-04", leads: 4 },
    { date: "2026-01-03", leads: 3 },
    { date: "2026-01-02", leads: 2 },
  ]
  it("sums the most recent N days by date desc", () => {
    expect(sumLastDays(rows, 2, "leads")).toBe(9) // 5 + 4
    expect(sumLastDays(rows, 10, "leads")).toBe(14)
  })
  it("returns 0 for empty/undefined", () => {
    expect(sumLastDays<{ date: string; leads: number }>(undefined, 5, "leads")).toBe(0)
    expect(sumLastDays<{ date: string; leads: number }>([], 5, "leads")).toBe(0)
  })
})

describe("fbSpendZeroFinding (BUG-148: drops the in-progress day)", () => {
  const today = "2026-01-10"
  it("flags two consecutive complete $0 days, ignoring today", () => {
    const rows = [
      { date: "2026-01-10", spend: 100 }, // in-progress -> ignored
      { date: "2026-01-09", spend: 0 },
      { date: "2026-01-08", spend: 0 },
    ]
    const f = fbSpendZeroFinding(rows, today)
    expect(f.flag).toBe(true)
    expect(f.judgedDates).toEqual(["2026-01-08", "2026-01-09"])
    expect(f.spend).toEqual([0, 0])
  })
  it("does not flag when a complete day had spend", () => {
    const rows = [
      { date: "2026-01-09", spend: 0 },
      { date: "2026-01-08", spend: 12 },
    ]
    expect(fbSpendZeroFinding(rows, today).flag).toBe(false)
  })
  it("does not flag with fewer than two complete days", () => {
    expect(fbSpendZeroFinding([{ date: "2026-01-09", spend: 0 }], today).flag).toBe(false)
  })
})

describe("todayInTimeZone", () => {
  it("falls back to UTC on an invalid tz", () => {
    const d = new Date("2026-01-10T23:30:00Z")
    expect(todayInTimeZone("Not/AZone", d)).toBe("2026-01-10")
  })
  it("respects a real tz (LA is a day behind late UTC)", () => {
    const d = new Date("2026-01-11T02:00:00Z") // 6pm Jan 10 in LA
    expect(todayInTimeZone("America/Los_Angeles", d)).toBe("2026-01-10")
  })
})

describe("num (positive-with-fallback config reader)", () => {
  it("uses the value when finite and > 0, else the fallback", () => {
    expect(num({ a: 5 }, "a", 2)).toBe(5)
    expect(num({ a: 0 }, "a", 2)).toBe(2)
    expect(num({ a: -1 }, "a", 2)).toBe(2)
    expect(num({}, "a", 2)).toBe(2)
    expect(num({ a: "7" }, "a", 2)).toBe(7)
  })
})

describe("graceAccountsForSource", () => {
  it("maps a rule source to its dependent account(s)", () => {
    expect(graceAccountsForSource("no_leads")).toEqual(["fb", "lsa"])
    expect(graceAccountsForSource("lead_drop")).toEqual(["fb", "lsa"])
    expect(graceAccountsForSource("fb_cpl_high")).toEqual(["fb"])
    expect(graceAccountsForSource("campaign_paused")).toEqual(["fb"])
    expect(graceAccountsForSource("lsa_no_leads")).toEqual(["lsa"])
    expect(graceAccountsForSource("payment_failed")).toEqual([])
    expect(graceAccountsForSource("access_lost")).toEqual([])
  })
})

describe("buildLiveServiceTypes / earliestServiceStart", () => {
  it("dedupes service types per client", () => {
    const m = buildLiveServiceTypes([
      { client_id: "a", service_type: "facebook" },
      { client_id: "a", service_type: "facebook" },
      { client_id: "a", service_type: "lsa" },
      { client_id: "b", service_type: "seo" },
    ])
    expect([...m.get("a")!].sort()).toEqual(["facebook", "lsa"])
    expect([...m.get("b")!]).toEqual(["seo"])
  })
  it("picks the earliest start per client, started_at over created_at", () => {
    const m = earliestServiceStart([
      { client_id: "a", started_at: "2026-02-01", created_at: "2026-01-01" },
      { client_id: "a", started_at: "2026-01-15" },
    ])
    expect(m.get("a")).toBe(new Date("2026-01-15").getTime())
  })
})

describe("inWinterHold (seasonal hold guard)", () => {
  it("is false unless seasonalHold === true", () => {
    expect(inWinterHold({})).toBe(false)
    expect(inWinterHold({ seasonalHold: false })).toBe(false)
  })
  it("honours winterMonths against the current month", () => {
    const currentMonth = new Date().getMonth() + 1
    expect(inWinterHold({ seasonalHold: true, winterMonths: [currentMonth] })).toBe(true)
    const other = currentMonth === 1 ? 7 : 1
    expect(inWinterHold({ seasonalHold: true, winterMonths: [other] })).toBe(false)
  })
})
