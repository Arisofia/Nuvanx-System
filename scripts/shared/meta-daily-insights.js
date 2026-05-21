'use strict';

class MissingClinicIdError extends Error {
  constructor(userId) {
    super(`Cannot persist meta_daily_insights: user ${userId} has no clinic_id.`);
    this.name = 'MissingClinicIdError';
    this.userId = userId;
  }
}

async function resolveUserClinicId(db, userId, fallbackClinicId = null) {
  if (fallbackClinicId) return fallbackClinicId;

  const { rows } = await db.query(
    `SELECT clinic_id FROM public.users WHERE id = $1 LIMIT 1`,
    [userId],
  );

  const clinicId = rows[0]?.clinic_id ?? null;
  if (!clinicId) {
    throw new MissingClinicIdError(userId);
  }

  return clinicId;
}

async function upsertMetaDailyInsight(db, row) {
  await db.query(`
    INSERT INTO public.meta_daily_insights
      (user_id, clinic_id, ad_account_id, date, impressions, reach, clicks, spend,
       conversions, ctr, cpc, cpm, messaging_conversations, updated_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
    ON CONFLICT (clinic_id, ad_account_id, date)
    DO UPDATE SET
      user_id                  = EXCLUDED.user_id,
      impressions              = EXCLUDED.impressions,
      reach                    = EXCLUDED.reach,
      clicks                   = EXCLUDED.clicks,
      spend                    = EXCLUDED.spend,
      conversions              = EXCLUDED.conversions,
      ctr                      = EXCLUDED.ctr,
      cpc                      = EXCLUDED.cpc,
      cpm                      = EXCLUDED.cpm,
      messaging_conversations  = EXCLUDED.messaging_conversations,
      updated_at               = EXCLUDED.updated_at
  `, [row.user_id, row.clinic_id, row.ad_account_id, row.date, row.impressions, row.reach, row.clicks,
      row.spend, row.conversions, row.ctr, row.cpc, row.cpm, row.messaging_conversations, row.updated_at]);
}

async function ensureMetaDailyInsightsConflictTarget(db) {
  await db.query(`ALTER TABLE public.meta_daily_insights ADD COLUMN IF NOT EXISTS clinic_id UUID`);
  await db.query(`
    UPDATE public.meta_daily_insights mdi
    SET clinic_id = u.clinic_id
    FROM public.users u
    WHERE mdi.user_id = u.id
      AND mdi.clinic_id IS NULL
      AND u.clinic_id IS NOT NULL
  `);
  await db.query(`
    WITH ranked AS (
      SELECT
        ctid,
        ROW_NUMBER() OVER (
          PARTITION BY clinic_id, ad_account_id, date
          ORDER BY updated_at DESC NULLS LAST, user_id
        ) AS rn
      FROM public.meta_daily_insights
      WHERE clinic_id IS NOT NULL
    )
    DELETE FROM public.meta_daily_insights mdi
    WHERE mdi.ctid IN (SELECT ctid FROM ranked WHERE rn > 1)
  `);
  await db.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS meta_daily_insights_clinic_account_date_uidx
      ON public.meta_daily_insights (clinic_id, ad_account_id, date)
  `);
}

module.exports = {
  MissingClinicIdError,
  resolveUserClinicId,
  upsertMetaDailyInsight,
  ensureMetaDailyInsightsConflictTarget,
};
