import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import React from "react";
import { describe, it, expect } from "vitest";
import * as LiveDashboard from "../dist/assets/LiveDashboard-Cw6Auhd1.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("LiveDashboard dist asset", () => {
  it("exists in the dist build output and exports only the default component", () => {
    const assetPath = path.resolve(__dirname, "../dist/assets/LiveDashboard-Cw6Auhd1.js");
    expect(fs.existsSync(assetPath)).toBe(true);

    expect(Object.keys(LiveDashboard).sort()).toEqual(["default"]);
    expect(typeof LiveDashboard.default).toBe("function");
  });

  it("creates the built React element signature without invoking hooks", () => {
    const element = React.createElement(LiveDashboard.default);

    expect(element).toEqual(
      expect.objectContaining({
        type: LiveDashboard.default,
        props: expect.any(Object),
      })
    );
  });

  it("contains the actual Live Dashboard placeholder text in the generated dist bundle", () => {
    const assetPath = path.resolve(__dirname, "../dist/assets/LiveDashboard-Cw6Auhd1.js");
    const source = fs.readFileSync(assetPath, "utf8");

    expect(source).toContain("export{n as default}");
    expect(source).toContain("Live Dashboard placeholder");
  });
});
