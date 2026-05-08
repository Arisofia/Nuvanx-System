/**
 * Nuvanx — Common utilities and helpers
 */

/**
 * Checks if the current environment is production.
 */
export const isProdEnv = () => import.meta.env.PROD;

/**
 * Standardized logging with clear labels.
 */
export const logger = {
  info: (label: string, message: any) => console.log(`[${label}]`, message),
  error: (label: string, error: any) => console.error(`[${label}] Error:`, error?.message || error),
  warn: (label: string, message: any) => console.warn(`[${label}]`, message),
};

/**
 * Safe numeric conversion.
 */
export function toFiniteNumber(value: unknown, fallback = 0): number {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

/**
 * Checks if a source string is related to Doctoralia.
 */
export function isDoctoraliaSource(source: string | null | undefined): boolean {
  if (!source) return false;
  const s = source.toLowerCase();
  return s.includes('doctoralia');
}

/**
 * Checks if a source string is related to Meta/Instagram/Facebook.
 */
export function isMetaSource(source: string | null | undefined): boolean {
  if (!source) return false;
  const s = source.toLowerCase();
  return s.includes('meta') || s.includes('facebook') || s.includes('instagram');
}
