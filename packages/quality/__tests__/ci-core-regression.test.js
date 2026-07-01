import { readFileSync } from 'node:fs';
import { test, expect } from 'vitest';

const ci = readFileSync(new URL('../../../.github/workflows/ci.yml', import.meta.url), 'utf8');

test('core-regression 无 workspace 路径门', () => {
  const m = ci.match(/\n {2}core-regression:[\s\S]*?(?=\n {2}\w)/);
  expect(m).not.toBeNull();
  expect(m[0]).not.toMatch(/needs\.changes\.outputs\.workspace/);
  expect(m[0]).toMatch(/refs\/heads\/main/);
});

test('假绿灯 regression-smoke 已删', () => {
  expect(ci).not.toMatch(/golden-smoke\.test\.ts/);
});
