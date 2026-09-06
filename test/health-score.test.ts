import { describe, it, expect } from "vitest"
import { computeHealthScore } from "@/lib/health-score"

describe("computeHealthScore (B6, verbatim)", () => {
  it("a clean client scores 100 / green", () => {
    const r = computeHealthScore({ redFlags: 0, amberFlags: 0, billingLate: false, daysSinceTouch: 0 })
    expect(r.score).toBe(100)
    expect(r.band).toBe("green")
  })

  it("red penalty is 20 each and caps at 40", () => {
    expect(computeHealthScore({ redFlags: 1, amberFlags: 0, billingLate: false, daysSinceTouch: null }).score).toBe(80)
    expect(computeHealthScore({ redFlags: 2, amberFlags: 0, billingLate: false, daysSinceTouch: null }).score).toBe(60)
    // 5 reds -> 100 deduction uncapped, but cap is 40
    expect(computeHealthScore({ redFlags: 5, amberFlags: 0, billingLate: false, daysSinceTouch: null }).score).toBe(60)
    expect(computeHealthScore({ redFlags: 5, amberFlags: 0, billingLate: false, daysSinceTouch: null }).components.redFlags).toBe(-40)
  })

  it("amber penalty is 8 each and caps at 24", () => {
    expect(computeHealthScore({ redFlags: 0, amberFlags: 1, billingLate: false, daysSinceTouch: null }).score).toBe(92)
    expect(computeHealthScore({ redFlags: 0, amberFlags: 10, billingLate: false, daysSinceTouch: null }).components.amberFlags).toBe(-24)
    expect(computeHealthScore({ redFlags: 0, amberFlags: 10, billingLate: false, daysSinceTouch: null }).score).toBe(76)
  })

  it("billing-late applies a flat 15", () => {
    expect(computeHealthScore({ redFlags: 0, amberFlags: 0, billingLate: true, daysSinceTouch: null }).score).toBe(85)
  })

  it("recency: -10 over 30 days, -20 over 60 days, 0 otherwise and when null", () => {
    // (-0 === 0 is true; the verbatim code negates a 0 deduction to -0)
    expect(computeHealthScore({ redFlags: 0, amberFlags: 0, billingLate: false, daysSinceTouch: null }).components.recency === 0).toBe(true)
    expect(computeHealthScore({ redFlags: 0, amberFlags: 0, billingLate: false, daysSinceTouch: 30 }).components.recency === 0).toBe(true)
    expect(computeHealthScore({ redFlags: 0, amberFlags: 0, billingLate: false, daysSinceTouch: 31 }).components.recency).toBe(-10)
    expect(computeHealthScore({ redFlags: 0, amberFlags: 0, billingLate: false, daysSinceTouch: 61 }).components.recency).toBe(-20)
  })

  it("score floors at 0 and never goes negative", () => {
    const r = computeHealthScore({ redFlags: 10, amberFlags: 10, billingLate: true, daysSinceTouch: 90 })
    // 40 + 24 + 15 + 20 = 99 -> 1; make it worse is impossible past 0, but verify floor holds
    expect(r.score).toBeGreaterThanOrEqual(0)
    expect(r.score).toBe(1)
  })

  it("bands: green >=80, amber >=50, red <50", () => {
    expect(computeHealthScore({ redFlags: 1, amberFlags: 0, billingLate: false, daysSinceTouch: null }).band).toBe("green") // 80
    expect(computeHealthScore({ redFlags: 2, amberFlags: 1, billingLate: false, daysSinceTouch: null }).band).toBe("amber") // 52
    expect(computeHealthScore({ redFlags: 2, amberFlags: 0, billingLate: true, daysSinceTouch: 61 }).band).toBe("red") // 100-40-15-20=25
  })
})
