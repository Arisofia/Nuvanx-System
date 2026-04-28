import fs from "fs";
import path from "path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it, expect } from "vitest";
import { t as createLucideIcon } from "../.vercel/output/static/assets/createLucideIcon-qssf6w5u.js";

describe("createLucideIcon built asset", () => {
  it("exports the icon factory from the generated frontend asset", () => {
    const assetPath = path.resolve(process.cwd(), "../.vercel/output/static/assets/createLucideIcon-qssf6w5u.js");
    expect(fs.existsSync(assetPath)).toBe(true);
    expect(typeof createLucideIcon).toBe("function");
  });

  it("produces a React component with the expected displayName", () => {
    const iconName = "test-icon";
    const iconNode = [["path", { d: "M0 0 L10 10" }]];
    const Icon = createLucideIcon(iconName, iconNode);

    expect(typeof Icon).toBe("function");
    expect(Icon.displayName).toBe(iconName);
  });

  it("renders an SVG with default lucide props from the generated component", () => {
    const iconName = "test-icon";
    const iconNode = [["path", { d: "M0 0 L10 10" }]];
    const Icon = createLucideIcon(iconName, iconNode);
    const html = renderToStaticMarkup(React.createElement(Icon));

    expect(html).toContain("<svg");
    expect(html).toContain("stroke=\"currentColor\"");
    expect(html).toContain("stroke-width=\"2\"");
    expect(html).toContain("class=\"lucide lucide-test-icon\"");
    expect(html).toContain("<path");
    expect(html).toContain("d=\"M0 0 L10 10\"");
  });

  it("respects color, size, strokeWidth, and className overrides", () => {
    const iconName = "custom-icon";
    const iconNode = [["line", { x1: "0", y1: "0", x2: "10", y2: "10" }]];
    const Icon = createLucideIcon(iconName, iconNode);
    const html = renderToStaticMarkup(
      React.createElement(Icon, {
        color: "red",
        size: 32,
        strokeWidth: 3,
        className: "extra-class",
        "data-testid": "icon",
      })
    );

    expect(html).toContain("stroke=\"red\"");
    expect(html).toContain("width=\"32\"");
    expect(html).toContain("height=\"32\"");
    expect(html).toContain("stroke-width=\"3\"");
    expect(html).toContain("lucide-custom-icon");
    expect(html).toContain("extra-class");
    expect(html).toContain("data-testid=\"icon\"");
  });

  it("computes absolute stroke width when absoluteStrokeWidth is enabled", () => {
    const iconName = "absolute-stroke";
    const iconNode = [["rect", { x: "0", y: "0", width: "24", height: "24" }]];
    const Icon = createLucideIcon(iconName, iconNode);

    const defaultMarkup = renderToStaticMarkup(
      React.createElement(Icon, { size: 24, strokeWidth: 2, absoluteStrokeWidth: true })
    );
    const largeMarkup = renderToStaticMarkup(
      React.createElement(Icon, { size: 48, strokeWidth: 2, absoluteStrokeWidth: true })
    );
    const smallMarkup = renderToStaticMarkup(
      React.createElement(Icon, { size: 12, strokeWidth: 2, absoluteStrokeWidth: true })
    );

    expect(defaultMarkup).toContain("stroke-width=\"2\"");
    expect(largeMarkup).toContain("stroke-width=\"1\"");
    expect(smallMarkup).toContain("stroke-width=\"4\"");
  });

  it("renders children inside the SVG and passes through extra props", () => {
    const iconName = "with-children";
    const iconNode = [["circle", { cx: "5", cy: "5", r: "2" }]];
    const Icon = createLucideIcon(iconName, iconNode);
    const html = renderToStaticMarkup(
      React.createElement(Icon, { "aria-label": "icon-label" }, React.createElement("title", null, "Inner Title"))
    );

    expect(html).toContain("aria-label=\"icon-label\"");
    expect(html).toContain("<title>Inner Title</title>");
  });
});
