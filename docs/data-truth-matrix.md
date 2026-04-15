# Data Truth Matrix

Date: 2026-04-14

Status values:
- real
- wired to real API
- mock but clearly labeled
- still pending backend support

| screen | element | current source | status | action taken |
|---|---|---|---|---|
| /dashboard | metric cards (revenue, leads, conversion, integrations) | /api/dashboard/metrics | wired to real API | Kept API wiring and clarified copy as API-backed. |
| /dashboard | revenue trend chart | /api/dashboard/revenue-trend | wired to real API | Kept chart, improved empty-state messaging. |
| /dashboard | funnel chart | /api/dashboard/funnel | wired to real API | Kept chart, explicit no-data messaging. |
| /dashboard | meta trends section | /api/dashboard/meta-trends with metadata.adAccountId | still pending backend support | Removed hardcoded adAccountId and added pending/not-connected labels when missing config. |
| /dashboard | hubspot trends section | /api/dashboard/hubspot-trends | wired to real API | Fetch only when hubspot integration is connected; otherwise explicit not-connected state. |
| /dashboard | AI optimization suggestions | /api/ai/suggestions | wired to real API | Removed implied always-available language and placeholder-style apply action. |
| /operativo | playbooks list, runs, success rates | local constant array in page | mock but clearly labeled | Added Demo Data banner and changed action toast to demo-only behavior. |
| /crm | lead table and counts | /api/leads | wired to real API | Added explicit note that list is API-backed. |
| /crm | add lead button | no create UI flow wired | wired to real API | Implemented AddLeadModal in CRM.jsx; form calls POST /api/leads and prepends new lead to table on success. |
| /crm | whatsapp/calendar/notes row actions | no backend action endpoints wired from UI | still pending backend support | Marked actions as placeholders in toasts. |
| /live | top cards | /api/dashboard/metrics | wired to real API | Retained backend polling and labeled source clearly. |
| /live | 24h chart | local generated zero series | mock but clearly labeled | Labeled Placeholder Data and explained missing endpoint. |
| /live | activity feed | local placeholder array | mock but clearly labeled | Labeled Mock Activity and explained missing stream endpoint. |
| /integrations | cards and statuses | /api/integrations + /api/integrations/validate-all | wired to real API | Updated subtitle to reflect backend status source. |
| /ai | generator and analyzer outputs | /api/ai/generate and /api/ai/analyze-campaign | wired to real API | No mock data found; kept failure messaging explicit for missing credentials. |
