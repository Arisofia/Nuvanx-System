import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import * as SupabaseModule from "../.vercel/output/static/assets/vendor-supabase-DHwzc6T2.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("vendor supabase bundle asset", () => {
  it("is available in the frontend build output and exports the real supabase module shape", () => {
    const assetPath = path.resolve(__dirname, "../.vercel/output/static/assets/vendor-supabase-DHwzc6T2.js");
    expect(fs.existsSync(assetPath)).toBe(true);

    expect(Object.keys(SupabaseModule).sort()).toEqual(["t"]);
    expect(typeof SupabaseModule.t).toBe("function");
  });

  it("contains real Supabase runtime markers in the generated vendor bundle", () => {
    const assetPath = path.resolve(__dirname, "../.vercel/output/static/assets/vendor-supabase-DHwzc6T2.js");
    const source = fs.readFileSync(assetPath, "utf8");

    expect(source).toContain("export{ui as t}");
    expect(source).toContain("supabase-js");
    expect(source).toContain("supabase.auth.token");
  });
});
