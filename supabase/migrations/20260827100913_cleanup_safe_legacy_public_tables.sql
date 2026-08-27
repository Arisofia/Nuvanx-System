-- Remove public tables that have been proven legacy/demo and have no current
-- runtime consumers. Intentionally avoids CASCADE so any unexpected dependency
-- aborts the migration instead of deleting dependent objects.

begin;

-- Demo blog seed data. comments must be dropped before posts because of its FK.
drop table if exists public.comments;
drop table if exists public.posts;

-- Retired presentation/deck progress feature.
drop table if exists public.deck_progress;

-- One-off Doctoralia backup/backfill/raw staging artifacts that are no longer
-- referenced by current functions, views, FKs or runtime code.
drop table if exists public.doctoralia_appointments_ingestion_backup_20260620;
drop table if exists public._doctoralia_backfill_20260620;
drop table if exists public.doctoralia_appointments_raw;

-- Unused market-intelligence prototype table (never populated in Production).
drop table if exists public.market_intelligence;

commit;
