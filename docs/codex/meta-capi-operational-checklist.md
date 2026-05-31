# Meta/CAPI Operational Checklist (External Configuration)

> Scope: production operations that cannot be solved only with code changes.
> Last updated: 2026-05-20.

## 1) Meta API `conversions = 0`

**Where:** Meta Events Manager → Pixel `1405503384615251` (account `act_9523446201036125`).

**Required action:**
1. Open **Events Manager** and select Pixel `1405503384615251`.
2. Confirm event **Lead** (or **Contact**, if that is your standard) is:
   - Active,
   - Recently received,
   - Eligible for optimization.
3. Confirm attribution settings/window in Ads Manager match dashboard reporting windows.

**Expected result:** New attributed conversions appear in Meta reporting endpoints; dashboard no longer remains hard-zero when spend exists.

---

## 2) `fbc` empty in leads

**Where:** Meta Lead Gen form and landing URL strategy.

**Required action:**
1. Ensure destination/landing URL preserves query string parameter `fbclid`.
2. Validate browser capture path in frontend (`metaPixel.ts`) by opening a URL with `?fbclid=test123`.
3. Submit a test lead and verify `leads.fbc` is non-null.

**Expected result:** `fbc` is populated for click-driven leads, improving CAPI match quality (EMQ).

---

## 3) `act_4172099716404860` with spend but 0 leads

**Where:** Meta Ads Manager for account `act_4172099716404860`.

**Required action:**
1. Review campaign objective (Leads vs Awareness/Traffic).
2. If objective is not lead-optimized, reconfigure campaign objective/event mapping.
3. Confirm form destination and event mapping are aligned to Lead/Contact.

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
- Pixel `1405503384615251` receives Lead/Contact events in real time.
- New CAPI-trackable leads have non-null `fbc` where applicable.
- Account `act_4172099716404860` has objective-event alignment for lead generation.
- `agent_outputs` receives rows from a JWT-authenticated playbook run.
