# Figma Validation Spec

Version: 1.1
Date: 2026-04-14

## Purpose
Define the minimum reliable contract for validating route/component mappings between code and Figma metadata without inventing design identifiers.

## Source of Truth
- Mapping file: docs/figma-component-map.json
- Routes source: frontend/src/App.jsx
- Component/page files: repository filesystem

## Mapping Contract

Top-level fields:
- version
- repository
- figma
- routes (array)
- components (array)

Route item fields:
- name
- route
- file
- figmaNodeId
- owner

Component item fields:
- name
- file
- figmaNodeId
- owner

## Validation Rules
Implemented in scripts/validate-figma-mapping.mjs.

The validator must:
1. Parse mapping JSON.
2. Ensure required top-level fields exist.
3. Ensure each mapped route entry has route + file.
4. Ensure each mapped component entry has name + file.
5. Verify every mapped file exists.
6. Verify each mapped route exists in frontend/src/App.jsx.
7. Verify required route coverage for:
   - /dashboard
   - /operativo
   - /crm
   - /live
   - /integrations
   - /ai
8. Exit non-zero on any validation error.

The validator currently emits warnings for TODO figmaNodeId values.

## Execution
Local:
- node scripts/validate-figma-mapping.mjs

From frontend package:
- npm run validate:figma

CI:
- .github/workflows/ci.yml
- .github/workflows/validate-figma-mapping.yml

## Naming and Ownership Rules
- Route naming in mapping must match frontend route behavior.
- Primary naming decision:
  - route: /operativo
  - label: Operativo (Playbooks)
- /playbooks remains a redirect alias and is not a primary mapping target.

## What This Spec Does Not Claim
- It does not claim node IDs are verified against Figma API.
- It does not claim visual parity between code and Figma.
- It does not claim automatic token synchronization.

## Missing Inputs Required for Full Validation
1. official figma.fileKey
2. official figma.fileUrl
3. official node IDs for all mapped entries
