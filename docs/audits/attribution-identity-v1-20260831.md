# Attribution Identity v1 — 2026-08-31

## Canonical ownership

`nuvanx.com` captures consented acquisition identity. HubSpot remains the operational CRM submission authority. Supabase `web_lead_captures` is the canonical acquisition lineage ledger. `finalize_web_capture_reconciliation()` is the single owner that fills missing attribution columns on the active lead episode.

## Consent boundary

Without marketing consent, first/conversion attribution objects are empty and `gclid`, `fbc`, `fbp`, landing and UTM fields are not written by web reconciliation.

With marketing consent:

- Google: GCLID/GBRAID/WBRAID/GCLSRC can be captured.
- Meta: `fbclid` is evidence; `fbc` can use the real `_fbc` cookie or be deterministically constructed from `fbclid + touch timestamp`; `fbp` is accepted only from a real `_fbp` cookie and is never synthesized.
- Existing non-empty lead attribution is never overwritten.

## QA cleanup

Production contained 14 historical, unapplied Google attribution QA rows. Migration `20260831031258` removed only rows matching the explicit staging/test identifier contract. Post-migration production state is 0 Google attribution rows and 0 pending rows. The local migration accepts 0 on deterministic clean replay, 14 on the original production state, and fails closed for any other count.

## Current real-data baseline

At implementation time:

- active leads: 706;
- canonical web captures: 0;
- Google attribution rows after QA cleanup: 0;
- historical active lead coverage: GCLID 0, FBC 0, FBP 0, UTM source 4.

These zeros are not backfilled or fabricated. New coverage begins only from real future submissions that satisfy the consented contract.

## Control Centre

`nvx_get_attribution_health()` exposes aggregate, no-PII counts/freshness to authenticated Control Centre sessions. `AttributionHealthMonitor` renders that contract on the first Dashboard page.
