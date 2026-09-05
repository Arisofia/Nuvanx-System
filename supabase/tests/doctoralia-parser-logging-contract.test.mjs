import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const parser = readFileSync('scripts/populate-doctoralia-appointments.js', 'utf8');

describe('Doctoralia read-only parser logging boundary', () => {
  it('keeps the canonical sheet code-owned instead of environment-selected', () => {
    expect(parser).toContain('const SHEET_NAME = DEFAULT_SHEET;');
    expect(parser).not.toContain('process.env.DOCTORALIA_APPOINTMENTS_SHEET_NAME || DEFAULT_SHEET');
  });

  it('does not place environment-derived paths or exception messages into logs', () => {
    expect(parser).toContain("throw new Error('Doctoralia appointments input file not found')");
    expect(parser).toContain("throw new Error('Canonical Doctoralia sheet not found')");
    expect(parser).toContain("console.error('[doctoralia-appointments] Fatal error; parser aborted.');");
    expect(parser).not.toMatch(/console\.error\([^\n]*error\.message/);
    expect(parser).not.toContain('Doctoralia appointments input not found: ${INPUT_PATH}');
  });
});
