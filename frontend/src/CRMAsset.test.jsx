import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import React from "react";
import { describe, it, expect } from "vitest";
import * as CRM from "../dist/assets/CRM-B4xUeavH.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("CRM dist asset", () => {
  it("is present in the dist build output and exports only the default component", () => {
    const assetPath = path.resolve(__dirname, "../dist/assets/CRM-B4xUeavH.js");
    expect(fs.existsSync(assetPath)).toBe(true);

    expect(Object.keys(CRM).sort()).toEqual(["default"]);
    expect(typeof CRM.default).toBe("function");
  });

  it("creates the built React element signature without invoking hooks", () => {
    const element = React.createElement(CRM.default);

    expect(element).toEqual(
      expect.objectContaining({
        type: CRM.default,
        props: expect.any(Object),
      })
    );
  });

  it("contains the actual CRM placeholder text in the generated bundle", () => {
    const assetPath = path.resolve(__dirname, "../dist/assets/CRM-B4xUeavH.js");
    const source = fs.readFileSync(assetPath, "utf8");

    expect(source).toContain("export{n as default}");
    expect(source).toContain("CRM placeholder");
  });
});
