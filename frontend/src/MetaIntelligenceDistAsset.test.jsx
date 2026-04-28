import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import React from "react";
import { describe, it, expect } from "vitest";
import * as MetaModule from "../dist/assets/MetaIntelligence-BELchOVg.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("MetaIntelligence dist asset", () => {
  it("exists in the dist build output and exports only the default React component", () => {
    const assetPath = path.resolve(__dirname, "../dist/assets/MetaIntelligence-BELchOVg.js");
    expect(fs.existsSync(assetPath)).toBe(true);

    expect(Object.keys(MetaModule).sort()).toEqual(["default"]);
    expect(typeof MetaModule.default).toBe("function");
  });

  it("renders to a React element and includes the real placeholder text", () => {
    const element = React.createElement(MetaModule.default);
    expect(element).toEqual(
      expect.objectContaining({
        type: MetaModule.default,
        props: expect.any(Object),
      })
    );

    const assetPath = path.resolve(__dirname, "../dist/assets/MetaIntelligence-BELchOVg.js");
    const source = fs.readFileSync(assetPath, "utf8");

    expect(source).toContain("Meta Intelligence placeholder");
    expect(source).toContain("export{n as default}");
  });
});
