import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import React from "react";
import { describe, it, expect } from "vitest";
import * as HealthCheck from "../dist/assets/HealthCheck-C2YNqXdK.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("HealthCheck dist asset", () => {
  it("is present in the dist build output and exports only the default component", () => {
    const assetPath = path.resolve(__dirname, "../dist/assets/HealthCheck-C2YNqXdK.js");
    expect(fs.existsSync(assetPath)).toBe(true);

    expect(Object.keys(HealthCheck).sort()).toEqual(["default"]);
    expect(typeof HealthCheck.default).toBe("function");
  });

  it("creates the built React element signature without invoking hooks", () => {
    const element = React.createElement(HealthCheck.default);

    expect(element).toEqual(
      expect.objectContaining({
        type: HealthCheck.default,
        props: expect.any(Object),
      })
    );
  });

  it("contains the actual HealthCheck placeholder text in the generated bundle", () => {
    const assetPath = path.resolve(__dirname, "../dist/assets/HealthCheck-C2YNqXdK.js");
    const source = fs.readFileSync(assetPath, "utf8");

    expect(source).toContain("export{n as default}");
    expect(source).toContain("Health check placeholder");
  });
});
