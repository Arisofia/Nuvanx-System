import React from "react";
import { describe, it, expect } from "vitest";
import { renderToString } from "react-dom/server";
import AILayer from "../../.vercel/output/static/assets/AILayer-C80l0HWN.js";

describe("AILayer component", () => {
  it("renders the AI Layer shell and key UI labels", () => {
    const html = renderToString(<AILayer />);

    expect(html).toContain("AI Content Layer");
    expect(html).toContain("Generate Content");
    expect(html).toContain("Analyze & Optimize");
    expect(html).toContain("AI Engine:");
  });

  it("renders the AI engine selection buttons", () => {
    const html = renderToString(<AILayer />);

    expect(html).toContain("GPT-4");
    expect(html).toContain("Gemini");
  });

  it("includes the prompt and campaign input sections", () => {
    const html = renderToString(<AILayer />);

    expect(html).toContain("Your Prompt");
    expect(html).toContain("Content Type");
    expect(html).toContain("Campaign Data");
    expect(html).toContain("Paste your campaign metrics here");
  });
});
