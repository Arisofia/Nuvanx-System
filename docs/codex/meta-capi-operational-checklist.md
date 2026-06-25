# Meta/CAPI Operational Checklist (External Configuration)

> Scope: production operations that cannot be solved only with code changes.
> Last updated: 2026-06-25.

## Canonical Meta configuration

**Active Pixel / Dataset:** `1497940655079106`  
**Primary Meta ad account:** `act_9523446201036125`  
**Secondary/legacy ad account under audit:** `act_4172099716404860`

The old pixel/dataset `1405503384615251` is deprecated and must not be used for active browser Pixel, CAPI routing, Vercel environment variables, or Supabase integration metadata.

---

## 1) Meta browser Pixel + CAPI deduplication

**Where:** WordPress landing pages, Supabase Edge Functions, Meta Events Manager.

**Required action:**
1. Open **Events Manager** and select Pixel / Dataset `1497940655079106`.
2. Confirm event **Contact** and/or **Lead** is:
   - Active,
   - Recently received,
   - Eligible for optimization where Meta exposes that status.
3. Confirm the browser event uses `eventID` and the server-side CAPI event uses the same value as `event_id`.
4. Confirm the same conversion is not counted twice in Events Manager diagnostics.
5. Confirm `1405503384615251` is absent from active WordPress output, Supabase integration metadata, Vercel env values, and frontend runtime configuration.

**Expected result:** Browser Pixel and CAPI events merge by shared event ID; active reporting flows through Pixel / Dataset `1497940655079106`.

---

## 2) `fbc` empty in leads

**Where:** Meta Lead Gen form and landing URL strategy.

**Required action:**
1. Ensure destination/landing URL preserves query string parameter `fbclid`.
2. Validate browser capture path in frontend (`metaPixel.ts`) by opening a URL with `?fbclid=test123`.
3. Submit a test lead and verify `leads.fbc` is non-null when the lead comes from a Meta click.

**Expected result:** `fbc` is populated for click-driven leads, improving CAPI match quality (EMQ).

---

## 3) `act_4172099716404860` with spend but 0 leads

**Where:** Meta Ads Manager for account `act_4172099716404860`.

**Required action:**
1. Review campaign objective (Leads vs Awareness/Traffic).
2. If objective is not lead-optimized, reconfigure campaign objective/event mapping.
3. Confirm form destination and event mapping are aligned to Lead/Contact.
4. Confirm the account is routed to active Pixel / Dataset `1497940655079106` if it remains in use.

**Expected result:** Account-level leads stop remaining structurally zero while spend accrues.

---

## 4) `agent_outputs = 0` rows

**Where:** Frontend playbook execution with valid authenticated JWT.

**Required action:**
1. Obtain a real authenticated JWT (non-anonymous) for a production user.
2. Execute one playbook run from `/playbooks` UI **or** via API call:

```bash
curl -X POST "${SUPABASE_URL}/functions/v1/api/playbooks/<slug>/run" \
  -H "Authorization: Bearer ${REAL_USER_JWT}" \
  -H "Content-Type: application/json" \
  -d '{}'
```

3. Validate persistence in DB:

```sql
select id, user_id, clinic_id, agent_type, created_at
from public.agent_outputs
order by created_at desc
limit 20;
```

**Expected result:** API returns `success: true` and at least one new row is visible in `agent_outputs`.

---

## Audit closure criteria

Mark the incident as closed only when **all** conditions are true:
- Pixel / Dataset `1497940655079106` receives Lead/Contact events in real time.
- No active configuration points to deprecated pixel `1405503384615251`.
- Browser `eventID` and server CAPI `event_id` match for the same Contact/Lead conversion.
- New CAPI-trackable leads have non-null `fbc` where applicable.
- Account `act_4172099716404860` has objective-event alignment for lead generation or is intentionally excluded from active reporting.
- `agent_outputs` receives rows from a JWT-authenticated playbook run.
