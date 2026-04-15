# Figma ↔ Code Mapping Guide

This document explains how to maintain the Figma-to-code component mapping in `docs/figma-component-map.json`, how to extract real Figma node IDs, and how to run the validator locally and in CI.

---

## Table of Contents

1. [Overview](#overview)
2. [File Structure](#file-structure)
3. [Getting Real Node IDs from Figma](#getting-real-node-ids-from-figma)
4. [Running the Validator](#running-the-validator)
5. [CI Integration](#ci-integration)
6. [Adding New Screens or Components](#adding-new-screens-or-components)
7. [Troubleshooting](#troubleshooting)

---

## Overview

`docs/figma-component-map.json` is the single source of truth that links each Figma frame or component to its React implementation in `frontend/src/`. It enables:

- **Automated validation** — CI checks that every mapped file exists and every route is defined in `App.jsx`.
- **Design drift detection** — the `lastSync` timestamp triggers a staleness warning after 30 days.
- **Figma API checks** — with a personal access token, the validator can confirm that node IDs actually exist in the Figma file.

---

## File Structure

```jsonc
{
  "version": "1.0.0",
  "repository": "Arisofia/Nuvanx-System",
  "figma": {
    "fileKey": "uJkwaJl7MIf5DE2VaqV8Vd",   // ← from the Figma URL
    "fileUrl": "https://www.figma.com/...",
    "lastSync": "2026-04-13T22:00:00.000Z"  // ← update when you sync
  },
  "screens": [ /* one entry per page */ ],
  "components": [ /* one entry per reusable component */ ],
  "validationRules": { /* see below */ }
}
```

### Screen entry

```jsonc
{
  "name": "Dashboard",
  "route": "/dashboard",                      // must match App.jsx path
  "figmaNodeId": "12:34",                     // ← replace placeholder
  "figmaUrl": "https://www.figma.com/...",
  "component": "frontend/src/pages/Dashboard.jsx",
  "status": "implemented",
  "lastValidated": "2026-04-13T18:00:00.000Z",
  "notes": "Optional description"
}
```

### Component entry

```jsonc
{
  "name": "MetricCard",
  "figmaNodeId": "56:78",                     // ← replace placeholder
  "figmaUrl": "https://www.figma.com/...",
  "component": "frontend/src/components/MetricCard.jsx",
  "status": "implemented"
}
```

### Validation rules

| Field | Default | Effect |
|---|---|---|
| `strictMode` | `false` | When `true`, errors cause exit code 1 (CI fails) |
| `requireFigmaNodeIds` | `true` | Warns when placeholders are present |
| `staleDays` | `30` | Warns when `lastSync` is older than N days |

---

## Getting Real Node IDs from Figma

Node IDs use the format `number:number` (e.g. `12:34`).

### For a Figma Design file

1. Open the file in Figma.
2. Click on the frame or component you want to map.
3. In the browser address bar, look for `node-id=12-34`.
4. Replace the dash with a colon: `12-34` → `12:34`.
5. Paste that value into the `figmaNodeId` field in `figma-component-map.json`.

**Alternative — Copy link:**
1. Right-click on the frame → **Copy/Paste as → Copy link**.
2. The URL contains `?node-id=12-34`. Convert `12-34` → `12:34`.

### For a Figma Make file

Figma Make files (`figma.com/make/…`) expose node IDs the same way. Note that the REST API endpoint `/v1/files/:key` is not supported for Make files, so `--api-check` will warn instead of erroring.

---

## Running the Validator

### Prerequisites

Install dependencies:

```bash
npm install
```

### Commands

```bash
# Canonical validator command
npm run validate:figma

# API check — validates node IDs against the live Figma file
FIGMA_ACCESS_TOKEN=<your-token> npm run validate:figma -- --api-check
```

### What the validator checks

| Check | Type | Description |
|---|---|---|
| JSON syntax | ❌ Error | File must be valid JSON |
| Required fields | ❌ Error | `version`, `figma.fileKey`, `screens`, etc. |
| Component files exist | ❌ Error | All `component` paths must exist on disk |
| Route in App.jsx | ⚠️ Warning | Each screen `route` must be defined in `frontend/src/App.jsx` |
| Duplicate names | ❌ Error | No two screens/components may share a name |
| Node ID format | ❌ Error | Must match `\d+:\d+` (when not a placeholder) |
| Placeholder node IDs | ⚠️ Warning | `REPLACE_WITH_NODE_ID` values need updating |
| Staleness | ⚠️ Warning | `lastSync` older than `staleDays` days |
| Figma API (opt-in) | ❌ Error | Node IDs must exist in the Figma file |

---

## CI Integration

Two GitHub Actions workflows run the validator automatically:

### `ci.yml` — warn-only

Runs on every push and pull request. Uses the same validator entrypoint and reports validation results in CI.

### `validate-figma-mapping.yml` — strict

Runs on PRs to `main` and pushes to `main`, `copilot/**`, `feature/**`, `fix/**`. Uses standard exit codes and fails on validation errors.

---

## Adding New Screens or Components

1. Create the React file (e.g. `frontend/src/pages/NewPage.jsx`).
2. Add a route in `frontend/src/App.jsx`.
3. Add an entry to the `screens` (or `components`) array in `docs/figma-component-map.json`:
   - Set `figmaNodeId` to the real node ID once you have it, or leave `REPLACE_WITH_NODE_ID` temporarily.
   - Set `status` to `"implemented"` (or `"in-progress"` / `"planned"`).
4. Update `figma.lastSync` to the current ISO timestamp.
5. Run `npm run validate:figma` and fix any errors before pushing.

---

## Troubleshooting

**"Mapping file not found"**
Make sure `docs/figma-component-map.json` exists and is valid JSON.

**"Component file not found"**
The `component` path in the JSON is relative to the repository root. Check for typos or file renames.

**"Route not found in App.jsx"**
Add the route to `frontend/src/App.jsx`, or update the `route` field in the mapping to match the existing path.

**"Figma API responded with 400: File type not supported"**
Your Figma file is a Make project. The REST API `/v1/files` endpoint does not support Make files. Node IDs must be copied manually from the Figma Make editor URL.

**"FIGMA_ACCESS_TOKEN not set"**
Generate a personal access token at **Figma → Account Settings → Personal access tokens** and export it:

```bash
export FIGMA_ACCESS_TOKEN=figd_...
npm run validate:figma -- --api-check
```
