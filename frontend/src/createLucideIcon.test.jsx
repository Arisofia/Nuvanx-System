import { describe, it, expect } from "vitest";
import { t as createLucideIcon } from "../.vercel/output/static/assets/createLucideIcon-qssf6w5u.js";

describe("createLucideIcon generated asset", () => {
  it("exports the factory as a function", () => {
    expect(createLucideIcon).toBeTypeOf("function");
  });

  it("returns a forwardRef component object for a basic icon node", () => {
    const iconName = "test-icon";
    const iconNode = [["path", { d: "M0 0 L10 10" }]];
    const Icon = createLucideIcon(iconName, iconNode);

    expect(Icon).toBeTypeOf("object");
    expect(Icon).toHaveProperty("$$typeof");
    expect(String(Icon.$$typeof)).toBe("Symbol(react.forward_ref)");
    expect(Icon).toHaveProperty("render");
    expect(Icon.render).toBeTypeOf("function");
    expect(Icon.render.length).toBe(2);
    expect(Icon.displayName).toBe("TestIcon");
  });

  it("derives displayName from dashed icon names", () => {
    const iconName = "my-custom-icon";
    const iconNode = [["circle", { cx: "12", cy: "12", r: "3" }]];
    const Icon = createLucideIcon(iconName, iconNode);

    expect(Icon.displayName).toBe("MyCustomIcon");
  });

  it("creates distinct components for different icon definitions", () => {
    const first = createLucideIcon("first-icon", [["path", { d: "M0 0" }]]);
    const second = createLucideIcon("second-icon", [["rect", { x: "0", y: "0", width: "24", height: "24" }]]);

    expect(first).not.toBe(second);
    expect(first.displayName).toBe("FirstIcon");
    expect(second.displayName).toBe("SecondIcon");
  });

  it("supports iconNode definitions with multiple svg elements", () => {
    const iconName = "multi-node-icon";
    const iconNode = [
      ["path", { d: "M0 0 L10 10" }],
      ["circle", { cx: "12", cy: "12", r: "4" }],
    ];
    const Icon = createLucideIcon(iconName, iconNode);

    expect(Icon.displayName).toBe("MultiNodeIcon");
    expect(Icon.render).toBeTypeOf("function");
  });
});
