import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import * as DistModule from "../.vercel/output/static/assets/dist-CxWWvHcK.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("dist bundle asset", () => {
  it("is available in the frontend build output and exports toast helpers", () => {
    const assetPath = path.resolve(__dirname, "../.vercel/output/static/assets/dist-CxWWvHcK.js");
    expect(fs.existsSync(assetPath)).toBe(true);
    expect(typeof DistModule.n).toBe("function");
    expect(typeof DistModule.t).toBe("function");
    expect(typeof DistModule.n.error).toBe("function");
    expect(typeof DistModule.n.success).toBe("function");
    expect(typeof DistModule.n.dismiss).toBe("function");
  });

  it("contains expected toast runtime strings in the generated bundle", () => {
    const assetPath = path.resolve(__dirname, "../.vercel/output/static/assets/dist-CxWWvHcK.js");
    const source = fs.readFileSync(assetPath, "utf8");

    expect(source).toContain("data-rht-toaster");
    expect(source).toContain("I.error");
    expect(source).toContain("I.success");
    expect(source).toContain("removeDelay");
    expect(source).toContain("visible");
  });
});
