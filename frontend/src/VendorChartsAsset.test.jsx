import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import * as ChartsModule from "../.vercel/output/static/assets/vendor-charts-BcMxs3oX.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("vendor charts bundle asset", () => {
  it("is available in the frontend build output and exports the real vendor chart module shape", () => {
    const assetPath = path.resolve(__dirname, "../.vercel/output/static/assets/vendor-charts-BcMxs3oX.js");
    expect(fs.existsSync(assetPath)).toBe(true);

    expect(Object.keys(ChartsModule).sort()).toEqual([
      "a",
      "c",
      "d",
      "f",
      "i",
      "l",
      "m",
      "n",
      "o",
      "p",
      "r",
      "s",
      "t",
      "u",
    ]);

    expect(typeof ChartsModule.a).toBe("object");
    expect(typeof ChartsModule.c).toBe("function");
    expect(typeof ChartsModule.d).toBe("object");
    expect(typeof ChartsModule.f).toBe("object");
    expect(typeof ChartsModule.l).toBe("function");
    expect(typeof ChartsModule.m).toBe("function");
    expect(typeof ChartsModule.p).toBe("function");
    expect(typeof ChartsModule.s).toBe("function");
    expect(typeof ChartsModule.u).toBe("function");
  });

  it("contains real Recharts runtime markers in the generated vendor bundle", () => {
    const assetPath = path.resolve(__dirname, "../.vercel/output/static/assets/vendor-charts-BcMxs3oX.js");
    const source = fs.readFileSync(assetPath, "utf8");

    expect(source).toContain("recharts");
    expect(source).toContain("Symbol.for(`react.fragment`)");
    expect(source).toContain("export{");
    expect(source).toContain("zM as a");
  });
});
