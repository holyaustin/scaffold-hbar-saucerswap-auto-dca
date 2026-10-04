import { afterEach, describe, expect, it, vi } from "vitest";
import { GET as health } from "~/app/api/health/route";
import { GET as pythUpdate } from "~/app/api/pyth-update/route";

const FEED = `0x${"cd".repeat(32)}`;
const call = (query: string) => pythUpdate(new Request(`http://localhost/api/pyth-update${query}`));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("GET /api/health", () => {
  it("reports ok with the network and vault state", async () => {
    const body = await health().json();
    expect(body).toMatchObject({ ok: true, network: "testnet", networkStatus: "live", vaultConfigured: true, auditTopicConfigured: false });
  });
});

describe("GET /api/pyth-update", () => {
  it("rejects missing or malformed feed ids", async () => {
    expect((await call("")).status).toBe(400);
    expect((await call("?ids=nope")).status).toBe(400);
  });

  it("explains how to proceed when no API key is configured", async () => {
    vi.stubEnv("PYTH_API_KEY", "");
    const response = await call(`?ids=${FEED}`);
    expect(response.status).toBe(503);
    expect((await response.json()).hint).toContain("PYTH_API_KEY");
  });

  it("proxies Hermes with the bearer key and returns 0x payloads", async () => {
    vi.stubEnv("PYTH_API_KEY", "secret");
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ binary: { data: ["aa11"] } }) });
    vi.stubGlobal("fetch", fetchMock);

    const response = await call(`?ids=${FEED}`);
    expect(await response.json()).toEqual({ updateData: ["0xaa11"] });
    expect(fetchMock.mock.calls[0][1].headers).toEqual({ Authorization: "Bearer secret" });
  });

  it("maps upstream failures to 502 without leaking the key", async () => {
    vi.stubEnv("PYTH_API_KEY", "secret");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 401 }));
    const response = await call(`?ids=${FEED}`);
    expect(response.status).toBe(502);
    expect(JSON.stringify(await response.json())).not.toContain("secret");
  });
});
