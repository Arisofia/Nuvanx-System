const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, '../supabase/migrations');

function getFuncBody(file, funcRegex) {
    const content = fs.readFileSync(path.join(srcDir, file), 'utf8');
    const match = content.match(funcRegex);
    if (!match) throw new Error("Not found in " + file);
    return match[0];
}

const f1 = getFuncBody('20260831004738_canonical_metrics_v2_and_quarantine_legacy_reconciliation.sql', /CREATE OR REPLACE FUNCTION public\.nvx_get_dashboard_metrics_v2[\s\S]*?(\$\$;|\$function\$;)/i);
const f2 = getFuncBody('20260830220605_align_control_centre_pipeline_to_clinic_scope.sql', /create or replace function public\.nvx_get_control_centre_pipeline[\s\S]*?(\$\$;|\$function\$;)/i);
const f3 = getFuncBody('20260830220605_align_control_centre_pipeline_to_clinic_scope.sql', /create or replace function public\.nvx_get_control_centre_lead_timeline[\s\S]*?(\$\$;|\$function\$;)/i);
const f4 = getFuncBody('20260831081800_harden_attribution_lineage_and_tenant_health.sql', /CREATE OR REPLACE FUNCTION public\.nvx_get_attribution_health[\s\S]*?(\$\$;|\$function\$;)/i);

function injectGuard(funcSql) {
    // Inject PERFORM public.nvx_assert_non_anonymous_session(); right after BEGIN
    return funcSql.replace(/(\b[B|b][E|e][G|g][I|i][N|n]\b)/, "$1\n    PERFORM public.nvx_assert_non_anonymous_session();");
}

let out = `-- Harden SECURITY DEFINER RPC Access

-- Create helper function for anonymous session assertion
CREATE OR REPLACE FUNCTION public.nvx_assert_non_anonymous_session()
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
BEGIN
    IF (SELECT current_setting('request.jwt.claims', true)::jsonb->>'is_anonymous') = 'true' THEN
        RAISE EXCEPTION 'Anonymous access is not allowed for this operation.';
    END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.nvx_assert_non_anonymous_session() TO authenticated, service_role;

-- Revoke execute from authenticated for internal functions
REVOKE EXECUTE ON FUNCTION public.nvx_get_hubspot_marketing_contact_monitor() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.nvx_get_attribution_health() FROM authenticated;

-- Redeclare with guard
`;

out += injectGuard(f4) + "\n";
out += "GRANT EXECUTE ON FUNCTION public.nvx_get_attribution_health() TO service_role;\n\n";

out += injectGuard(f1) + "\n";
out += "GRANT EXECUTE ON FUNCTION public.nvx_get_dashboard_metrics_v2(date,date,text,text) TO authenticated;\n\n";

out += injectGuard(f2) + "\n";
out += "GRANT EXECUTE ON FUNCTION public.nvx_get_control_centre_pipeline(integer,integer) TO authenticated;\n\n";

out += injectGuard(f3) + "\n";
out += "GRANT EXECUTE ON FUNCTION public.nvx_get_control_centre_lead_timeline(uuid,integer) TO authenticated;\n\n";

fs.writeFileSync(path.join(srcDir, '20260901080300_harden_security_definer_rpc_access.sql'), out);
console.log("Rebuilt 20260901080300_harden_security_definer_rpc_access.sql", out.length, "bytes");
