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

test('regression-contract owns the complete Kernel behavior-equivalence inventory', () => {
  const c = load(readFileSync(new URL('../../../regression-contract.yaml', import.meta.url), 'utf8'));
  const section = c.behavior_equivalence;
  const expectedSteps = Array.from({ length: 13 }, (_, index) => `S${index}`);
  const expectedDimensions = [
    'fr',
    'nfr',
    'invariant',
    'checkpoint',
    'freshness',
    'death_alert',
    'failure_semantics',
    'effect_confirmation',
    'adversarial_surface',
    'ledger_freshness',
    'axis_alignment',
  ];
  const expectedProviders = ['claude', 'codex', 'grok'];
  const expectedScenarios = ['normal', 'violation', 'recovery'];
  const assertionIds = new Set(c.golden_paths.map((path) => path.id));

  expect(section).toBeDefined();
  expect(section.journey.steps.map((step) => step.id)).toEqual(expectedSteps);
  expect(section.dimensions).toEqual(expectedDimensions);
  expect(section.behaviors.length).toBeGreaterThanOrEqual(11);
  expect(new Set(section.behaviors.map((behavior) => behavior.priority))).toEqual(
    new Set(['P0', 'P1']),
  );

  for (const behavior of section.behaviors) {
    expect(['proven', 'gap', 'intentional_replacement']).toContain(behavior.status);
    expect(assertionIds.has(behavior.assertion_id)).toBe(true);
    expect(behavior.steps.length).toBeGreaterThan(0);
    expect(behavior.dimensions.length).toBeGreaterThan(0);
    expect(behavior.legacy_evidence.length).toBeGreaterThan(0);
    expect(behavior.unified_constructs.length).toBeGreaterThan(0);

    for (const provider of expectedProviders) {
      expect(behavior.proof_matrix[provider]).toBeDefined();
      for (const scenario of expectedScenarios) {
        expect(behavior.proof_matrix[provider][scenario]).toBeDefined();
      }
    }
  }
});
