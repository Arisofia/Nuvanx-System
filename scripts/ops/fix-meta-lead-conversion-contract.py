#!/usr/bin/env python3
from pathlib import Path
import re

path = Path('supabase/functions/api/index.ts')
text = path.read_text()
original = text


def replace_once(old: str, new: str, label: str) -> None:
    global text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly one match, got {count}')
    text = text.replace(old, new, 1)


# One canonical resolver for Meta lead conversions. `conversions` is not reliable
# for lead-gen campaigns; actions/DB generated lead_actions are authoritative fallbacks.
lead_fn = re.compile(r"function isLeadAction\(type: string\): boolean \{.*?\n\}", re.S)
match = lead_fn.search(text)
if not match:
    raise SystemExit('isLeadAction helper not found')
helper = match.group(0) + """

export function resolveMetaLeadConversions(row: any): number {
  const rawConversions = parseMetaMetric(row?.conversions);
  const leadActions = Math.max(
    actionValue(row?.actions, isLeadAction),
    parseMetaMetric(row?.lead_actions),
  );
  const messaging = Math.max(
    actionValue(row?.actions, isMessagingConversationAction),
    parseMetaMetric(row?.messaging_conversations),
  );
  return Math.max(rawConversions, leadActions, messaging);
}"""
text = text[:match.start()] + helper + text[match.end():]

replace_once(
"""  const messaging = daily.reduce((sum: number, day: any) => sum + actionValue(day.actions, isMessagingConversationAction), 0);
  const rawConversions = Math.round(sumN(daily, 'conversions'));
  
  return {""",
"""  const messaging = daily.reduce((sum: number, day: any) => sum + actionValue(day.actions, isMessagingConversationAction), 0);
  const conversions = Math.round(daily.reduce((sum: number, day: any) => sum + resolveMetaLeadConversions(day), 0));
  
  return {""",
'aggregateMetaInsightsSummary resolver',
)
replace_once(
"    conversions: rawConversions || messaging,",
"    conversions,",
'aggregateMetaInsightsSummary conversions',
)
replace_once(
"    conversions: s('conversions'),",
"    conversions: Math.round(daily.reduce((sum: number, row: any) => sum + resolveMetaLeadConversions(row), 0)),",
'aggregateMetaDailySummary conversions',
)

replace_once(
"""    conversions: Number(row.conversions ?? 0),
    messaging_conversations: Number(row.messaging_conversations ?? 0),
    actions: Number(row.lead_actions ?? 0) > 0
      ? [{ action_type: 'lead', value: String(Number(row.lead_actions ?? 0)) }]
      : [],""",
"""    conversions: Math.round(resolveMetaLeadConversions(row)),
    messaging_conversations: Number(row.messaging_conversations ?? 0),
    lead_actions: Number(row.lead_actions ?? 0),
    actions: [
      ...(Number(row.lead_actions ?? 0) > 0
        ? [{ action_type: 'lead', value: String(Number(row.lead_actions ?? 0)) }]
        : []),
      ...(Number(row.messaging_conversations ?? 0) > 0
        ? [{ action_type: 'messaging_conversation_started_7d', value: String(Number(row.messaging_conversations ?? 0)) }]
        : []),
    ],""",
'mapMetaDailyRowsToInsightsPayload',
)

replace_once(
"    conversions: sumField('conversions'),",
"    conversions: prevData.reduce((sum: number, row: any) => sum + resolveMetaLeadConversions(row), 0),",
'previous period conversions',
)
replace_once(
"const prevFields = campaignId ? 'impressions,reach,clicks,spend,conversions,campaign_id' : 'impressions,reach,clicks,spend,conversions';",
"const prevFields = campaignId ? 'impressions,reach,clicks,spend,conversions,actions,campaign_id' : 'impressions,reach,clicks,spend,conversions,actions';",
'previous period actions fields',
)

replace_once(
".select('date,impressions,reach,clicks,spend,ctr,cpc,cpm,conversions,messaging_conversations')",
".select('date,impressions,reach,clicks,spend,ctr,cpc,cpm,conversions,messaging_conversations,lead_actions,actions')",
'full DB fallback fields',
)
replace_once(
"      conversions: Math.round(sumN(dbRows, 'conversions')),
      messagingConversationStarted: Math.round(sumN(dbRows, 'messaging_conversations')),",
"      conversions: Math.round(dbRows.reduce((sum: number, row: any) => sum + resolveMetaLeadConversions(row), 0)),
      messagingConversationStarted: Math.round(sumN(dbRows, 'messaging_conversations')),",
'full DB fallback summary',
)
replace_once(
"        cpm: Number(r.cpm),
        messagingConversationStarted: Number(r.messaging_conversations),",
"        cpm: Number(r.cpm),
        conversions: Math.round(resolveMetaLeadConversions(r)),
        messagingConversationStarted: Number(r.messaging_conversations),",
'full DB fallback daily',
)

replace_once(
"""    const messagingConversations = actionValue(actionsArr, isMessagingConversationAction);
    const rawConversions = parseMetaMetric(r.conversions);
    const conversions = rawConversions || messagingConversations;""",
"""    const messagingConversations = actionValue(actionsArr, isMessagingConversationAction);
    const leadActions = actionValue(actionsArr, isLeadAction);
    const rawConversions = parseMetaMetric(r.conversions);
    const conversions = Math.max(rawConversions, leadActions, messagingConversations);""",
'persistMetaDailyInsights conversions',
)

# Campaign cards: Meta often reports lead-gen results only in actions.
map_campaign = re.compile(r"(function mapMetaCampaign\(c: any\) \{\n  const ins = c\?\.insights\?\.data\?\.\[0\];\n)  const conversions = parseMetaMetric\(ins\?\.conversions\);", re.S)
text, count = map_campaign.subn(r"\1  const conversions = resolveMetaLeadConversions(ins);", text, count=1)
if count != 1:
    raise SystemExit(f'mapMetaCampaign conversions: expected 1, got {count}')

# KPI live path must request actions and resolve leads with the same contract.
replace_once(
"fields: 'date_start,spend,impressions,clicks,ctr,cpc,conversions',",
"fields: 'date_start,spend,impressions,clicks,ctr,cpc,conversions,actions',",
'KPI live Meta fields',
)
replace_once(
"    conversions: rows.reduce((s: number, row: any) => s + parseMetaMetric(row.conversions), 0),",
"    conversions: rows.reduce((s: number, row: any) => s + resolveMetaLeadConversions(row), 0),",
'KPI live conversions',
)
replace_once(
"    conversions: rows.reduce((s: number, r: any) => s + Number(r.conversions ?? 0), 0),",
"    conversions: rows.reduce((s: number, r: any) => s + resolveMetaLeadConversions(r), 0),",
'KPI cached conversions',
)

# DB readers used by dashboard/KPI paths should expose the generated fallback columns.
text = text.replace(
".select('spend, impressions, clicks, conversions')",
".select('spend, impressions, clicks, conversions, lead_actions, messaging_conversations')",
)

# Any aggregate over persisted Meta rows must resolve the canonical lead count, not trust conversions=0.
replace_once(
"  const totalMetaConversions = metaData.reduce((s: number, r: any) => s + Number(r.conversions || 0), 0);",
"  const totalMetaConversions = metaData.reduce((s: number, r: any) => s + resolveMetaLeadConversions(r), 0);",
'dashboard aggregate conversions',
)

if text == original:
    raise SystemExit('patch made no changes')

required = [
    'export function resolveMetaLeadConversions',
    'Math.max(rawConversions, leadActions, messagingConversations)',
    "conversions: Math.round(resolveMetaLeadConversions(row))",
    "conversions: prevData.reduce((sum: number, row: any) => sum + resolveMetaLeadConversions(row), 0)",
    "conversions: Math.round(dbRows.reduce((sum: number, row: any) => sum + resolveMetaLeadConversions(row), 0))",
    "const conversions = resolveMetaLeadConversions(ins);",
    "fields: 'date_start,spend,impressions,clicks,ctr,cpc,conversions,actions'",
]
for marker in required:
    if marker not in text:
        raise SystemExit(f'missing contract marker: {marker}')

path.write_text(text)
print('META_LEAD_CONVERSION_PATCH=PASS')
