// Client-side API helper. Injects a DEMO identity into the header-based auth seam
// (src/lib/auth/access.ts). Replace with your real session once auth is wired — the routes already
// enforce requireUser / requireRole(super_admin); this just supplies who the demo user is.
export async function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  return fetch(input, {
    ...init,
    cache: "no-store",
    headers: {
      "content-type": "application/json",
      "x-user-id": "demo-admin",
      "x-user-role": "super_admin",
      "x-org-id": "demo",
      ...(init.headers ?? {}),
    },
  })
}
