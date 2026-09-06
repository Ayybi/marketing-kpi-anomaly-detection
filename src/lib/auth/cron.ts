// B2 — Cron auth (verbatim from the spec). Framework-agnostic; unchanged by the MongoDB swap.
import { NextResponse } from "next/server"

function isCronAuthorized(secret: string | undefined, authHeader: string | null): boolean {
  if (!secret) return false
  return authHeader === `Bearer ${secret}`
}

export function assertCronSecret(request: Request): NextResponse | null {
  if (!isCronAuthorized(process.env.CRON_SECRET, request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  return null
}
