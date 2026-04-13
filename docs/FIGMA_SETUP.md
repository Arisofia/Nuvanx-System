# Figma Validation Setup Guide

This guide explains how to set up and use the Figma ↔ GitHub validation system for the Nuvanx System.

---

## Quick Start

### 1. Copy the Example Mapping File

```bash
cp docs/figma-component-map.example.json docs/figma-component-map.json
```

### 2. Populate Figma File Key

Open `docs/figma-component-map.json` and replace:
- `REPLACE_WITH_FIGMA_FILE_KEY` with your actual Figma file key

**How to find the file key:**
```
https://www.figma.com/design/ABC123xyz/Nuvanx-Design
                                ^^^^^^^^^^^
                                This is the file key
```

### 3. Add Figma Node IDs

For each screen and component in the mapping file:

1. Open the Figma file
2. Right-click the frame/component
3. Select **Copy/Paste as → Copy link**
4. Extract the node ID from the URL:
   ```
   https://www.figma.com/design/FILE_KEY?node-id=123-456
                                                  ^^^^^^^
                                                  Convert to 123:456 (hyphen → colon)
   ```
5. Update the `figmaNodeId` field in the JSON file

### 4. Run Validation Locally

```bash
node scripts/validate-figma-mapping.js
```

You should see output like:
```
🎨 Figma Validation Report
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

[PASS] JSON schema valid
[PASS] All code files exist (13/13)
[PASS] All routes match App.jsx (7/7)
[PASS] No duplicate names

Screens:    7/7 ✅
Components: 6/6 ✅
Warnings:   0
Errors:     0

Status: ✅ PASS
```

---

## CI/CD Integration

The validation script runs automatically on every pull request via GitHub Actions.

**Workflow:** `.github/workflows/ci.yml`

**Current Mode:** Warn-only (Phase 0)
- ❌ Errors and warnings are reported
- ✅ PR is **not blocked** by validation failures
- 💬 Validation report is posted as a PR comment

**Future Phase 1:**
- Enable strict mode in `docs/figma-component-map.json`:
  ```json
  "validationRules": {
    "strictMode": true
  }
  ```
- PRs with validation errors will be blocked

---

## Workflow Examples

### Adding a New Screen

**Designer:**
1. Create the screen design in Figma
2. Get the Figma node ID (right-click → Copy link)
3. Add entry to `docs/figma-component-map.json`:
   ```json
   {
     "name": "Settings",
     "route": "/settings",
     "figmaNodeId": "789:123",
     "figmaUrl": "https://www.figma.com/design/FILE_KEY?node-id=789-123",
     "component": "frontend/src/pages/Settings.jsx",
     "status": "design-only",
     "notes": "User settings page with profile, preferences, billing",
     "designReviewRequired": true
   }
   ```
4. Commit the mapping file update

**Developer:**
1. Implement `frontend/src/pages/Settings.jsx`
2. Add route to `frontend/src/App.jsx`
3. Update mapping status to `"implemented"`
4. Run validation: `node scripts/validate-figma-mapping.js`
5. Commit code + mapping update
6. Open PR → CI validates automatically

### Adding a New Component

**Designer:**
1. Create component in Figma (make it a Component, not just a Frame)
2. Get node ID
3. Add to `docs/figma-component-map.json` → `components` array
4. Document props/variants in the mapping

**Developer:**
1. Implement React component in `frontend/src/components/`
2. Match props to Figma variants
3. Update mapping status to `"implemented"`
4. Run validation
5. Open PR

### Updating Design Tokens

**Manual Sync (Phase 0):**

1. **Designer:** Updates color in Figma (e.g., `Brand/500` → new hex)
2. **Designer:** Updates `docs/figma-component-map.json` → `designSystem.tokens.colors.value`
3. **Developer:** Updates `frontend/tailwind.config.js`:
   ```javascript
   colors: {
     brand: {
       500: '#NEW_HEX_VALUE',  // Update this
     }
   }
   ```
4. Commit both changes together in one PR

**Automated Sync (Phase 2, Future):**
- CI will auto-detect token mismatches via Figma Variables API
- Auto-generate PR with updated Tailwind config

---

## File Structure

```
docs/
├── figma-validation-audit.md         # Initial audit findings
├── figma-validation-spec.md          # Full specification
├── figma-component-map.example.json  # Template/schema
└── figma-component-map.json          # Active mapping (gitignored if contains secrets)

scripts/
└── validate-figma-mapping.js         # Validation CLI tool

.github/workflows/
└── ci.yml                            # CI pipeline with Figma validation job
```

---

## Validation Script CLI

### Basic Usage

```bash
# Run validation (local)
node scripts/validate-figma-mapping.js

# Run in CI mode (exit 0 even on warnings)
node scripts/validate-figma-mapping.js --ci

# Run with Figma API checks (Phase 1, requires token)
FIGMA_ACCESS_TOKEN=<token> node scripts/validate-figma-mapping.js --api-check
```

### Exit Codes

- `0` — Validation passed (or warnings in non-strict mode)
- `1` — Validation failed (strict mode only)
- `2` — Critical error (file not found, invalid JSON)

---

## Troubleshooting

### "Mapping file not found"

**Solution:**
```bash
cp docs/figma-component-map.example.json docs/figma-component-map.json
```

### "Invalid figmaNodeId format"

**Problem:** Node ID is still `REPLACE_WITH_NODE_ID` or in wrong format.

**Solution:** Get the node ID from Figma:
1. Right-click frame/component → Copy/Paste as → Copy link
2. Extract from URL: `node-id=123-456` → `123:456` (hyphen to colon)
3. Update JSON file

### "Code file not found: frontend/src/pages/Example.jsx"

**Problem:** File path in mapping doesn't match actual file location.

**Solution:** Check the actual file path:
```bash
find frontend/src -name "Example.jsx"
```
Update the `component` field in the mapping to match.

### "Route not found in App.jsx: /example"

**Problem:** Route is defined in mapping but not in `App.jsx`.

**Solution:** Add the route to `frontend/src/App.jsx`:
```javascript
<Route path="example" element={<Example />} />
```

---

## Phase Roadmap

| Phase | Status | Deliverables |
|-------|--------|--------------|
| **Phase 0** | ✅ Complete | Structural validation, docs, CI integration (warn-only) |
| **Phase 1** | 🔮 Planned | Figma API integration, strict mode, node existence checks |
| **Phase 2** | 🔮 Planned | Design token sync automation via Figma Variables API |
| **Phase 3** | 🔮 Planned | Visual regression testing (screenshot comparison) |

---

## Further Reading

- [Figma Validation Spec](./figma-validation-spec.md) — Full technical specification
- [Figma Validation Audit](./figma-validation-audit.md) — Initial audit findings
- [Figma REST API Docs](https://www.figma.com/developers/api) — Official API reference
- [Figma Code Connect](https://www.figma.com/developers/code-connect) — Future integration option

---

## Support

**Issues:** https://github.com/Arisofia/Nuvanx-System/issues
**Maintainers:** @Arisofia

---

**Last Updated:** 2026-04-13
**Current Phase:** Phase 0 (Foundation)
