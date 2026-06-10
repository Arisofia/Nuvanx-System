# Audit: Doctoralia Sequential Lead Auto-Status
**Date**: 2026-06-10
**Migration**: `20260610213000_auto_advance_lead_status_from_doctoralia_sequence.sql`

## Context
This audit documents the transition from manual lead stage tracking to automatic sequential classification based on appointment history from Doctoralia.

## Sequential Logic

| Order | Condition | Automatic Status |
| :--- | :--- | :--- |
| 1st appointment | First valid appearance in Doctoralia | `agendado` |
| 2nd appointment | `is_jjrt = true` | `convertido` |
| 2nd appointment | `is_jjrt = false` | `pendiente_revision` |
| 3rd+ appointment | Any later valid appointment | `recurrente` |

Cancelled appointments are excluded from sequence counting and are marked as `cancelado`.

## Validation Query

Use live Supabase data instead of fixed numbers:

``sql
select
  count(*) as total_appointments,
  count(*) filter (where coalesce(is_cancelled, false) is true) as cancelled_appointments,
  count(*) filter (where coalesce(is_cancelled, false) is not true) as valid_appointments,
  count(*) filter (where coalesce(is_jjrt, false) is true) as jjrt_appointments,
  count(*) filter (where coalesce(is_control, false) is true) as control_appointments
from public.doctoralia_appointments_ingestion;
``

## Impact
- Live status based on actual agenda activity.
- No reliance on manually updated `leads.stage`.
- Revenue/payment are monetization dimensions, not patient-status dimensions.
