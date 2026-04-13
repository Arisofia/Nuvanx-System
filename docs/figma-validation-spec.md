# Figma ↔ GitHub Validation Specification

**Version:** 1.0.0
**Status:** Phase 0 - Foundation
**Last Updated:** 2026-04-13

---

## Overview

This document defines the validation rules, processes, and tooling for maintaining design-to-code consistency between Figma designs and the Nuvanx System GitHub repository.

---

## Goals

1. **Prevent design drift** — Ensure implemented UI matches approved Figma designs
2. **Enable traceability** — Link every screen/component to its Figma source
3. **Automate validation** — CI checks catch missing mappings before merge
4. **Support collaboration** — Designers/developers share a single source of truth

---

## Validation Layers

### Layer 1: Structural Validation (Phase 0) ✅
**What:** Validate that the component mapping file is well-formed and complete
**How:** JSON schema validation + file existence checks
**When:** On every PR via CI

**Checks:**
- ✅ `docs/figma-component-map.json` exists and parses as valid JSON
- ✅ All required fields present (`figmaFileKey`, `screens`, `components`)
- ✅ All code file paths exist in repository
- ✅ All routes match defined routes in `App.jsx`
- ✅ No duplicate component/screen names
- ✅ `lastSync` timestamp is within acceptable staleness threshold (default: 30 days)

**Exit Code:** Warn-only (does not block merge)

### Layer 2: Figma API Validation (Phase 1) 🔮
**What:** Verify Figma node IDs exist and haven't been renamed/deleted
**How:** Query Figma REST API with node IDs from mapping file
**When:** On every PR (requires `FIGMA_ACCESS_TOKEN` secret)

**Checks:**
- Node IDs resolve successfully via Figma API
- Node names in Figma match expected names
- File key is valid and accessible
- Design files haven't been archived/deleted

**Exit Code:** Fail (blocks merge if validation enabled)

### Layer 3: Design Token Sync (Phase 2) 🔮
**What:** Ensure design tokens (colors, spacing, typography) match Figma Variables/Styles
**How:** Compare `tailwind.config.js` against Figma Variables API response
**When:** On PR + pre-commit hook

**Checks:**
- Brand colors match Figma color styles
- Spacing scale matches Figma spacing variables
- Typography tokens match Figma text styles

**Exit Code:** Fail (blocks merge)

### Layer 4: Visual Regression (Phase 3) 🔮
**What:** Screenshot comparison against Figma frames
**How:** Playwright + Percy/Chromatic integration
**When:** On PR to `main`

**Checks:**
- Rendered pages match Figma designs (with threshold)

**Exit Code:** Fail (blocks merge)

---

## Component Mapping Schema

**Location:** `docs/figma-component-map.json` (copy from `.example.json` and populate)

### Required Top-Level Fields

```json
{
  "version": "1.0.0",
  "repository": "Arisofia/Nuvanx-System",
  "figma": {
    "fileKey": "string (required)",
    "fileUrl": "string (required)",
    "lastSync": "ISO 8601 timestamp (required)"
  },
  "screens": [ /* array of screen objects */ ],
  "components": [ /* array of component objects */ ],
  "validationRules": { /* validation config */ }
}
```

### Screen Object Schema

```json
{
  "name": "string (unique, required)",
  "route": "string (must match App.jsx routes, required)",
  "figmaNodeId": "string (format: '123:456', required)",
  "figmaUrl": "string (deep link to Figma node, required)",
  "component": "string (relative file path, required)",
  "status": "enum: implemented | in-progress | design-only",
  "lastValidated": "ISO 8601 timestamp (optional)",
  "notes": "string (optional)",
  "designReviewRequired": "boolean (default: false)"
}
```

### Component Object Schema

```json
{
  "name": "string (unique, required)",
  "figmaNodeId": "string (format: '123:456', required)",
  "figmaUrl": "string (deep link, required)",
  "component": "string (relative file path, required)",
  "status": "enum: implemented | in-progress | design-only",
  "lastValidated": "ISO 8601 timestamp (optional)",
  "notes": "string (optional)",
  "variants": "array of strings (optional)",
  "props": "object describing props (optional)",
  "a11y": "string (accessibility notes, optional)",
  "designReviewRequired": "boolean (default: false)"
}
```

---

## Validation Rules Configuration

**Location:** `docs/figma-component-map.json` → `validationRules` object

```json
{
  "strictMode": false,              // Phase 1: true = fail CI on errors
  "requireFigmaNodeIds": true,      // All entries must have node IDs
  "requireLastValidated": false,    // Phase 1: enforce validation timestamps
  "allowMissingDesigns": true,      // Allow status='design-only' without code file
  "warnOnStaleMappings": true,      // Warn if lastSync > staleDays old
  "staleDays": 30                   // Staleness threshold (days)
}
```

---

## Validation Script

**Location:** `scripts/validate-figma-mapping.js`

### Usage

```bash
# Run validation locally
node scripts/validate-figma-mapping.js

# Run in CI (warn-only mode)
node scripts/validate-figma-mapping.js --ci

# Run with Figma API validation (requires FIGMA_ACCESS_TOKEN env var)
FIGMA_ACCESS_TOKEN=<token> node scripts/validate-figma-mapping.js --api-check
```

### Exit Codes

- `0` — Validation passed
- `1` — Validation failed (strict mode)
- `2` — Validation warnings (non-strict mode, CI should pass but report warnings)

### Output Format

```
✅ Figma Validation Report
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

[PASS] JSON schema valid
[PASS] All code files exist (13/13)
[PASS] All routes match App.jsx (7/7)
[PASS] No duplicate names
[WARN] Mapping last synced 45 days ago (threshold: 30 days)

Screens:    7/7 ✅
Components: 6/6 ✅
Warnings:   1
Errors:     0

Status: ✅ PASS (warn-only mode)
```

---

## CI Integration

**Location:** `.github/workflows/figma-validation.yml` (or extend `ci.yml`)

### Phase 0: Structural Validation Only

```yaml
name: Figma Validation
on: [pull_request]

jobs:
  validate-figma-mapping:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - name: Run Figma validation (warn-only)
        run: node scripts/validate-figma-mapping.js --ci
        continue-on-error: true  # Phase 0: warnings only
      - name: Post validation report as PR comment
        uses: actions/github-script@v7
        if: always()
        with:
          script: |
            // Read validation output and post as comment
            // (Implementation details omitted for brevity)
```

### Phase 1: API Validation (Future)

```yaml
- name: Run Figma API validation
  env:
    FIGMA_ACCESS_TOKEN: ${{ secrets.FIGMA_ACCESS_TOKEN }}
  run: node scripts/validate-figma-mapping.js --ci --api-check
  continue-on-error: false  # Phase 1: fail on errors
```

---

## Workflow: Adding a New Screen

1. **Designer:** Create Figma design, get node ID (right-click → Copy/Paste → Copy as → Copy link → extract node-id from URL)
2. **Designer:** Add entry to `docs/figma-component-map.json`:
   ```json
   {
     "name": "Settings",
     "route": "/settings",
     "figmaNodeId": "789:123",
     "figmaUrl": "https://www.figma.com/design/FILE_KEY?node-id=789-123",
     "component": "frontend/src/pages/Settings.jsx",
     "status": "design-only",
     "designReviewRequired": true
   }
   ```
3. **Developer:** Implement `Settings.jsx`, update status to `"implemented"`
4. **Developer:** Open PR, CI validates mapping
5. **Reviewer:** Approves design match, merges PR
6. **Developer:** Update `lastValidated` timestamp after merge

---

## Workflow: Updating Tailwind Design Tokens

### Manual Sync (Phase 0)

1. **Designer:** Updates color in Figma (e.g., Brand/500 → new hex value)
2. **Designer:** Updates `docs/figma-component-map.json` → `designSystem.tokens.colors.value`
3. **Developer:** Updates `frontend/tailwind.config.js` → `colors.brand[500]`
4. **Developer:** Commits both changes in same PR
5. CI validates consistency (future: automated check)

### Automated Sync (Phase 2, Future)

1. **Designer:** Updates color in Figma
2. **CI:** Detects mismatch via Figma Variables API
3. **CI:** Auto-generates PR with updated `tailwind.config.js`
4. **Developer:** Reviews and merges

---

## FAQ

### Q: What if a design doesn't exist in Figma yet?
**A:** Set `status: "design-only"` and leave `component` field pointing to a placeholder or future file path. Set `allowMissingDesigns: true` in validation rules.

### Q: What if I'm working on a prototype/experiment?
**A:** Use a feature branch and don't add to `figma-component-map.json` until the design is approved for production.

### Q: How do I find a Figma node ID?
**A:** In Figma, right-click the frame/component → Copy/Paste as → Copy link. The URL format is:
```
https://www.figma.com/design/FILE_KEY/Title?node-id=123-456
```
Extract `123:456` (replace hyphen with colon).

### Q: Can I use this for backend/API changes?
**A:** No, this is frontend-only. Backend changes should reference Figma mockups of API responses (if applicable) in PR descriptions.

### Q: What if the Figma file is private?
**A:** Store `FIGMA_ACCESS_TOKEN` as a GitHub Secret. The token needs read access to the Figma file (generate via Figma Settings → Personal Access Tokens).

---

## Roadmap

| Phase | Deliverable | Status | ETA |
|-------|-------------|--------|-----|
| **Phase 0** | Structural validation script + docs | ✅ In Progress | 2026-04-13 |
| **Phase 1** | Figma API integration | 🔮 Planned | TBD |
| **Phase 2** | Design token sync automation | 🔮 Planned | TBD |
| **Phase 3** | Visual regression testing | 🔮 Planned | TBD |

---

## References

- [Figma REST API Docs](https://www.figma.com/developers/api)
- [Figma Code Connect](https://www.figma.com/developers/code-connect)
- [Style Dictionary](https://amzn.github.io/style-dictionary/) (for token sync)
- [Tailwind CSS Theming](https://tailwindcss.com/docs/theme)

---

**Specification Status:** ✅ Complete (Phase 0)
**Next Steps:** Implement `scripts/validate-figma-mapping.js`
