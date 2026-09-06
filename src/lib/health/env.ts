// Section 15 — env.ts. Checks the PRESENCE (never the value) of required + optional env vars for the
// agency stack. A missing required var makes the overall report not-ok (the route returns 503).
// Three-state discipline: presence is present/absent; we never read or log the secret value.

export type EnvVarStatus = {
  name: string
  present: boolean
  required: boolean
  /** What this var is for + how to fix it when absent (surfaced as a tooltip in the dashboard). */
  hint: string
}

export type EnvReport = {
  ok: boolean
  missingRequired: string[]
  required: EnvVarStatus[]
  optional: EnvVarStatus[]
  generatedAt: string
}

type EnvSpec = { name: string; hint: string }

// The broader required-env set the System Health monitor checks (Section 12/15). NOTE (Mongo-swap):
// the spec's "Supabase service role" is replaced here by MONGODB_URI, the persistence credential.
const REQUIRED: EnvSpec[] = [
  { name: "STRIPE_SECRET_KEY", hint: "Stripe billing. Add your Stripe secret key (sk_live_… / sk_test_…)." },
  { name: "META_ACCESS_TOKEN", hint: "Meta/Facebook Ads. Add a long-lived Meta system-user access token." },
  { name: "GA4_CREDENTIALS", hint: "Google Analytics 4. Add the service-account JSON (or its path)." },
  { name: "GBP_CREDENTIALS", hint: "Google Business Profile. Add the service-account JSON (or its path)." },
  { name: "SEMRUSH_API_KEY", hint: "SEMrush SEO ranks. Add your SEMrush API key." },
  { name: "CALLRAIL_API_KEY", hint: "CallRail call tracking. Add your CallRail API key." },
  { name: "ANTHROPIC_API_KEY", hint: "Anthropic. Add your Anthropic API key (sk-ant-…)." },
  { name: "RESEND_API_KEY", hint: "Resend email delivery. Add your Resend API key (re_…)." },
  { name: "MONGODB_URI", hint: "Persistence. Add the MongoDB connection string." },
  { name: "CRON_SECRET", hint: "Cron guard. Set a strong shared secret; crons fail closed without it." },
  { name: "VAULT_KEY", hint: "Credential encryption key. Set a 32-byte base64 key for the vault." },
]

const OPTIONAL: EnvSpec[] = [
  { name: "SLACK_WEBHOOK_URL", hint: "Optional: Slack delivery for red-flag alerts." },
  { name: "SENTRY_DSN", hint: "Optional: error reporting." },
]

/** A var is PRESENT when defined and non-blank. We never inspect the value beyond that. */
function isPresent(env: Record<string, string | undefined>, name: string): boolean {
  const v = env[name]
  return typeof v === "string" && v.trim() !== ""
}

export function checkEnv(env: Record<string, string | undefined> = process.env): EnvReport {
  const required = REQUIRED.map(s => ({ name: s.name, present: isPresent(env, s.name), required: true, hint: s.hint }))
  const optional = OPTIONAL.map(s => ({ name: s.name, present: isPresent(env, s.name), required: false, hint: s.hint }))
  const missingRequired = required.filter(v => !v.present).map(v => v.name)
  return {
    ok: missingRequired.length === 0,
    missingRequired,
    required,
    optional,
    generatedAt: new Date().toISOString(),
  }
}
