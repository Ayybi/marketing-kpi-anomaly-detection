// Seed CLI: inserts the rule catalog (idempotent). Run after migrate. Run: npm run seed
import { getDb, closeMongo } from "@/lib/mongo"
import { seedRuleCatalog } from "@/lib/seed"

async function main() {
  if (typeof process.loadEnvFile === "function") {
    try { process.loadEnvFile() } catch { /* no .env file — rely on real env */ }
  }
  const db = await getDb()
  const { inserted, total } = await seedRuleCatalog(db)
  console.log(`[seed] rule catalog: ${inserted} inserted, ${total - inserted} already present (${total} total)`)
  await closeMongo()
}

main().catch(async (err) => {
  console.error("[seed] failed:", err)
  await closeMongo()
  process.exit(1)
})
