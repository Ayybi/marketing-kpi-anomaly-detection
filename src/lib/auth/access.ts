// Auth / RBAC seam. STUB (new work): the spec's requireUser/requireRole + org-scoped access is
// dashboard-specific and the multi-tenant/OAuth-app scope is explicitly left as new work. This
// header-based stub keeps the route contracts honest (three-state: authenticated / forbidden /
// anonymous) and MUST be replaced with real authentication before shipping.
import { NextResponse } from "next/server"

export type RequestUser = { id: string; role: string; orgId: string | null }

/** Reads a stub identity from headers. Replace with your real session/JWT verification. */
export function getRequestUser(request: Request): RequestUser | null {
  const id = request.headers.get("x-user-id")
  if (!id) return null
  return {
    id,
    role: request.headers.get("x-user-role") ?? "user",
    orgId: request.headers.get("x-org-id"),
  }
}

export function requireUser(request: Request): { user: RequestUser } | { error: NextResponse } {
  const user = getRequestUser(request)
  if (!user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) }
  return { user }
}

export function requireRole(request: Request, role: string): { user: RequestUser } | { error: NextResponse } {
  const res = requireUser(request)
  if ("error" in res) return res
  if (res.user.role !== role) return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) }
  return res
}
