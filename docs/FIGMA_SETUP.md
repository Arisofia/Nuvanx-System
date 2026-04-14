# Figma Setup (Current Scope)

Date: 2026-04-14

This repository currently supports structural mapping validation (code routes/files), not full Figma API validation.

## 1) Fill Mapping Metadata
Edit docs/figma-component-map.json and set:
- figma.fileKey
- figma.fileUrl
- figmaNodeId values for each route/component

Use TODO placeholders until official node links are available.

## 2) Validate Mapping
From repository root:
- node scripts/validate-figma-mapping.mjs

From frontend directory:
- npm run validate:figma

## 3) CI Behavior
Validation runs in:
- .github/workflows/ci.yml
- .github/workflows/validate-figma-mapping.yml

Errors fail the workflow.

## 4) Current Limitations
- No Figma API node existence check yet.
- No visual regression check.
- No automatic token sync from Figma.

See docs/figma-validation-audit.md and docs/figma-validation-spec.md for details.
