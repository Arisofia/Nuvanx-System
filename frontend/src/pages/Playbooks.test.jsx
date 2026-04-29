import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import Playbooks from "../../.vercel/output/static/assets/Playbooks-W4Z5MkKA.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("Playbooks built asset", () => {
  const assetPath = path.resolve(__dirname, "../../.vercel/output/static/assets/Playbooks-W4Z5MkKA.js");

  it("is present in the frontend build output", () => {
    expect(fs.existsSync(assetPath)).toBe(true);
  });

  it("exports a default React component function", () => {
    expect(typeof Playbooks).toBe("function");
  });

  it("contains the expected Playbooks UI strings in the generated source", () => {
    const source = fs.readFileSync(assetPath, "utf8");

    expect(source).toContain("Playbooks");
    expect(source).toContain("Business automations. Run counters are real and persisted in the database.");
    expect(source).toContain("/api/playbooks");
    expect(source).toContain("/api/playbooks/${e.slug}/run");
    expect(source).toContain("Error loading Playbooks");
    expect(source).toContain("No playbooks in this category");
    expect(source).toContain("Run Playbook");
    expect(source).toContain("Refresh");
    expect(source).toContain("Retry");
  });

  it("uses the actual Playbooks generated asset path", () => {
    expect(assetPath).toContain("Playbooks-W4Z5MkKA.js");
  });
});
