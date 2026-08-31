# Doctoralia funnel production-safe repair

## Incident

Production deployment of `20260831173000_repair_funnel_and_source_to_cash_contracts.sql` timed out with SQLSTATE `57014` while calling `refresh_doctoralia_funnel()` for active lead owners.

Production evidence at diagnosis:

- 706 active leads;
- 2 active owners;
- 2,244 Doctoralia ingestion rows;
- the historical function performed a global Doctoralia classification UPDATE on every owner refresh and also wrote patient classification globally.

## Repair contract

The still-unapplied migration `20260831173000` is changed before Producton ledger registration so that:

1. Doctoralia classification is normalized exactly once using eight deterministic UUID-prefix batches.
2. Each batch writes only rows whose `funnel_stage` or `funnel_stage_reason` differs from the canonical value.
3. The canonical `refresh_doctoralia_funnel(p_user_id)` no longer performs any global Doctoralia UPDATE.
4. Lead matching, lead canonical stage and patient classification writes are scoped to `p_user_id`.
5. `no acude` is not classified as attended; a non-cancelled no-show remains a scheduled valuation rather than `asistio`.
6. No `statement_timeout` increase, `migration repair`, direct ledger mutation or manual data patch is used.

## Acceptance

- Supabase clean Preview applies the complete migration chain.
- Repository/backend/frontend/Playwright gates pass on the exact PR head.
- Production registers `20260831173000` and the following `20260831185000` migration.
- Production returns to `FUNCTIONS_DEPLOYED / ACTIVE_HEALTHY`.
- Post-deploy checks show no control/cancelled rows promoted to attended and no stale out-of-band backfill classification remains.
