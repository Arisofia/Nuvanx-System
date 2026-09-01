const fs = require('fs');
let code = fs.readFileSync('supabase/functions/google-ads-health/index.ts', 'utf8');

const oldVal = `    if (conversionRows.length !== 1) {
      throw new HealthFailure("validation", 424, "Canonical Google Ads conversion action missing");
    }
    const conversion = conversionRows[0]?.conversionAction || null;
    if (!conversion || String(conversion.id || "") !== CANONICAL_CONVERSION_ACTION_ID) {
      throw new HealthFailure("validation", 424, "Canonical Google Ads conversion identity mismatch");
    }
    if (conversion.primaryForGoal !== true) {
      throw new HealthFailure("validation", 424, "Canonical Google Ads conversion is not primary_for_goal");
    }
    if (String(conversion.status || "").toUpperCase() !== "ENABLED") {
      throw new HealthFailure("validation", 424, "Canonical Google Ads conversion is not enabled");
    }`;

const newVal = `    let conversion = null;
    if (conversionRows.length === 1) {
      conversion = conversionRows[0]?.conversionAction || null;
    } else if (conversionRows.length > 1) {
      throw new HealthFailure("validation", 424, "Multiple conversion actions found, expected exactly one canonical conversion");
    }
    
    if (conversion) {
      if (String(conversion.id || "") !== CANONICAL_CONVERSION_ACTION_ID) {
        throw new HealthFailure("validation", 424, "Canonical Google Ads conversion identity mismatch");
      }
      if (conversion.primaryForGoal !== true) {
        throw new HealthFailure("validation", 424, "Canonical Google Ads conversion is not primary_for_goal");
      }
      if (String(conversion.status || "").toUpperCase() !== "ENABLED") {
        throw new HealthFailure("validation", 424, "Canonical Google Ads conversion is not enabled");
      }
    }`;

const oldPayload = `      canonical_conversion: {
        id: String(conversion.id),
        name: conversion.name ?? null,
        status: conversion.status ?? null,
        type: conversion.type ?? null,
        category: conversion.category ?? null,
        origin: conversion.origin ?? null,
        primary_for_goal: conversion.primaryForGoal,
      },`;

const newPayload = `      canonical_conversion: conversion ? {
        id: String(conversion.id),
        name: conversion.name ?? null,
        status: conversion.status ?? null,
        type: conversion.type ?? null,
        category: conversion.category ?? null,
        origin: conversion.origin ?? null,
        primary_for_goal: conversion.primaryForGoal ?? false,
      } : null,`;

code = code.replace(oldVal, newVal).replace(oldPayload, newPayload);
fs.writeFileSync('supabase/functions/google-ads-health/index.ts', code);
