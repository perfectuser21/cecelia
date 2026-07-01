import { readFileSync } from 'node:fs';
import { load } from 'js-yaml';
import { test, expect } from 'vitest';

test('regression-contract 非空且字段齐全', () => {
  const c = load(readFileSync(new URL('../../../regression-contract.yaml', import.meta.url), 'utf8'));
  expect(Array.isArray(c.golden_paths)).toBe(true);
  expect(c.golden_paths.length).toBeGreaterThanOrEqual(1);
  for (const g of c.golden_paths) {
    for (const f of ['id', 'priority', 'trigger', 'method', 'test_command']) {
      expect(g[f]).toBeDefined();
    }
  }
});
