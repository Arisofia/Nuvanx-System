import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import React from "react";
import { describe, it, expect } from "vitest";
import * as VFModule from "../.vercel/output/static/assets/VerifiedFinancials-PXyQZGZ7.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("VerifiedFinancials frontend build asset", () => {
  it("is present in the build output and exports only the default React component", () => {
    const assetPath = path.resolve(__dirname, "../.vercel/output/static/assets/VerifiedFinancials-PXyQZGZ7.js");
    expect(fs.existsSync(assetPath)).toBe(true);

    expect(Object.keys(VFModule).sort()).toEqual(["default"]);
    expect(typeof VFModule.default).toBe("function");
  });

  it("creates the built React element signature without invoking hooks", () => {
    const element = React.createElement(VFModule.default);

    expect(element).toEqual(
      expect.objectContaining({
        type: VFModule.default,
        props: expect.any(Object),
      })
    );
  });

  it("contains the expected page strings in the generated asset", () => {
    const assetPath = path.resolve(__dirname, "../.vercel/output/static/assets/VerifiedFinancials-PXyQZGZ7.js");
    const source = fs.readFileSync(assetPath, "utf8");

    expect(source).toContain("export{j as default}");
    expect(source).toContain("Verified Financials");
    expect(source).toContain("Source of truth: Doctoralia settled operations");
  });
});
