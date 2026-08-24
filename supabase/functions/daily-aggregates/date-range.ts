export type MetaDateRangeInput = {
  days?: number;
  from?: string;
  to?: string;
};

export type ResolvedMetaDateRange = {
  since: string;
  until: string;
  mode: 'explicit' | 'rolling';
  lookback_days: number | null;
};

const DAY_MS = 86_400_000;
const MAX_EXPLICIT_RANGE_DAYS = 93;
const MAX_ROLLING_LOOKBACK_DAYS = 90;

function formatUtcDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function parseDateOnly(value: string, field: 'from' | 'to'): Date {
  const normalized = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw new Error(`${field} must use YYYY-MM-DD.`);
  }
  const [year, month, day] = normalized.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (formatUtcDate(parsed) !== normalized) {
    throw new Error(`${field} is not a valid calendar date.`);
  }
  return parsed;
}

export function resolveMetaDateRange(
  input: MetaDateRangeInput = {},
  now: Date = new Date(),
): ResolvedMetaDateRange {
  const from = typeof input.from === 'string' ? input.from.trim() : '';
  const to = typeof input.to === 'string' ? input.to.trim() : '';

  if (Boolean(from) !== Boolean(to)) {
    throw new Error('from and to must be provided together.');
  }

  if (from && to) {
    const start = parseDateOnly(from, 'from');
    const end = parseDateOnly(to, 'to');
    if (start.getTime() > end.getTime()) {
      throw new Error('from must be on or before to.');
    }
    const inclusiveDays = Math.floor((end.getTime() - start.getTime()) / DAY_MS) + 1;
    if (inclusiveDays > MAX_EXPLICIT_RANGE_DAYS) {
      throw new Error(`Explicit Meta range cannot exceed ${MAX_EXPLICIT_RANGE_DAYS} days.`);
    }
    return {
      since: from,
      until: to,
      mode: 'explicit',
      lookback_days: null,
    };
  }

  const rawDays = input.days ?? 2;
  if (!Number.isInteger(rawDays) || rawDays < 1 || rawDays > MAX_ROLLING_LOOKBACK_DAYS) {
    throw new Error(`days must be an integer between 1 and ${MAX_ROLLING_LOOKBACK_DAYS}.`);
  }

  const until = new Date(now.getTime());
  const since = new Date(now.getTime() - rawDays * DAY_MS);
  return {
    since: formatUtcDate(since),
    until: formatUtcDate(until),
    mode: 'rolling',
    lookback_days: rawDays,
  };
}
