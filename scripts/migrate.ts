// Migration CLI: creates the prerequisite stub (clients/users) FIRST, then the product schema
// (kpi_flags / kpi_rules / client_health_scores) with validators + indexes. Run: npm run migrate
import { getDb, closeMongo } from "@/lib/mongo"
import { applyPrerequisiteSchema, applyProductSchema } from "@/lib/schema"

async function main() {
  if (typeof process.loadEnvFile === "function") {
    try { process.loadEnvFile() } catch { /* no .env file — rely on real env */ }
  }
  const db = await getDb()
  console.log(`[migrate] connected to ${db.databaseName}`)
  await applyPrerequisiteSchema(db)
  console.log("[migrate] prerequisite tables ready (clients, users)")
  await applyProductSchema(db)
  console.log("[migrate] product schema ready (kpi_flags, kpi_rules, client_health_scores)")
  await closeMongo()
  console.log("[migrate] done")
}

main().catch(async (err) => {
  console.error("[migrate] failed:", err)
  await closeMongo()
  process.exit(1)
})
