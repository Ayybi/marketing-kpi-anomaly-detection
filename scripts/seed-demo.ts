// Demo seed: a curated roster of agency clients + live services + open flags, then a health
// recompute so the app renders an intentional dataset. Re-runnable (wipes prior demo docs).
// Run: npm run seed:demo
import { randomUUID } from "node:crypto"
import { getDb, closeMongo, COLLECTIONS } from "@/lib/mongo"
import { applyAllSchema } from "@/lib/schema"
import { seedRuleCatalog } from "@/lib/seed"
import { recomputeAllHealthScores } from "@/lib/health-score"

const DAY = 86_400_000
const iso = (daysAgo: number) => new Date(Date.now() - daysAgo * DAY).toISOString()

type Flag = { source: string; severity: "red" | "amber"; message: string; evidence: Record<string, unknown> }
type Demo = {
  slug: string; stage: string; status: string; touchedDaysAgo: number
  services: { type: string; amount: number; startedDaysAgo: number }[]
  flags: Flag[]
}

const CLIENTS: Demo[] = [
  {
    slug: "summit-roofing", stage: "maintenance", status: "late", touchedDaysAgo: 68,
    services: [{ type: "facebook", amount: 2500, startedDaysAgo: 420 }, { type: "lsa", amount: 900, startedDaysAgo: 300 }],
    flags: [
      { source: "payment_failed", severity: "red", message: "Stripe payment is late/failed", evidence: { billingStatus: "late" } },
      { source: "no_leads", severity: "red", message: "No leads from FB/LSA in the last 5 days", evidence: { leads: 0, windowDays: 5 } },
      { source: "fb_cpl_high", severity: "red", message: "Facebook CPL $184.00 (last 7d) is 3.2x the client's 14-day average of $57.50", evidence: { currentCpl: 184, baselineCpl: 57.5, ratio: 3.2, multiplier: 2, currentDays: 7, baselineDays: 14, minBaselineLeads: 5 } },
    ],
  },
  {
    slug: "bluepeak-hvac", stage: "fulfillment", status: "active", touchedDaysAgo: 41,
    services: [{ type: "facebook", amount: 3200, startedDaysAgo: 210 }, { type: "seo", amount: 1500, startedDaysAgo: 210 }],
    flags: [
      { source: "campaign_paused", severity: "red", message: "Facebook delivered earlier this month but has had 0 impressions for 7 days", evidence: { impressions7: 0, impressions30: 142_000, windowDays: 7 } },
      { source: "seo_traffic_drop", severity: "amber", message: "Organic sessions down 34% vs the prior 30 days (5,120 to 3,380)", evidence: { current: 3380, previous: 5120, pct: -34, dropPct: 20 } },
    ],
  },
  {
    slug: "ironclad-pest", stage: "maintenance", status: "active", touchedDaysAgo: 12,
    services: [{ type: "lsa", amount: 1100, startedDaysAgo: 520 }, { type: "seo", amount: 1200, startedDaysAgo: 520 }],
    flags: [
      { source: "lsa_lead_drop", severity: "amber", message: "LSA leads down 44% vs the prior 30 days (63 to 35)", evidence: { current: 35, previous: 63, pct: -44, dropPct: 30 } },
      { source: "lsa_cpl_up", severity: "amber", message: "LSA cost per lead up 61% vs the prior 30 days ($22.40 to $36.10)", evidence: { currentCpl: 36.1, previousCpl: 22.4, pct: 61, risePct: 40 } },
    ],
  },
  {
    slug: "coastal-dental", stage: "maintenance", status: "active", touchedDaysAgo: 33,
    services: [{ type: "seo", amount: 1800, startedDaysAgo: 640 }, { type: "facebook", amount: 1500, startedDaysAgo: 90 }],
    flags: [
      { source: "gbp_views_drop", severity: "amber", message: "GBP views down 27% vs the prior 30 days (18,400 to 13,430)", evidence: { current: 13430, previous: 18400, pct: -27, dropPct: 20 } },
    ],
  },
  {
    slug: "verde-landscaping", stage: "onboarding", status: "active", touchedDaysAgo: 4,
    services: [{ type: "facebook", amount: 1800, startedDaysAgo: 22 }],
    flags: [
      { source: "access_lost", severity: "red", message: "Platform access revoked or expired: GA4", evidence: { platforms: ["GA4"], manual: false } },
    ],
  },
  {
    slug: "apex-autoglass", stage: "maintenance", status: "active", touchedDaysAgo: 9,
    services: [{ type: "facebook", amount: 2100, startedDaysAgo: 380 }, { type: "lsa", amount: 800, startedDaysAgo: 380 }],
    flags: [
      { source: "fb_ctr_low", severity: "amber", message: "Facebook link CTR 0.42% is below the 0.8% floor", evidence: { ctr: 0.42, ctrFloor: 0.8, windowDays: 7 } },
    ],
  },
  {
    slug: "northstar-plumbing", stage: "maintenance", status: "active", touchedDaysAgo: 6,
    services: [{ type: "lsa", amount: 1400, startedDaysAgo: 700 }, { type: "seo", amount: 1600, startedDaysAgo: 700 }],
    flags: [],
  },
  {
    slug: "riverstone-law", stage: "maintenance", status: "active", touchedDaysAgo: 2,
    services: [{ type: "seo", amount: 2600, startedDaysAgo: 900 }, { type: "facebook", amount: 2400, startedDaysAgo: 900 }],
    flags: [],
  },
  {
    slug: "meadow-dermatology", stage: "onboarding", status: "promo", touchedDaysAgo: 1,
    services: [{ type: "seo", amount: 0, startedDaysAgo: 8 }],
    flags: [],
  },
  {
    slug: "granite-garage-doors", stage: "fulfillment", status: "active", touchedDaysAgo: 51,
    services: [{ type: "facebook", amount: 1900, startedDaysAgo: 160 }],
    flags: [
      { source: "client_dissatisfied", severity: "red", message: "Client voiced dissatisfaction on the monthly call", evidence: { manual: true, raisedBy: "demo" } },
    ],
  },
]

async function main() {
  if (typeof process.loadEnvFile === "function") { try { process.loadEnvFile() } catch { /* rely on env */ } }
  const db = await getDb()
  await applyAllSchema(db)
  await seedRuleCatalog(db)

  // wipe prior demo docs (tagged demo:true)
  for (const c of [COLLECTIONS.clients, COLLECTIONS.clientServices, COLLECTIONS.kpiFlags, COLLECTIONS.clientHealthScores]) {
    await db.collection(c).deleteMany({ demo: true })
  }

  const clients = db.collection(COLLECTIONS.clients)
  const services = db.collection(COLLECTIONS.clientServices)
  const flags = db.collection(COLLECTIONS.kpiFlags)

  for (const c of CLIENTS) {
    const id = randomUUID()
    await clients.insertOne({ id, slug: c.slug, status: c.status, stage: c.stage, deleted_at: null, last_touched_at: iso(c.touchedDaysAgo), demo: true } as never)
    for (const s of c.services) {
      await services.insertOne({ id: randomUUID(), client_id: id, service_type: s.type, status: "active", started_at: iso(s.startedDaysAgo), created_at: iso(s.startedDaysAgo), amount: s.amount, demo: true } as never)
    }
    for (const f of c.flags) {
      await flags.insertOne({ id: randomUUID(), client_id: id, source: f.source, severity: f.severity, message: f.message, evidence: f.evidence, status: "open", snoozed_until: null, checklist_item_id: null, created_at: iso(3), updated_at: iso(1), demo: true } as never)
    }
  }

  const { clientsScored } = await recomputeAllHealthScores()
  // tag the fresh snapshots so they are wiped on re-run
  await db.collection(COLLECTIONS.clientHealthScores).updateMany({ demo: { $exists: false } }, { $set: { demo: true } })

  console.log(`[seed:demo] ${CLIENTS.length} clients, ${clientsScored} health snapshots. Visit /app`)
  await closeMongo()
}

main().catch(async (e) => { console.error("[seed:demo] failed:", e); await closeMongo(); process.exit(1) })
