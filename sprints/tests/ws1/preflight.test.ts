import { describe, it, expect, beforeEach, afterEach } from 'vitest';

const PREFLIGHT_MODULE = '../../../packages/brain/src/preflight.js';

describe('Workstream 1 — Initiative Pre-flight Description Length [BEHAVIOR]', () => {
  let preflight: any;
  let savedEnv: string | undefined;

  beforeEach(async () => {
    savedEnv = process.env.INITIATIVE_MIN_DESCRIPTION_LENGTH;
    delete process.env.INITIATIVE_MIN_DESCRIPTION_LENGTH;
    preflight = await import(PREFLIGHT_MODULE);
  });

  afterEach(() => {
    if (savedEnv === undefined) delete process.env.INITIATIVE_MIN_DESCRIPTION_LENGTH;
    else process.env.INITIATIVE_MIN_DESCRIPTION_LENGTH = savedEnv;
  });

  it('returns ok=true when description length equals threshold', () => {
    const desc = 'a'.repeat(60);
    const result = preflight.checkInitiativeDescription(desc);
    expect(result.ok).toBe(true);
  });

  it('returns ok=true when description length exceeds threshold', () => {
    const desc = 'b'.repeat(120);
    const result = preflight.checkInitiativeDescription(desc);
    expect(result.ok).toBe(true);
  });

  it('returns ok=false with actualLength and threshold when description shorter than threshold', () => {
    const result = preflight.checkInitiativeDescription('short');
    expect(result.ok).toBe(false);
    expect(result.actualLength).toBe(5);
    expect(result.threshold).toBe(60);
    expect(typeof result.reason).toBe('string');
    expect(result.reason.length).toBeGreaterThanOrEqual(10);
  });

  it('returns ok=false when description is empty string', () => {
    const result = preflight.checkInitiativeDescription('');
    expect(result.ok).toBe(false);
    expect(result.actualLength).toBe(0);
  });

  it('returns ok=false when description is whitespace-only after trim', () => {
    const result = preflight.checkInitiativeDescription('   \t\n  ');
    expect(result.ok).toBe(false);
    expect(result.actualLength).toBe(0);
  });

  it('returns ok=false when description is null', () => {
    const result = preflight.checkInitiativeDescription(null);
    expect(result.ok).toBe(false);
    expect(result.actualLength).toBe(0);
  });

  it('returns ok=false when description is undefined', () => {
    const result = preflight.checkInitiativeDescription(undefined);
    expect(result.ok).toBe(false);
    expect(result.actualLength).toBe(0);
  });

  it('counts CJK characters as one code point each (60 Chinese chars passes)', () => {
    const desc = '中'.repeat(60);
    const result = preflight.checkInitiativeDescription(desc);
    expect(result.ok).toBe(true);
  });

  it('counts CJK characters as one code point each (59 Chinese chars fails with actualLength=59)', () => {
    const desc = '中'.repeat(59);
    const result = preflight.checkInitiativeDescription(desc);
    expect(result.ok).toBe(false);
    expect(result.actualLength).toBe(59);
  });

  it('counts emoji surrogate pair as one code point each', () => {
    const ok = preflight.checkInitiativeDescription('😀'.repeat(60));
    expect(ok.ok).toBe(true);
    const fail = preflight.checkInitiativeDescription('😀'.repeat(59));
    expect(fail.ok).toBe(false);
    expect(fail.actualLength).toBe(59);
  });

  it('uses options.threshold when provided, overriding env var', () => {
    process.env.INITIATIVE_MIN_DESCRIPTION_LENGTH = '60';
    const passed = preflight.checkInitiativeDescription('hi', { threshold: 2 });
    expect(passed.ok).toBe(true);
    const failed = preflight.checkInitiativeDescription('h', { threshold: 2 });
    expect(failed.ok).toBe(false);
    expect(failed.threshold).toBe(2);
  });

  it('reads INITIATIVE_MIN_DESCRIPTION_LENGTH env var on each call (no caching)', () => {
    process.env.INITIATIVE_MIN_DESCRIPTION_LENGTH = '5';
    expect(preflight.checkInitiativeDescription('hello').ok).toBe(true);
    process.env.INITIATIVE_MIN_DESCRIPTION_LENGTH = '20';
    const r = preflight.checkInitiativeDescription('hello');
    expect(r.ok).toBe(false);
    expect(r.threshold).toBe(20);
  });

  it('falls back to default 60 when env var is missing', () => {
    delete process.env.INITIATIVE_MIN_DESCRIPTION_LENGTH;
    expect(preflight.getMinDescriptionLength()).toBe(60);
    expect(preflight.DEFAULT_MIN_DESCRIPTION_LENGTH).toBe(60);
  });

  it('falls back to default 60 when env var is non-numeric', () => {
    process.env.INITIATIVE_MIN_DESCRIPTION_LENGTH = 'not-a-number';
    expect(preflight.getMinDescriptionLength()).toBe(60);
  });

  it('falls back to default 60 when env var is zero or negative', () => {
    process.env.INITIATIVE_MIN_DESCRIPTION_LENGTH = '0';
    expect(preflight.getMinDescriptionLength()).toBe(60);
    process.env.INITIATIVE_MIN_DESCRIPTION_LENGTH = '-5';
    expect(preflight.getMinDescriptionLength()).toBe(60);
  });

  it('produces identical result for repeated calls with same input (no side-effects)', () => {
    const r1 = preflight.checkInitiativeDescription('short text');
    const r2 = preflight.checkInitiativeDescription('short text');
    expect(r1).toEqual(r2);
  });

  it('buildPreflightFailureResult returns plain object with preflight_failure_reason key', () => {
    const result = preflight.buildPreflightFailureResult('hi');
    expect(result).toHaveProperty('preflight_failure_reason');
    expect(typeof result.preflight_failure_reason).toBe('object');
    expect(result.preflight_failure_reason).not.toBeNull();
  });

  it('preflight_failure_reason includes reason as string of length >= 10', () => {
    const result = preflight.buildPreflightFailureResult('hi');
    const r = result.preflight_failure_reason;
    expect(typeof r.reason).toBe('string');
    expect(r.reason.length).toBeGreaterThanOrEqual(10);
  });

  it('preflight_failure_reason.actualLength is trimmed code-point count', () => {
    const result = preflight.buildPreflightFailureResult('  中文  ');
    expect(result.preflight_failure_reason.actualLength).toBe(2);
  });

  it('preflight_failure_reason.threshold reflects effective threshold (env or option override)', () => {
    process.env.INITIATIVE_MIN_DESCRIPTION_LENGTH = '15';
    const fromEnv = preflight.buildPreflightFailureResult('short');
    expect(fromEnv.preflight_failure_reason.threshold).toBe(15);
    const fromOption = preflight.buildPreflightFailureResult('short', { threshold: 99 });
    expect(fromOption.preflight_failure_reason.threshold).toBe(99);
  });

  it('buildPreflightFailureResult does not throw on null / undefined description', () => {
    expect(() => preflight.buildPreflightFailureResult(null)).not.toThrow();
    expect(() => preflight.buildPreflightFailureResult(undefined)).not.toThrow();
    const r = preflight.buildPreflightFailureResult(null);
    expect(r.preflight_failure_reason.actualLength).toBe(0);
  });
});
