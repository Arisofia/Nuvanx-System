# RLS Hardening & Traceability Final State (June 2026)

This document summarizes the final state of the Row Level Security (RLS) hardening and traceability infrastructure after the **20260603xxxx migration series**.

## Executive Summary

The 20260603 series completed a major consolidation and hardening effort:

- All critical RLS helpers were consolidated into robust, production-ready versions.
- CAPI attribution fields (`fbc`, `fbp`, `capi_sent`) were added across the data model.
- The broken `vw_campaign_performance_real` view was replaced with a real implementation.
- Dead code and early/obsolete RLS migrations were cleaned up and documented.
- All SECURITY DEFINER functions and helpers were locked down with explicit `search_path`.

## Consolidated Helpers (Final Versions)

The following functions represent the **canonical** versions as of June 2026:

| Function                        | File (Last Applied)                          | Key Hardening Points                          | Notes |
|--------------------------------|----------------------------------------------|-----------------------------------------------|-------|
| `public.normalize_phone()`     | 20260603000000                               | `search_path = public, pg_catalog`            | Spanish phone normalization |
| `public.run_doctoralia_name_match()` | 20260603000000                        | `search_path = public, pg_catalog`, alias fix | Fuzzy matching Doctoralia ↔ Leads |
| `public.current_clinic_id()`   | 20260603000000                               | Safe JWT handling, no broad exceptions        | Primary RLS helper |
| `public.current_user_id()`     | 20260603000000                               | Simple wrapper over `auth.uid()`              | - |
| `public.set_updated_at()`      | 20260603040000                               | `search_path = public, pg_catalog`            | Used by Meta tables triggers |

**Recommendation**: All future modifications to these helpers should be done through new migrations that `CREATE OR REPLACE` the functions with the same hardening patterns.

## CAPI & Traceability Enhancements

### New Columns Added

- **`leads.fbc`**, **`leads.fbp`**, **`leads.capi_sent`**
- **`produccion_intermediarios.capi_sent`**

These columns enable proper CAPI Purchase event handling with correct attribution data and duplicate prevention.

### Views Updated

- `vw_doctoralia_lead_traceability_unified` now exposes `lead_fbc` and `lead_fbp`.
- `vw_campaign_performance_real` was completely rewritten on top of `vw_doctoralia_lead_traceability_unified` + `meta_attribution` (no more hard-coded zeros).

### Key Migration Files

- `20260603010000_enrich_capi_and_traceability_columns.sql`
- `20260603030000_finalize_vw_campaign_performance_real_on_unified_view.sql`

## Cleanup Performed

### Functions Removed
- `public.is_service_role()` — dead function eliminated.

### Migrations Marked as Obsolete

The following early RLS and cron-related migrations are considered historical and should not be reapplied in clean environments:

- 20260523090000*
- 20260507170000*
- 20260521100000*
- Various early cron/anon RLS duplicates (historical markers removed in 2026-06 cleanup)

### Migration Hygiene

Only the final, consolidated RLS migrations from the 20260531 and 20260603 series should be considered active.

## Recommended State for Production

1. All 20260603xxxx migrations have been applied.
2. The following helpers are the source of truth:
   - `current_clinic_id()`
   - `normalize_phone()`
   - `run_doctoralia_name_match()`
3. `capi_sent` guard is active on `produccion_intermediarios`.
4. `vw_campaign_performance_real` uses real data from the unified traceability layer.
5. Early RLS migrations (pre-20260531) are treated as obsolete.

## Next Recommended Steps

- Update `scripts/run-daily-sync.js` and the Edge Function (`supabase/functions/api/index.ts`) to explicitly leverage the new `fbc`/`fbp`/`capi_sent` fields for CAPI Purchase events.
- Add monitoring/alerting around `capi_sent = false` for recent paid productions.
- Consider deprecating or archiving the obsolete migration files in a future cleanup sprint.

---

**Last Updated**: 2026-06-03  
**Maintained by**: Nuvanx Engineering  
**Related Documents**:
- `docs/sql/production-traceability-validation.sql`
- `docs/sql/phone-normalized-coverage.sql`
- `docs/architecture.md`
