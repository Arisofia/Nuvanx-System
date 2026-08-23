-- Preserve the strongest real Meta lead signal in persisted daily insights.
-- Meta lead-gen campaigns may report zero in `conversions` while `actions`
-- contains lead/contact actions. `lead_actions` is generated from `actions`.
-- Never reduce an existing conversion value.

update public.meta_daily_insights
set conversions = greatest(
  coalesce(conversions, 0),
  coalesce(lead_actions, 0),
  coalesce(messaging_conversations, 0)
)
where coalesce(conversions, 0) < greatest(
  coalesce(lead_actions, 0),
  coalesce(messaging_conversations, 0)
);
