-- Remote migration history shim for version 20260820163616.
--
-- Production Supabase already records fix_no_show_and_cancelled_funnel as applied
-- under this exact version, while the canonical repository no longer contains the
-- historical migration file. Keep this deterministic no-op so local and remote
-- migration ledgers can be compared without destructive history repair.
do $noop$
begin
  null;
end
$noop$;
