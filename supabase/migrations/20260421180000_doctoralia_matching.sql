-- 20260421180000_doctoralia_matching.sql
-- Adds parsed columns to doctoralia_raw, creates doctoralia_patients,
-- doctoralia_lead_matches, and the run_doctoralia_name_match() function.
-- NOTE: doctoralia_raw was already created by remote migrations with
--   id BIGINT PK, clinic_id UUID, upload_id UUID, raw_row JSONB, processed BOOLEAN.
--   This migration adds the parsed/normalised field columns for the ingest script.

ALTER TABLE doctoralia_raw
  ADD COLUMN IF NOT EXISTS raw_hash          VARCHAR(64),
  ADD COLUMN IF NOT EXISTS ingested_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS source_file_id    TEXT,
  ADD COLUMN IF NOT EXISTS sheet_name        TEXT,
  ADD COLUMN IF NOT EXISTS estado            VARCHAR(32),
  ADD COLUMN IF NOT EXISTS fecha             DATE,
  ADD COLUMN IF NOT EXISTS hora              VARCHAR(32),
  ADD COLUMN IF NOT EXISTS fecha_creacion    DATE,
  ADD COLUMN IF NOT EXISTS hora_creacion     TIME,
  ADD COLUMN IF NOT EXISTS asunto            TEXT,
  ADD COLUMN IF NOT EXISTS agenda            VARCHAR(128),
  ADD COLUMN IF NOT EXISTS sala_box          VARCHAR(64),
  ADD COLUMN IF NOT EXISTS confirmada        BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS procedencia       VARCHAR(64),
  ADD COLUMN IF NOT EXISTS importe           NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS doc_patient_id    VARCHAR(16),
  ADD COLUMN IF NOT EXISTS patient_name      TEXT,
  ADD COLUMN IF NOT EXISTS patient_name_norm TEXT,
  ADD COLUMN IF NOT EXISTS phone_primary     VARCHAR(16),
  ADD COLUMN IF NOT EXISTS phone_secondary   VARCHAR(16),
  ADD COLUMN IF NOT EXISTS treatment         TEXT,
  ADD COLUMN IF NOT EXISTS appointment_start TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS created_record_at TIMESTAMPTZ;

-- Unique index on raw_hash for upsert dedup
CREATE UNIQUE INDEX IF NOT EXISTS doctoralia_raw_hash_idx
  ON doctoralia_raw(raw_hash) WHERE raw_hash IS NOT NULL;

-- One row per Doctoralia patient_id — links to leads after name matching
CREATE TABLE IF NOT EXISTS doctoralia_patients (
  doc_patient_id   VARCHAR(16) NOT NULL,
  clinic_id        UUID        NOT NULL REFERENCES clinics(id),
  full_name        TEXT,
  name_norm        TEXT,
  phone_primary    VARCHAR(16),
  phone_secondary  VARCHAR(16),
  first_seen_at    TIMESTAMPTZ,
  lead_id          UUID REFERENCES leads(id),
  match_confidence NUMERIC(4,3),
  match_class      VARCHAR(32),
  PRIMARY KEY (doc_patient_id, clinic_id)
);

-- Probabilistic match audit log
CREATE TABLE IF NOT EXISTS doctoralia_lead_matches (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  raw_hash            VARCHAR(64),
  lead_id             UUID        REFERENCES leads(id),
  match_class         VARCHAR(32) NOT NULL,
  confidence          NUMERIC(4,3) NOT NULL,
  name_score          NUMERIC(4,3),
  phone_match         BOOLEAN     DEFAULT FALSE,
  temporal_days_delta INTEGER,
  match_method        TEXT,
  reviewed            BOOLEAN     DEFAULT FALSE,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

-- Fuzzy name-based matching: links doctoralia_patients to leads
CREATE OR REPLACE FUNCTION run_doctoralia_name_match() RETURNS void AS $$
DECLARE
  r           RECORD;
  l           RECORD;
  sim         NUMERIC;
  ph_match    BOOLEAN;
  best_lid    UUID;
  best_score  NUMERIC := 0;
BEGIN
  FOR r IN SELECT * FROM doctoralia_patients LOOP
    best_lid   := NULL;
    best_score := 0;
    FOR l IN SELECT id, name, phone FROM leads WHERE clinic_id = r.clinic_id LOOP
      sim      := similarity(r.name_norm, lower(unaccent(COALESCE(l.name, ''))));
      ph_match := r.phone_primary IS NOT NULL
                  AND l.phone IS NOT NULL
                  AND r.phone_primary = regexp_replace(l.phone, '\D', '', 'g');
      IF sim > best_score OR (sim = best_score AND ph_match) THEN
        best_score := sim;
        best_lid   := l.id;
      END IF;
    END LOOP;
    IF best_lid IS NOT NULL AND best_score >= 0.85 THEN
      UPDATE doctoralia_patients
        SET lead_id          = best_lid,
            match_confidence = best_score,
            match_class      = CASE
              WHEN best_score = 1.0 THEN 'exact_match'
              WHEN best_score >= 0.92 THEN 'high_confidence'
              ELSE 'possible_match'
            END
      WHERE doc_patient_id = r.doc_patient_id AND clinic_id = r.clinic_id;
    END IF;
  END LOOP;
END;
$$ LANGUAGE plpgsql;
