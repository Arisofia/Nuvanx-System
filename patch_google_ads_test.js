const fs = require('fs');
let code = fs.readFileSync('supabase/functions/google-ads-health/index.test.mjs', 'utf8');

const oldTest = `  it("fails closed unless the canonical conversion exists, is enabled, and is primary for goal", () => {
    expect(source).toContain('const CANONICAL_CONVERSION_ACTION_ID = "7713427085"');
    expect(source).toContain("conversion_action.primary_for_goal");
    expect(source).toContain('new HealthFailure("validation", 424, "Canonical Google Ads conversion action missing")');
    expect(source).toContain('new HealthFailure("validation", 424, "Canonical Google Ads conversion is not primary_for_goal")');
    expect(source).toContain('String(conversion.status || "").toUpperCase() !== "ENABLED"');
    expect(source).not.toContain("conversion_action.include_in_conversions_metric");
  });`;

const newTest = `  it("enforces strict validation when the canonical conversion is found but permits empty or missing canonical conversions", () => {
    expect(source).toContain('const CANONICAL_CONVERSION_ACTION_ID = "7713427085"');
    expect(source).toContain("conversion_action.primary_for_goal");
    expect(source).not.toContain('new HealthFailure("validation", 424, "Canonical Google Ads conversion action missing")');
    expect(source).toContain('new HealthFailure("validation", 424, "Canonical Google Ads conversion is not primary_for_goal")');
    expect(source).toContain('String(conversion.status || "").toUpperCase() !== "ENABLED"');
    expect(source).not.toContain("conversion_action.include_in_conversions_metric");
  });

  it("handles missing conversionAction gracefully without TypeError by leaving canonical_conversion as null", () => {
    expect(source).toContain('let conversion = null;');
    expect(source).toContain('conversion = conversionRows[0]?.conversionAction || null;');
    expect(source).toContain('canonical_conversion: conversion ? {');
    expect(source).toContain('primary_for_goal: conversion.primaryForGoal ?? false,');
    expect(source).toContain('} : null,');
  });`;

code = code.replace(oldTest, newTest);
fs.writeFileSync('supabase/functions/google-ads-health/index.test.mjs', code);
