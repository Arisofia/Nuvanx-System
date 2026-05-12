# Lead Reconciliation Validation Runbook

Use this runbook after deploying changes that gate lead reconciliation behind the
`reconcile=true` query parameter. The goal is to verify that normal read paths
remain fast while operators still have an explicit way to force synchronous
reconciliation when freshness is required.

## Prerequisites

- A deployed Supabase Edge Function API environment.
- A valid user JWT for the clinic/user being validated.
- Access to Supabase Edge Function logs for `api`.
- The API base URL exported locally:

```bash
export API_BASE_URL="https://<project-ref>.supabase.co/functions/v1/api"
export USER_JWT="<JWT_DE_USUARIO>"
```

Do not commit JWTs, service-role keys, or production credentials.

## 1. Validate normal reads without reconciliation

Run the standard read requests without `reconcile=true`:

```bash
curl -i "${API_BASE_URL}/leads" \
  -H "Authorization: Bearer ${USER_JWT}"

curl -i "${API_BASE_URL}/reports/lead-audit" \
  -H "Authorization: Bearer ${USER_JWT}"
```

Expected result:

- Both requests return `200`.
- The JSON response includes `"reconciled": false`.
- Edge Function logs do not show reconciliation RPC warnings for these requests.
- Latency is consistent with a read-only list/report request.

## 2. Validate explicit synchronous reconciliation

Run the same requests with `reconcile=true`:

```bash
curl -i "${API_BASE_URL}/leads?reconcile=true" \
  -H "Authorization: Bearer ${USER_JWT}"

curl -i "${API_BASE_URL}/reports/lead-audit?reconcile=true" \
  -H "Authorization: Bearer ${USER_JWT}"
```

Expected result:

- Both requests return `200`.
- The JSON response includes `"reconciled": true`.
- Edge Function logs show any reconciliation warnings if an RPC returns an error.
- Latency can be higher than the non-reconciled requests because the endpoint
  waits for the reconciliation RPCs to settle.

## 3. Validate Lead Audit UI matching semantics

Open the deployed frontend and navigate to **Lead Audit**.

In browser DevTools, inspect the `GET /reports/lead-audit` response and confirm:

- Each lead row includes `doctoraliaMatched: true | false`.
- The UI matched count equals the number of response rows where
  `doctoraliaMatched === true`.
- Each row status icon follows the API boolean:
  - `doctoraliaMatched === true` renders the matched/check state.
  - `doctoraliaMatched === false` renders the no-match/X state.

Optional freshness check:

1. Trigger `GET /reports/lead-audit?reconcile=true` manually with the same JWT.
2. Refresh Lead Audit.
3. Confirm any rows changed by reconciliation are reflected by the API-provided
   `doctoraliaMatched` value, not by frontend-only fallback matching logic.

## 4. Acceptance criteria

The deployment is considered validated when:

- Normal reads do not run synchronous reconciliation.
- `?reconcile=true` runs reconciliation and reports `reconciled: true`.
- Lead Audit counts and row icons are consistent with `doctoraliaMatched` from
  the API response.
- No credentials or customer data are copied into repository files, PR comments,
  screenshots, or logs.
