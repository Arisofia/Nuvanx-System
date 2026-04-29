import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import React from "react";
import { describe, it, expect } from "vitest";
import * as Integrations from "../dist/assets/Integrations-DeumV2dt.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("Integrations dist asset", () => {
  it("exists in the dist build output and exports only the default component", () => {
    const assetPath = path.resolve(__dirname, "../dist/assets/Integrations-DeumV2dt.js");
    expect(fs.existsSync(assetPath)).toBe(true);

    expect(Object.keys(Integrations).sort()).toEqual(["default"]);
    expect(typeof Integrations.default).toBe("function");
  });

  it("creates the built React element signature without invoking hooks", () => {
    const element = React.createElement(Integrations.default);

    expect(element).toEqual(
      expect.objectContaining({
        type: Integrations.default,
        props: expect.any(Object),
      })
    );
  });

  it("contains the actual Integrations placeholder text in the generated bundle", () => {
    const assetPath = path.resolve(__dirname, "../dist/assets/Integrations-DeumV2dt.js");
    const source = fs.readFileSync(assetPath, "utf8");

    expect(source).toContain("export{n as default}");
    expect(source).toContain("Integrations placeholder");
  });
});
