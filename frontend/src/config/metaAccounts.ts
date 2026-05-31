/**
 * Centralized Meta Assets Configuration (Frontend + Scripts)
 *
 * Source of truth for all Meta-related identifiers used across the system.
 *
 * Environment variables (VITE_* are exposed to the browser):
 *   VITE_META_ACCOUNT_IDS          → comma-separated ad accounts (act_...)
 *   VITE_META_FACEBOOK_PAGE_ID     → Facebook Page ID (Nuvanx)
 *   VITE_META_INSTAGRAM_ACCOUNT_ID → Instagram Business Account ID
 *
 * Non-VITE versions (META_*) are used by backend scripts / Edge Functions.
 *
 * Real values should live in .env.local or .env.tokens.local (never committed).
 */

const DEFAULT_META_AD_ACCOUNT_IDS = [
  'act_9523446201036125', // Principal
  'act_4172099716404860', // Secundaria
] as const;

const DEFAULT_FACEBOOK_PAGE_ID = '685010274687129';     // Nuvanx
const DEFAULT_INSTAGRAM_ACCOUNT_ID = '599157696620256'; // nuvanx_

/** Robust parser for comma-separated IDs coming from env */
function parseCsvList(envValue: string | undefined, defaults: readonly string[]): readonly string[] {
  if (envValue && envValue.trim().length > 0) {
    const parsed = envValue
      .split(/[,\s;]+/)
      .map((v) => v.trim())
      .filter(Boolean);

    if (parsed.length > 0) return parsed as readonly string[];
  }
  return defaults;
}

// ─────────────────────────────────────────────────────────────────────────────
// Ad Accounts (the two main ones used for all paid campaigns)
export const META_AD_ACCOUNT_IDS = parseCsvList(
  import.meta.env.VITE_META_ACCOUNT_IDS,
  DEFAULT_META_AD_ACCOUNT_IDS
);

// ─────────────────────────────────────────────────────────────────────────────
// Organic / Content Assets (newly centralized)
export const META_FACEBOOK_PAGE_ID = (
  import.meta.env.VITE_META_FACEBOOK_PAGE_ID ?? DEFAULT_FACEBOOK_PAGE_ID
).trim();

export const META_INSTAGRAM_ACCOUNT_ID = (
  import.meta.env.VITE_META_INSTAGRAM_ACCOUNT_ID ?? DEFAULT_INSTAGRAM_ACCOUNT_ID
).trim();

// ─────────────────────────────────────────────────────────────────────────────
// Convenience exports (most common usage in UI)

export const PRIMARY_META_AD_ACCOUNT = META_AD_ACCOUNT_IDS[0] ?? DEFAULT_META_AD_ACCOUNT_IDS[0];

/** Returns the list of ad accounts, optionally merged with extra ones passed at runtime */
export function resolveMetaAccountIds(extra: readonly unknown[] = []): readonly string[] {
  const extraClean = extra
    .map((x) => String(x ?? '').trim())
    .filter(Boolean);

  const merged = [...META_AD_ACCOUNT_IDS, ...extraClean];
  return Array.from(new Set(merged)); // dedup while preserving order
}

/** Human-friendly comma separated string (used in tables, notices, exports) */
export function formatMetaAccountIds(extra?: readonly unknown[]): string {
  return resolveMetaAccountIds(extra).join(', ');
}

// ─────────────────────────────────────────────────────────────────────────────
// Backwards-compatible aliases (used in several pages today)
export const META_ACCOUNT_IDS = META_AD_ACCOUNT_IDS;
export const resolveMetaAccountIdsLegacy = resolveMetaAccountIds;
export const formatMetaAccountIdsLegacy = formatMetaAccountIds;

// ─────────────────────────────────────────────────────────────────────────────
// Type helpers (for future stricter usage)
export type MetaAdAccountId = `act_${string}`;
export type FacebookPageId = string;
export type InstagramAccountId = string;
