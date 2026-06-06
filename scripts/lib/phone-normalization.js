'use strict';

/**
 * Mirrors public.normalize_phone(TEXT) in Supabase migrations.
 *
 * Matching uses local Spanish digits only: strip non-digits, then remove the
 * Spanish country prefix when represented as 0034... or 34... on numbers longer
 * than the local 9-digit format. Keep this implementation aligned with the SQL
 * function before changing Doctoralia matching behavior.
 */
function normalizePhoneForMatching(value) {
  if (value == null) return null;

  let cleaned = String(value).trim().replace(/[^0-9]/g, '');
  if (!cleaned) return null;

  // Reject obvious fake/placeholder phones from exports (e.g. 000000000, 111111111, 123456789)
  if (/^(\d)\1+$/.test(cleaned)) return null; // All same digits (000..., 111...)
  if (cleaned === '123456789') return null;

  // Require plausible length: Spanish mobiles/fixed are 9 digits. Reject shorts like 8-digit or 6-digit fakes seen in data.
  if (cleaned.length < 9) return null;

  // ROBUST: Always use the last 9 digits for matching Spanish numbers (ignoring prefixes)
  if (cleaned.length >= 9) {
    return cleaned.slice(-9);
  }

  return cleaned || null;
}

function extractPhonesFromSubject(value) {
  const subject = value?.toString().trim() ?? '';
  if (!subject) return [];

  const bracketMatches = [...subject.matchAll(/\[([^\]]+)\]/g)].map((match) => match[1]);
  const sources = bracketMatches.length > 0 ? bracketMatches : [subject];
  const phones = [];

  for (const source of sources) {
    const candidates = source
      .split(/\s+-\s+|[;,]/)
      .flatMap((part) => part.match(/(?:\+|00)?\d[\d\s()./-]{5,}\d/g) ?? []);

    for (const candidate of candidates) {
      const normalized = normalizePhoneForMatching(candidate);
      if (normalized && normalized.length >= 7 && !phones.includes(normalized)) phones.push(normalized);
    }
  }

  return phones;
}

function getPrimaryPhoneFromSubject(value) {
  const phones = extractPhonesFromSubject(value);
  return phones.length > 0 ? phones[0] : null;
}

module.exports = {
  normalizePhoneForMatching,
  extractPhonesFromSubject,
  getPrimaryPhoneFromSubject,
};
