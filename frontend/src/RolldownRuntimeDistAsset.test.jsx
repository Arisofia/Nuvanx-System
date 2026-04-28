import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect, vi } from "vitest";
import * as RuntimeModule from "../dist/assets/rolldown-runtime-DF2fYuay.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("rolldown runtime dist bundle", () => {
  const assetPath = path.resolve(__dirname, "../dist/assets/rolldown-runtime-DF2fYuay.js");

  it("exists in the dist build output", () => {
    expect(fs.existsSync(assetPath)).toBe(true);
  });

  it("exports the real runtime helper functions from the generated dist bundle", () => {
    expect(typeof RuntimeModule.n).toBe("function");
    expect(typeof RuntimeModule.t).toBe("function");
    expect(RuntimeModule.r).toBeUndefined();
  });

  it("creates a cached CommonJS wrapper using the runtime helper", () => {
    const factory = vi.fn((require, module, exports) => {
      module.exports = { value: Math.random() };
    });
    const wrapper = RuntimeModule.t(factory);

    const first = wrapper();
    const second = wrapper();

    expect(factory).toHaveBeenCalledTimes(1);
    expect(first).toBe(second);
    expect(first).toEqual({ value: expect.any(Number) });
  });

  it("wraps module objects into namespace behavior via the runtime helper", () => {
    const source = { foo: "bar" };
    const esm = RuntimeModule.n(source);

    expect(esm.default).toBe(source);
    expect(esm.foo).toBe("bar");
    expect(Object.prototype.toString.call(esm)).toBe("[object Object]");
  });

  it("contains the expected runtime helper export signature in the dist source", () => {
    const source = fs.readFileSync(assetPath, "utf8");
    expect(source).toContain("export{c as n,o as t}");
    expect(source).toContain("var e=Object.create");
    expect(source).toContain("o=(e,t)=>()");
  });
});
