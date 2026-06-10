# Doctoralia Lead Matching Layer Audit - 2026-06-10

## Overview
This document describes the implementation of the matching layer between Doctoralia appointments and CRM Leads. This layer is designed to be non-destructive, providing audit views to validate attribution and status progression without modifying core tables like `public.leads`.

## Components

### 1. Sequence and Auto-Status (PR 1)
- **View**: `public.v_doctoralia_appointment_sequence`
- **Logic**: Tracks the sequence of valid (non-cancelled) appointments for each patient.
- **Identity Key**: Resolved via `phone_normalized`, then `normalize_person_name(patient_name)`, and finally `doctoralia_id`.
- **Status Progression**:
  - **agendado**: 1st valid appointment (including 1st JJRT).
  - **convertido**: 2nd valid appointment IF it belongs to a JJRT agenda.
  - **recurrente**: 3rd or subsequent valid appointment.
  - **cancelado**: Any cancelled appointment (does not advance sequence).

### 2. Matching Audit Layer (PR 2)
- **View**: `public.v_doctoralia_lead_identity_candidates`
- **Match Types**:
  - **phone_exact**: Exact match on normalized phone numbers (Confidence: 1.00).
  - **name_and_date_window**: Normalized name match where lead was created before the appointment (max 180 days) (Confidence: 0.85).
  - **name_exact_requires_review**: Normalized name match outside the 180-day window or after the appointment (Confidence: 0.60).
- **View**: `public.v_doctoralia_lead_best_match`
  - Filters candidates to only include `phone_exact` and `name_and_date_window`.
  - Selects the best match per appointment based on confidence and temporal proximity.
- **View**: `public.v_lead_status_auto_consolidated`
  - Merges CRM lead data with the best available Doctoralia status.
  - **status_source**: `doctoralia_match` or `crm_fallback`.

## Safety and Constraints
- **Non-destructive**: No `UPDATE` or `INSERT` operations on `public.leads`.
- **RLS**: Views use `security_invoker = true` to respect underlying table policies.
- **Window Limit**: 180-day maximum window between lead creation and appointment for name matching.
- **Exclusions**: Does not use `leads.stage` or `financial_settlements` for classification.
