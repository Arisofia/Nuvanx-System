import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// Mock Supabase JS client
const mockRpc = vi.fn();
const mockSelect = vi.fn();
const mockEq = vi.fn();
const mockNot = vi.fn();
const mockIs = vi.fn();
const mockOrder = vi.fn();
const mockLimit = vi.fn();
const mockUpdate = vi.fn();
const mockIn = vi.fn();
const mockMaybeSingle = vi.fn();

const mockFrom = vi.fn(() => ({
  select: mockSelect,
  update: mockUpdate,
}));

vi.mock("jsr:@supabase/supabase-js@2", () => ({
  createClient: vi.fn(() => ({
    rpc: mockRpc,
    from: mockFrom,
  }))
}));

// Setup Deno
let handler;
globalThis.Deno = {
  env: {
    get: (key) => {
      if (key === "SUPABASE_URL") return "https://mock.supabase.co";
      if (key === "SUPABASE_SERVICE_ROLE_KEY") return "mock-service-role";
      if (key === "GOOGLE_DATA_MANAGER_CLIENT_ID") return "mock-client-id";
      if (key === "GOOGLE_DATA_MANAGER_CLIENT_SECRET") return "mock-client-secret";
      if (key === "GOOGLE_DATA_MANAGER_REFRESH_TOKEN") return "mock-refresh-token";
      return "";
    }
  },
  serve: vi.fn((fn) => {
    handler = fn;
  })
};

// Import the function so handler is populated
await import("./index.ts");

describe("google-data-manager-export behavioral tests", () => {
  let fetchSpy;
  
  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      if (url === "https://oauth2.googleapis.com/token") {
        return new Response(JSON.stringify({
          access_token: "mock-oauth-token",
          scope: "https://www.googleapis.com/auth/datamanager"
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify({}), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    
    // Chain mocks for Supabase builder
    mockSelect.mockReturnValue({ eq: mockEq });
    mockEq.mockReturnValue({ not: mockNot, eq: mockEq, order: mockOrder });
    mockNot.mockReturnValue({ is: mockIs });
    mockIs.mockReturnValue({ order: mockOrder });
    mockOrder.mockReturnValue({ limit: mockLimit });
    mockLimit.mockReturnValue({ maybeSingle: mockMaybeSingle, then: (cb) => cb({ data: [], error: null }) });
    mockMaybeSingle.mockReturnValue({ then: (cb) => cb({ data: null, error: null }) });
    
    mockUpdate.mockReturnValue({ eq: mockEq, in: mockIn });
    mockIn.mockReturnValue({ eq: mockEq });
    
    mockRpc.mockImplementation(async (fnName, params) => {
      if (fnName === "nvx_get_runtime_secret" && params.p_name === "REVOPS_INTERNAL_SECRET") {
        return { data: "mock-internal-secret", error: null };
      }
      return { data: null, error: null };
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("auth_check no toca outbox", async () => {
    const req = new Request("https://mock/", {
      method: "POST",
      headers: {
        "x-nvx-internal-secret": "mock-internal-secret",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ mode: "auth_check" })
    });
    
    const res = await handler(req);
    const body = await res.json();
    
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.mode).toBe("auth_check");
    expect(body.auth_ready).toBe(true);
    
    // Verificamos que se haya hecho fetch al token
    expect(fetchSpy).toHaveBeenCalledWith("https://oauth2.googleapis.com/token", expect.anything());
    
    // auth_check NO debe tocar la outbox
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("el token nunca aparece en la respuesta (auth_check)", async () => {
    const req = new Request("https://mock/", {
      method: "POST",
      headers: {
        "Authorization": "Bearer mock-service-role",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ mode: "auth_check" })
    });
    
    const res = await handler(req);
    const bodyText = await res.text();
    
    // Token is "mock-oauth-token" from our fetch mock
    expect(bodyText).not.toContain("mock-oauth-token");
    const body = JSON.parse(bodyText);
    expect(body.success).toBe(true);
  });

  it("deliver/poll rechazan el secreto interno", async () => {
    // Intento hacer poll usando el internal secret en vez del service role
    const reqPoll = new Request("https://mock/", {
      method: "POST",
      headers: {
        "x-nvx-internal-secret": "mock-internal-secret",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ mode: "poll" })
    });
    
    const resPoll = await handler(reqPoll);
    expect(resPoll.status).toBe(403);
    expect(await resPoll.json()).toEqual({ success: false, message: "Forbidden" });

    // Intento hacer deliver usando el internal secret
    const reqDeliver = new Request("https://mock/", {
      method: "POST",
      headers: {
        "x-nvx-internal-secret": "mock-internal-secret",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ mode: "deliver" })
    });
    
    const resDeliver = await handler(reqDeliver);
    expect(resDeliver.status).toBe(403);
    expect(await resDeliver.json()).toEqual({ success: false, message: "Forbidden" });
  });

  it("maneja errores de red 5xx como transient", async () => {
    fetchSpy.mockImplementationOnce(async () => {
      return new Response(JSON.stringify({}), { status: 500 });
    });
    
    const req = new Request("https://mock/", {
      method: "POST",
      headers: {
        "Authorization": "Bearer mock-service-role",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ mode: "auth_check" })
    });
    
    const res = await handler(req);
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.transient).toBe(true);
    expect(body.configuration_required).toBeUndefined();
  });
});
