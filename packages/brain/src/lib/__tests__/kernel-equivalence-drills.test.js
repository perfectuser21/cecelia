import { readFileSync } from 'node:fs';
import { load } from 'js-yaml';
import { describe, expect, it } from 'vitest';
import {
  compileDrillPlan,
} from '../kernel-equivalence-drills.js';

function rootContract() {
  return load(readFileSync(
    new URL('../../../../../../regression-contract.yaml', import.meta.url),
    'utf8',
  ));
}

function clone(value) {
  return structuredClone(value);
}

function expectDrillError(run, code) {
  expect(run).toThrowError(expect.objectContaining({ code }));
}

describe('compileDrillPlan', () => {
  it('expands eleven canonical descriptors into exactly 99 unique blocked cells', () => {
    const plan = compileDrillPlan(rootContract());

    expect(plan.behavior_count).toBe(11);
    expect(plan.cells).toHaveLength(99);
    expect(new Set(plan.cells.map((cell) => cell.cell_id))).toHaveLength(99);
    expect(new Set(plan.cells.map((cell) => cell.provider))).toEqual(
      new Set(['claude', 'codex', 'grok']),
    );
    expect(new Set(plan.cells.map((cell) => cell.scenario))).toEqual(
      new Set(['normal', 'violation', 'recovery']),
    );
    expect(plan.cells.every((cell) => (
      cell.effect_signer_status === 'missing'
      && cell.blocked_by === 'seam_receipt_signer_missing'
    ))).toBe(true);
  });

  it('rejects a missing scenario instead of compiling a partial matrix', () => {
    const contract = clone(rootContract());
    delete contract.behavior_equivalence.behaviors[0].drill.scenarios.recovery;

    expectDrillError(
      () => compileDrillPlan(contract),
      'drill_scenario_catalog_invalid',
    );
  });

  it('rejects duplicate behavior identities before generating cells', () => {
    const contract = clone(rootContract());
    contract.behavior_equivalence.behaviors[1].behavior_id =
      contract.behavior_equivalence.behaviors[0].behavior_id;

    expectDrillError(
      () => compileDrillPlan(contract),
      'drill_behavior_id_duplicate',
    );
  });

  it.each([
    ['production environment', (drill) => { drill.isolation.environment = 'production'; }],
    ['main ref prefix', (drill) => { drill.isolation.resource_prefix = 'refs/heads/main'; }],
    ['protected ref prefix', (drill) => { drill.isolation.resource_prefix = 'refs/heads/release'; }],
  ])('rejects unsafe default isolation: %s', (_label, mutate) => {
    const contract = clone(rootContract());
    mutate(contract.behavior_equivalence.behaviors[0].drill);

    expectDrillError(
      () => compileDrillPlan(contract),
      'drill_isolation_unsafe',
    );
  });

  it('rejects an available signer without an active effect-receipt key', () => {
    const contract = clone(rootContract());
    contract.behavior_equivalence.behaviors[0].drill.effect_signer_status = 'available';
    contract.behavior_equivalence.behaviors[0].drill.blocked_by = null;

    expectDrillError(
      () => compileDrillPlan(contract),
      'drill_effect_signer_key_missing',
    );
  });
});
