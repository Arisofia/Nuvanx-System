import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import React from "react";
import { describe, it, expect } from "vitest";
import * as AILayerModule from "../dist/assets/AILayer-7SRzzO3V.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("AILayer frontend build asset", () => {
  it("exists in the dist output and exports only the default component", () => {
    const assetPath = path.resolve(__dirname, "../dist/assets/AILayer-7SRzzO3V.js");
    expect(fs.existsSync(assetPath)).toBe(true);

    expect(Object.keys(AILayerModule).sort()).toEqual(["default"]);
    expect(typeof AILayerModule.default).toBe("function");
  });

  it("creates the built React element signature without invoking hooks", () => {
    const element = React.createElement(AILayerModule.default);

    expect(element).toEqual(
      expect.objectContaining({
        type: AILayerModule.default,
        props: expect.any(Object),
      })
    );
  });

  it("contains the real placeholder page string in the generated bundle", () => {
    const assetPath = path.resolve(__dirname, "../dist/assets/AILayer-7SRzzO3V.js");
    const source = fs.readFileSync(assetPath, "utf8");

    expect(source).toContain("export{n as default}");
    expect(source).toContain("AI Layer placeholder");
  });
});
