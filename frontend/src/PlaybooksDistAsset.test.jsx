import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import React from "react";
import { describe, it, expect } from "vitest";
import * as PlaybooksModule from "../dist/assets/Playbooks-CQltKy2B.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("Playbooks dist asset", () => {
  it("exists in the dist build output and exports only the default component", () => {
    const assetPath = path.resolve(__dirname, "../dist/assets/Playbooks-CQltKy2B.js");
    expect(fs.existsSync(assetPath)).toBe(true);

    expect(Object.keys(PlaybooksModule).sort()).toEqual(["default"]);
    expect(typeof PlaybooksModule.default).toBe("function");
  });

  it("renders as a React element and includes the real Playbooks placeholder text", () => {
    const element = React.createElement(PlaybooksModule.default);
    expect(element).toEqual(
      expect.objectContaining({
        type: PlaybooksModule.default,
        props: expect.any(Object),
      })
    );

    const assetPath = path.resolve(__dirname, "../dist/assets/Playbooks-CQltKy2B.js");
    const source = fs.readFileSync(assetPath, "utf8");

    expect(source).toContain("Playbooks placeholder");
    expect(source).toContain("export{n as default}");
  });
});
