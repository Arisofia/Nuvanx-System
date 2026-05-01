-- Supabase lint 0012 (auth_allow_anonymous_sign_ins) — targeted fix
--
-- Root cause 1 — audit_log:
--   audit_log_insert_only was created in 20260414180000 with no TO clause,
--   which PostgreSQL treats as TO public (all roles, including anon).  Any
--   unauthenticated request can INSERT audit records.  Restrict it to
--   service_role only — the only caller that should ever write audit rows.
--
-- Root cause 2 — leads:
--   leads_owner_only was recreated in 20260419103000 as TO public with
--   USING (current_setting('role') = 'service_role' OR auth.uid() = user_id).
--   The service_role branch is redundant (service_role bypasses RLS and is
--   covered by the separate leads_service_role policy).  The TO public scope
--   means the anon role and anonymous sign-in sessions (authenticated +
--   is_anonymous=true) are also matched, allowing an anonymous sign-in user
--   whose UUID happens to equal a leads.user_id to read and write that row.
--   Narrow to TO authenticated with an explicit is_anonymous guard.

-- ── 1. audit_log: restrict insert policy to service_role only ───────────────

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS audit_log_insert_only ON public.audit_log;
CREATE POLICY audit_log_insert_only
  ON public.audit_log
  FOR INSERT
  TO service_role
  WITH CHECK (TRUE);

-- ── 2. leads: add is_anonymous guard to owner policy ────────────────────────

ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS leads_owner_only ON public.leads;
CREATE POLICY leads_owner_only
  ON public.leads
  FOR ALL
  TO authenticated
  USING (
    (SELECT auth.uid()) = user_id
    AND COALESCE(((SELECT auth.jwt()) ->> 'is_anonymous')::boolean, false) = false
  )
  WITH CHECK (
    (SELECT auth.uid()) = user_id
    AND COALESCE(((SELECT auth.jwt()) ->> 'is_anonymous')::boolean, false) = false
  );

