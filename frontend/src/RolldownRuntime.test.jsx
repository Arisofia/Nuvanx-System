import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect, vi } from "vitest";
import * as RuntimeModule from "../.vercel/output/static/assets/rolldown-runtime-Dw2cE7zH.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("rolldown runtime bundle", () => {
  const assetPath = path.resolve(__dirname, "../.vercel/output/static/assets/rolldown-runtime-Dw2cE7zH.js");

  it("is present in the frontend build output", () => {
    expect(fs.existsSync(assetPath)).toBe(true);
  });

  it("exports the expected helper functions from the runtime bundle", () => {
    expect(typeof RuntimeModule.n).toBe("function");
    expect(typeof RuntimeModule.r).toBe("function");
    expect(typeof RuntimeModule.t).toBe("function");
  });

  it("creates a cached CommonJS wrapper using the runtime helper", () => {
    const factory = vi.fn((require, module) => {
      module.exports = { value: Math.random() };
    });
    const wrapper = RuntimeModule.t(factory);

    const first = wrapper();
    const second = wrapper();

    expect(factory).toHaveBeenCalledTimes(1);
    expect(first).toBe(second);
    expect(first).toEqual({ value: expect.any(Number) });
  });

  it("wraps module objects into ESM-like default exports", () => {
    const source = { foo: "bar" };
    const esm = RuntimeModule.r(source);

    expect(esm.default).toBe(source);
    expect(esm.foo).toBe("bar");
  });

  it("creates an export namespace object with getters", () => {
    const namespace = RuntimeModule.n({
      a: () => 1,
      b: () => 2,
    });

    expect(namespace.a).toBe(1);
    expect(namespace.b).toBe(2);
    expect(Object.prototype.toString.call(namespace)).toBe("[object Module]");
  });
});
