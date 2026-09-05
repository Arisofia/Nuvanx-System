-- Meta lead IDs are provider lineage, not a repository-wide tenant identity.
-- The historical partial unique index made one provider external_id globally
-- unique across every clinic/user and could roll back a valid lead insert when
-- another owner legitimately carried the same external identifier.
--
-- Keep a non-unique lookup index for diagnostics and sync scans. Owner-scoped
-- lead matching is performed through public.leads, where user/clinic context is
-- available, while public.meta_attribution remains keyed by lead_id.

drop index if exists public.meta_attribution_leadgen_id_uidx;

create index if not exists meta_attribution_leadgen_id_idx
  on public.meta_attribution (leadgen_id)
  where leadgen_id is not null;
