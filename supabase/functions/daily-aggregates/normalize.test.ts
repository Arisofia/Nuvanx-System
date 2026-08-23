import { describe, expect, it } from 'vitest';
import { numberInput } from './normalize';

describe('numberInput', () => {
  it('converts valid strings to finite numbers', () => {
    expect(numberInput('123')).toBe(123);
    expect(numberInput('1.25')).toBe(1.25);
    expect(numberInput('-42.5')).toBe(-42.5);
    expect(numberInput('  10  ')).toBe(10);
  });

  it('keeps valid finite numbers as is', () => {
    expect(numberInput(123)).toBe(123);
    expect(numberInput(1.25)).toBe(1.25);
    expect(numberInput(0)).toBe(0);
  });

  it('rejects empty strings and strings with only spaces', () => {
    expect(numberInput('')).toBeUndefined();
    expect(numberInput('   ')).toBeUndefined();
  });

  it('rejects non-numeric strings', () => {
    expect(numberInput('N/A')).toBeUndefined();
    expect(numberInput('foo')).toBeUndefined();
    expect(numberInput('123a')).toBeUndefined();
  });

  it('rejects infinite numbers and strings', () => {
    expect(numberInput(Infinity)).toBeUndefined();
    expect(numberInput(-Infinity)).toBeUndefined();
    expect(numberInput('Infinity')).toBeUndefined();
    expect(numberInput('-Infinity')).toBeUndefined();
    expect(numberInput(NaN)).toBeUndefined();
  });

  it('rejects null and undefined', () => {
    expect(numberInput(null)).toBeUndefined();
    expect(numberInput(undefined)).toBeUndefined();
  });
});
