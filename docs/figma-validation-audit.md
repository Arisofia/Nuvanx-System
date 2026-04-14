# Figma Validation Audit

Date: 2026-04-14

## Current Readiness
- Mapping file exists: docs/figma-component-map.json
- Validation script exists: scripts/validate-figma-mapping.mjs
- CI workflows execute validation.

Classification: partial
Reason: file/route validation is implemented, but actual Figma node verification is not possible until real fileKey/node IDs are provided.

## What Is Verifiably Implemented
1. Structural mapping contract with real repository file paths.
2. Validation of mapped files against the filesystem.
3. Validation of mapped routes against frontend/src/App.jsx.
4. Required route coverage checks for:
   - /dashboard
   - /operativo
   - /crm
   - /live
   - /integrations
   - /ai
5. Non-zero exit code on mapping errors.

## What Is Intentionally Placeholder
- figma.fileKey in docs/figma-component-map.json uses TODO placeholder.
- figmaNodeId values are TODO placeholders.

This is intentional to avoid inventing IDs.

## Gaps to Reach Full Figma↔GitHub Validation
1. Provide canonical Figma file URL and file key from design owner.
2. Populate node IDs for each mapped route and component.
3. Add API-level checks that confirm node IDs exist in the provided file.
4. Add ownership + review workflow for updating node mappings.

## Validation Scope Limits (Current)
- The validator does not compare visual output to Figma.
- The validator does not parse Figma API responses yet.
- The validator does not enforce design-token parity with Tailwind/CSS variables.

## Operational Guidance
- Keep TODO node IDs until official links are provided.
- Treat mapping validation as structural safety net, not design parity proof.
