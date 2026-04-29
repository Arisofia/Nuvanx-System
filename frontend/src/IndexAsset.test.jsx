import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("index bundle asset", () => {
  it("is available in the frontend build output", () => {
    const assetPath = path.resolve(__dirname, "../.vercel/output/static/assets/index-DZE7WTmj.js");
    expect(fs.existsSync(assetPath)).toBe(true);
  });

  it("contains the expected app entrypoint markers from the generated bundle", () => {
    const assetPath = path.resolve(__dirname, "../.vercel/output/static/assets/index-DZE7WTmj.js");
    const source = fs.readFileSync(assetPath, "utf8");

    expect(source).toContain("document.getElementById(`root`)");
    expect(source).toContain("createRoot");
    expect(source).toContain("Welcome to Nuvanx");
    expect(source).toContain("Revenue Intelligence Platform");
    expect(source).toContain("/dashboard");
    expect(source).toContain("/crm");
    expect(source).toContain("/ai");
    expect(source).toContain("/integrations");
    expect(source).toContain("toastOptions");
    expect(source).not.toContain("export{");
  });
});
