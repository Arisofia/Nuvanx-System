# Audit: Doctoralia Sequential Lead Auto-Status
**Date**: 2026-06-10
**Migration**: `20260610213000_auto_advance_lead_status_from_doctoralia_sequence.sql`

## Context
This audit documents the transition from manual lead stage tracking to an automatic, sequential classification based on the real appointment history from Doctoralia. The goal is to eliminate dependency on manual stage changes by the clinic team, which are often incomplete or inconsistent.

## Key Changes

### 1. Identity Resolution (Enhanced)
The patient identity is now resolved using a prioritized sequence:
1. `phone_normalized` (Most reliable)
2. `patient_name` (Normalized via `public.normalize_name`)
3. `doctoralia_id` (Fallback)

This change ensures that patients are correctly grouped even if their `doctoralia_id` changes across appointments.

### 2. Sequential Logic
State advancement now depends strictly on the sequence of non-cancelled appointments:

| Order | Condition | Automatic Status |
| :--- | :--- | :--- |
| 1st Appointment | First valid appearance in Doctoralia | `agendado` |
| 2nd Appointment | If `is_jjrt = true` | `convertido` |
| 2nd Appointment | If `is_jjrt = false` | `pendiente_revision` |
| 3rd+ Appointment | Any subsequent valid appointment | `recurrente` |

**Note**: `is_cancelled = true` appointments are excluded from sequence counting but are marked as `cancelado`.

### 3. Decoupling from Financial Settlements
Monetization data (revenue, paid status) is strictly separated from clinical/operational classification. A patient is "Converted" if they have a 2nd medical appointment (JJRT), regardless of whether they have a matching payment in `financial_settlements` yet.

### 4. Figma/KPI Integration
All core reporting views were updated to join with `v_lead_status_classification`:
- `vw_campaign_performance_real`: Updated `booked`, `conversions`, and added `recurrent`.
- `v_figma_campaign_kpis`: Added `recurrent` metric and updated rates.
- `v_figma_executive_summary`: Conversions now match the new sequential definition.
- `v_figma_conversion_funnel`: Updated stages to reflect the new pipeline.

## Validation Metrics (Data from Supabase)
- **Total Appointments**: 651
- **Cancelled/Anuladas**: 90
- **Valid Appointments**: 561
- **JJRT Appointments**: 309
- **Control Appointments**: 210

## Impact
- **Accuracy**: Real-time status based on actual agenda activity.
- **Independence**: No longer relies on `leads.stage` being manually updated.
- **Funnel Clarity**: Clear distinction between an "Appointment Booked" (1st), a "Converted Patient" (2nd JJRT), and a "Recurrent Patient" (3rd+).
