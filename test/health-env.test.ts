import { describe, it, expect } from "vitest"
import { checkEnv } from "@/lib/health/env"

// A synthetic env with every required var present.
const FULL: Record<string, string | undefined> = {
  STRIPE_SECRET_KEY: "sk", META_ACCESS_TOKEN: "t", GA4_CREDENTIALS: "{}", GBP_CREDENTIALS: "{}",
  SEMRUSH_API_KEY: "k", CALLRAIL_API_KEY: "k", ANTHROPIC_API_KEY: "k", RESEND_API_KEY: "k",
  MONGODB_URI: "mongodb://x", CRON_SECRET: "s", VAULT_KEY: "v",
}

describe("checkEnv (Section 15 env.ts) — presence only, never value", () => {
  it("is ok when every required var is present", () => {
    const r = checkEnv(FULL)
    expect(r.ok).toBe(true)
    expect(r.missingRequired).toEqual([])
    expect(r.required.every(v => v.present)).toBe(true)
  })

  it("is not ok and lists missing required vars", () => {
    const env = { ...FULL }
    delete env.STRIPE_SECRET_KEY
    delete env.CRON_SECRET
    const r = checkEnv(env)
    expect(r.ok).toBe(false)
    expect(r.missingRequired.sort()).toEqual(["CRON_SECRET", "STRIPE_SECRET_KEY"])
  })

  it("treats a blank string as absent (not present)", () => {
    const r = checkEnv({ ...FULL, ANTHROPIC_API_KEY: "   " })
    expect(r.ok).toBe(false)
    expect(r.missingRequired).toContain("ANTHROPIC_API_KEY")
  })

  it("missing OPTIONAL vars do not break ok", () => {
    const r = checkEnv(FULL) // no SLACK_WEBHOOK_URL / SENTRY_DSN
    expect(r.ok).toBe(true)
    expect(r.optional.every(v => !v.present)).toBe(true)
  })
})
