import { describe, it, expect, beforeAll, afterAll } from "vitest"
import http from "node:http"
import type { AddressInfo } from "node:net"
import {
  classifyHttpStatus, probeHttp, shallowPing, deepPing, type IntegrationKey,
} from "@/lib/health/pings"

// A local fake HTTP server that returns a status chosen by the path (/200, /401, ...), and hangs on
// /hang. This stands in for the real third-party integrations so the deep-probe classification and
// its failure paths are tested deterministically without touching any live API.
let server: http.Server
let base: string

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const path = req.url ?? "/"
    if (path.startsWith("/hang")) return // never respond -> exercises the timeout path
    const code = Number(path.slice(1).split("?")[0]) || 200
    res.writeHead(code, { "content-type": "application/json" })
    res.end(JSON.stringify({ code }))
  })
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve))
  const port = (server.address() as AddressInfo).port
  base = `http://127.0.0.1:${port}`
})

afterAll(() => new Promise<void>(resolve => server.close(() => resolve())))

describe("classifyHttpStatus (Section 15 pings.ts)", () => {
  it("maps codes to the six states", () => {
    expect(classifyHttpStatus(200)).toBe("ok")
    expect(classifyHttpStatus(204)).toBe("ok")
    expect(classifyHttpStatus(401)).toBe("auth")
    expect(classifyHttpStatus(403)).toBe("auth")
    expect(classifyHttpStatus(429)).toBe("rate_limited")
    expect(classifyHttpStatus(500)).toBe("server_error")
    expect(classifyHttpStatus(503)).toBe("server_error")
    expect(classifyHttpStatus(404)).toBe("server_error") // unexpected but reachable
  })
})

describe("probeHttp — real network path against the fake server (FAILURE PATHS)", () => {
  it("200 -> ok", async () => expect((await probeHttp({ url: `${base}/200` })).status).toBe("ok"))
  it("401 -> auth", async () => expect((await probeHttp({ url: `${base}/401` })).status).toBe("auth"))
  it("429 -> rate_limited", async () => expect((await probeHttp({ url: `${base}/429` })).status).toBe("rate_limited"))
  it("500 -> server_error", async () => expect((await probeHttp({ url: `${base}/500` })).status).toBe("server_error"))

  it("a refused connection -> unreachable (not ok, not empty)", async () => {
    const r = await probeHttp({ url: "http://127.0.0.1:1/anything" }, { timeoutMs: 2000 })
    expect(r.status).toBe("unreachable")
  })

  it("a hanging endpoint -> unreachable via the 6s timeout (tested with a short timeout)", async () => {
    const r = await probeHttp({ url: `${base}/hang` }, { timeoutMs: 150 })
    expect(r.status).toBe("unreachable")
    expect(r.detail).toMatch(/timeout/)
  })
})

describe("shallowPing — config-only, no network", () => {
  it("reports configured vs not_configured from env presence", () => {
    const pings = shallowPing({ env: { STRIPE_SECRET_KEY: "sk" } })
    const stripe = pings.find(p => p.key === "stripe")!
    const meta = pings.find(p => p.key === "meta")!
    expect(stripe.status).toBe("ok")
    expect(stripe.configured).toBe(true)
    expect(meta.status).toBe("not_configured")
    expect(meta.configured).toBe(false)
  })
})

describe("deepPing — orchestration + three-state at the seam", () => {
  it("probes configured integrations, skips unconfigured, and never masks a failure as ok", async () => {
    const env = { STRIPE_SECRET_KEY: "sk", MONGODB_URI: "mongodb://x" }
    const statusByKey: Partial<Record<IntegrationKey, number>> = { stripe: 500 } // stripe API "down"
    const pings = await deepPing({
      env,
      only: ["stripe", "mongodb", "meta"],
      endpointOverride: (key, req) => ({ ...req, url: `${base}/${statusByKey[key] ?? 200}` }),
      probeMongo: async () => ({ status: "ok", detail: "ping ok" }),
    })
    const stripe = pings.find(p => p.key === "stripe")!
    const mongo = pings.find(p => p.key === "mongodb")!
    const meta = pings.find(p => p.key === "meta")!

    expect(stripe.status).toBe("server_error") // failure surfaced, not "ok"
    expect(mongo.status).toBe("ok")
    expect(meta.status).toBe("not_configured") // absent env -> skipped, no probe
  })

  it("classifies a 401 from a configured integration as auth", async () => {
    const pings = await deepPing({
      env: { CALLRAIL_API_KEY: "bad" },
      only: ["callrail"],
      endpointOverride: (_k, req) => ({ ...req, url: `${base}/401` }),
    })
    expect(pings[0]!.status).toBe("auth")
  })
})
