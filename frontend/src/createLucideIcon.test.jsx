import { describe, it, expect } from "vitest";
import { t as createLucideIcon } from "../.vercel/output/static/assets/createLucideIcon-qssf6w5u.js";

const renderElement = (Icon, props = {}) => Icon.render(props, null);

describe("createLucideIcon generated asset", () => {
  it("exports the factory from the generated frontend bundle", () => {
    expect(createLucideIcon).toBeTypeOf("function");
  });

  it("returns a forwardRef React component object for a basic icon node", () => {
    const iconName = "factory-test";
    const iconNode = [
      ["path", { d: "M0 0 L10 10" }],
      ["circle", { cx: "12", cy: "12", r: "4" }],
    ];
    const Icon = createLucideIcon(iconName, iconNode);

    expect(Icon).toBeTypeOf("object");
    expect(Icon).toHaveProperty("$$typeof");
    expect(String(Icon.$$typeof)).toBe("Symbol(react.forward_ref)");
    expect(Icon).toHaveProperty("render");
    expect(Icon.render).toBeTypeOf("function");
    expect(Icon.render.length).toBe(2);
    expect(Icon.displayName).toBe("FactoryTest");
  });

  it("passes iconNode through and composes the generated className", () => {
    const iconName = "default-render";
    const iconNode = [
      ["path", { d: "M0 0 L10 10" }],
      ["circle", { cx: "12", cy: "12", r: "3" }],
    ];
    const Icon = createLucideIcon(iconName, iconNode);
    const element = renderElement(Icon, {});

    expect(element.props).toMatchObject({
      iconNode,
      className: "lucide-default-render",
      ref: null,
    });
    expect(element.props).not.toHaveProperty("color");
    expect(element.props).not.toHaveProperty("size");
    expect(element.props).not.toHaveProperty("strokeWidth");
  });

  it("forwards color, size, strokeWidth, and extra props through the generated element", () => {
    const iconName = "custom-overrides";
    const iconNode = [["line", { x1: "0", y1: "0", x2: "10", y2: "10" }]];
    const Icon = createLucideIcon(iconName, iconNode);
    const element = renderElement(Icon, {
      color: "#ff0000",
      size: 32,
      strokeWidth: 3,
      className: "extra-class",
      "data-testid": "icon",
    });

    expect(element.props).toMatchObject({
      color: "#ff0000",
      size: 32,
      strokeWidth: 3,
      className: "lucide-custom-overrides extra-class",
      "data-testid": "icon",
    });
    expect(element.props.iconNode).toEqual(iconNode);
  });

  it("forwards arbitrary props and children through the generated component", () => {
    const iconName = "with-children";
    const iconNode = [["circle", { cx: "8", cy: "8", r: "4" }]];
    const Icon = createLucideIcon(iconName, iconNode);
    const element = renderElement(Icon, {
      "aria-label": "child-icon",
      children: "Inner Title",
    });

    expect(element.props).toMatchObject({
      "aria-label": "child-icon",
      children: "Inner Title",
      className: "lucide-with-children",
    });
    expect(element.props.iconNode).toEqual(iconNode);
  });

  it("preserves absoluteStrokeWidth and size props on the generated element", () => {
    const iconName = "absolute-numeric";
    const iconNode = [["rect", { x: "0", y: "0", width: "24", height: "24" }]];
    const Icon = createLucideIcon(iconName, iconNode);
    const element = renderElement(Icon, {
      size: 48,
      strokeWidth: 2,
      absoluteStrokeWidth: true,
    });

    expect(element.props).toMatchObject({
      size: 48,
      strokeWidth: 2,
      absoluteStrokeWidth: true,
    });
  });

  it("supports size as a numeric string and forwards it intact", () => {
    const iconName = "absolute-string-number";
    const iconNode = [["rect", { x: "1", y: "1", width: "22", height: "22" }]];
    const Icon = createLucideIcon(iconName, iconNode);
    const element = renderElement(Icon, {
      size: "48",
      strokeWidth: 2,
      absoluteStrokeWidth: true,
    });

    expect(element.props.size).toBe("48");
    expect(element.props.strokeWidth).toBe(2);
    expect(element.props.absoluteStrokeWidth).toBe(true);
  });

  it("keeps non-numeric string sizes intact when not using absoluteStrokeWidth", () => {
    const iconName = "em-size";
    const iconNode = [["circle", { cx: "12", cy: "12", r: "8" }]];
    const Icon = createLucideIcon(iconName, iconNode);
    const element = renderElement(Icon, { size: "2em" });

    expect(element.props.size).toBe("2em");
    expect(element.props.className).toBe("lucide-em-size");
  });

  it("filters out empty className values when composing the generated class string", () => {
    const iconName = "no-extra-class";
    const iconNode = [["path", { d: "M1 1 L2 2" }]];
    const Icon = createLucideIcon(iconName, iconNode);
    const element = renderElement(Icon, { className: "" });

    expect(element.props.className).toBe("lucide-no-extra-class");
  });

  it("supports malformed iconNode entries without throwing when the factory is invoked", () => {
    const iconName = "malformed-node";
    const iconNode = [
      ["path", { d: "M0 0 L1 1" }],
      ["circle"],
      [null, { cx: "1", cy: "1", r: "1" }],
    ];
    const Icon = createLucideIcon(iconName, iconNode);

    expect(() => renderElement(Icon, {})).not.toThrow();
    expect(Icon.displayName).toBe("MalformedNode");
  });
});
