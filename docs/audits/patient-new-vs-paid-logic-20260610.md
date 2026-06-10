# Audit: Patient New vs Paid Logic Reconciliation
**Date**: 2026-06-10
**Status**: Implemented

## Context
The previous logic for classifying "New Patients" was tightly coupled with payment data (`financial_settlements`). This caused issues because not all patients pay through Doctoralia, and "New" should be defined by the first appearance in the clinic's agenda/history, regardless of monetization.

## Changes Implemented

### 1. Identity Resolution
A new `identity_key` is used to track patients across `doctoralia_appointments_ingestion`:
1. `doctoralia_id` (Highest priority)
2. `phone_normalized`
3. `public.normalize_name(patient_name)` (Fallback)

### 2. New View: `v_doctoralia_patient_history`
Aggregates appointment history by `identity_key` to determine:
- `first_seen_at`: Minimum of `created_date` or `appointment_date`.
- `first_appointment_at`: Minimum `appointment_date`.
- `total_appointments` and `effective_appointments` (non-cancelled).

### 3. New View: `v_doctoralia_patient_appointment_classification`
Ranks and classifies every appointment in the system:
- **cancelled**: `is_cancelled = true`.
- **control**: `is_control = true`.
- **future_scheduled**: `appointment_date > current_date` and not cancelled.
- **new**: The first effective appointment for that identity.
- **returning**: Any subsequent effective appointment.

### 4. Decoupled Reporting Views
The following views were updated to use the new classification logic:
- `v_patient_conversion_detail` / `v_patient_conversion_monthly`
- `v_new_clients_by_channel_detail` / `v_new_clients_by_channel_monthly`

Revenue data from `financial_settlements` is now a separate layer joined by `phone_normalized`, ensuring that "New" status is preserved even if no payment is found.

## Validation Results (Expected)
- **Total Rows**: Should match 651 rows from `doctoralia_appointments_ingestion`.
- **Unique Identities**: Approximately 396.
- **Revenue**: Continues to match `financial_settlements` totals without duplication.
- **New Patients**: Counted only once per identity based on their first successful appointment.

## Impact on Frontend
- Maintained column name compatibility for existing dashboard widgets.
- Added `status_detail` to provide more granular visibility into patient classification.
- Separated `is_new_patient` from `is_paid_patient` for more accurate funnel analysis.
