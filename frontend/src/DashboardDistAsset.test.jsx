import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import React from "react";
import { describe, it, expect } from "vitest";
import * as Dashboard from "../dist/assets/Dashboard-Tlvp89XP.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("Dashboard dist asset", () => {
  it("exists in the dist build output and exports only the default component", () => {
    const assetPath = path.resolve(__dirname, "../dist/assets/Dashboard-Tlvp89XP.js");
    expect(fs.existsSync(assetPath)).toBe(true);

    expect(Object.keys(Dashboard).sort()).toEqual(["default"]);
    expect(typeof Dashboard.default).toBe("function");
  });

  it("creates the built React element signature without invoking hooks", () => {
    const element = React.createElement(Dashboard.default);

    expect(element).toEqual(
      expect.objectContaining({
        type: Dashboard.default,
        props: expect.any(Object),
      })
    );
  });

  it("contains the actual Dashboard placeholder string in the generated bundle", () => {
    const assetPath = path.resolve(__dirname, "../dist/assets/Dashboard-Tlvp89XP.js");
    const source = fs.readFileSync(assetPath, "utf8");

    expect(source).toContain("export{n as default}");
    expect(source).toContain("Dashboard placeholder");
  });
});
