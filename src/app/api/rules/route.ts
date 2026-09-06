// GET /api/rules            -> global rule catalog
// GET /api/rules?clientId=   -> a client's effective rules (global defaults + overrides)
import { NextResponse } from "next/server"
import { requireUser } from "@/lib/auth/access"
import { listGlobalRules, listClientRules } from "@/lib/rules"

export const dynamic = "force-dynamic"

export async function GET(request: Request): Promise<NextResponse> {
  const auth = requireUser(request)
  if ("error" in auth) return auth.error
  const clientId = new URL(request.url).searchParams.get("clientId")
  if (clientId) return NextResponse.json({ clientId, rules: await listClientRules(clientId) })
  return NextResponse.json({ rules: await listGlobalRules() })
}
