import { describe, expect, it, vi } from "vitest";
import { authenticateDispatcherRequest } from "./auth.ts";

describe("RevOps dispatcher authentication boundary", () => {
  it("rejects a missing header without resolving the privileged runtime secret", async () => {
    const resolveExpectedSecret = vi.fn(async () => "should-not-be-read");
    const req = new Request("https://example.test/functions/v1/revops-dispatcher", { method: "POST" });

    const result = await authenticateDispatcherRequest(req, resolveExpectedSecret);

    expect(result).toEqual({ ok: false, status: 403, message: "Forbidden" });
    expect(resolveExpectedSecret).not.toHaveBeenCalled();
  });

  it("rejects a wrong-but-present secret after resolving the expected secret once", async () => {
    const resolveExpectedSecret = vi.fn(async () => "expected-secret");
    const req = new Request("https://example.test/functions/v1/revops-dispatcher", {
      method: "POST",
      headers: { "x-nvx-internal-secret": "wrong-secret" },
    });

    const result = await authenticateDispatcherRequest(req, resolveExpectedSecret);

    expect(result).toEqual({ ok: false, status: 403, message: "Forbidden" });
    expect(resolveExpectedSecret).toHaveBeenCalledTimes(1);
  });

  it("accepts an exact secret match", async () => {
    const resolveExpectedSecret = vi.fn(async () => "expected-secret");
    const req = new Request("https://example.test/functions/v1/revops-dispatcher", {
      method: "POST",
      headers: { "x-nvx-internal-secret": "expected-secret" },
    });

    await expect(authenticateDispatcherRequest(req, resolveExpectedSecret)).resolves.toEqual({ ok: true });
    expect(resolveExpectedSecret).toHaveBeenCalledTimes(1);
  });

  it("fails closed when the runtime secret cannot be resolved", async () => {
    const resolveExpectedSecret = vi.fn(async () => {
      throw new Error("vault unavailable");
    });
    const req = new Request("https://example.test/functions/v1/revops-dispatcher", {
      method: "POST",
      headers: { "x-nvx-internal-secret": "present" },
    });

    const result = await authenticateDispatcherRequest(req, resolveExpectedSecret);

    expect(result).toEqual({ ok: false, status: 500, message: "Server configuration error" });
    expect(resolveExpectedSecret).toHaveBeenCalledTimes(1);
  });
});
