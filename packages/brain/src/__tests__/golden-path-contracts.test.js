import { describe, expect, it } from 'vitest';

import {
  GP_CONTRACT_KEYS,
  GP_CONTRACT_SCHEMA_VERSION,
  hashGoldenPathContract,
  validateGoldenPathContract,
} from '../golden-path-contracts.js';


export const VALID_CONTRACT = {
  fr_summary: {
    statements: ['用户在入口提交后看到成功结果'],
  },
  lifelines_and_nfr: {
    items: [{
      statement: '写入必须唯一',
      class: 'lifeline',
      verification: 'SELECT COUNT(*) = 1',
      rationale: '重复写入即业务失败',
    }],
  },
  yield_order: {
    order: ['安全/资金正确性', '数据一致性', '功能完整', '性能', '体验顺滑'],
    override_reason: null,
  },
  external_commitment_changes: {
    changes: [],
    none: true,
  },
  release_and_blast_radius: {
    stages: ['internal'],
    blast_radius: '单一内部 Journey',
    rollback_triggers: ['错误率 > 1%'],
  },
  success_and_close: {
    metrics: ['成功率 >= 99%'],
    observation_window: '24h',
    close_conditions: ['24h 达标'],
    shutdown_conditions: ['连续 5 分钟错误率 > 1%'],
  },
  budget_guard: {
    total_cost_cap_usd: 10,
    atom_cost_cap_usd: 2,
    atom_runtime_sec: 1800,
    atom_parallelism: 1,
  },
};

function cloneContract() {
  return structuredClone(VALID_CONTRACT);
}

describe('Golden Path contract schema', () => {
  it('accepts exactly the seven frozen business keys', () => {
    expect(GP_CONTRACT_SCHEMA_VERSION).toBe(1);
    expect(GP_CONTRACT_KEYS).toEqual([
      'fr_summary',
      'lifelines_and_nfr',
      'yield_order',
      'external_commitment_changes',
      'release_and_blast_radius',
      'success_and_close',
      'budget_guard',
    ]);
    expect(validateGoldenPathContract(VALID_CONTRACT)).toEqual(VALID_CONTRACT);
  });

  it.each(GP_CONTRACT_KEYS)('rejects missing top-level key %s', (key) => {
    const contract = cloneContract();
    delete contract[key];
    expect(() => validateGoldenPathContract(contract)).toThrow();
  });

  it('rejects an eighth business key', () => {
    expect(() => validateGoldenPathContract({
      ...VALID_CONTRACT,
      risk_tier: { value: 'low' },
    })).toThrow();
  });

  it('rejects empty FR and unsupported NFR classes', () => {
    const emptyFr = cloneContract();
    emptyFr.fr_summary.statements = [];
    expect(() => validateGoldenPathContract(emptyFr)).toThrow();

    const invalidClass = cloneContract();
    invalidClass.lifelines_and_nfr.items[0].class = 'optional';
    expect(() => validateGoldenPathContract(invalidClass)).toThrow();
  });

  it('requires an executable verification for every lifeline', () => {
    const contract = cloneContract();
    contract.lifelines_and_nfr.items[0].verification = '';
    expect(() => validateGoldenPathContract(contract)).toThrow();
  });

  it('requires external-commitment none and changes to agree', () => {
    const contradictoryNone = cloneContract();
    contradictoryNone.external_commitment_changes.changes = ['SLA 变更'];
    expect(() => validateGoldenPathContract(contradictoryNone)).toThrow();

    const missingChange = cloneContract();
    missingChange.external_commitment_changes.none = false;
    expect(() => validateGoldenPathContract(missingChange)).toThrow();
  });

  it('requires a reason when the global yield order is overridden', () => {
    const contract = cloneContract();
    contract.yield_order.order = ['数据一致性', '安全/资金正确性'];
    expect(() => validateGoldenPathContract(contract)).toThrow();

    contract.yield_order.override_reason = '该 GP 不触碰资金，数据恢复优先';
    expect(validateGoldenPathContract(contract)).toEqual(contract);
  });

  it('rejects missing rollback conditions and non-positive budgets', () => {
    const noRollback = cloneContract();
    noRollback.release_and_blast_radius.rollback_triggers = [];
    expect(() => validateGoldenPathContract(noRollback)).toThrow();

    for (const field of [
      'total_cost_cap_usd',
      'atom_cost_cap_usd',
      'atom_runtime_sec',
      'atom_parallelism',
    ]) {
      const contract = cloneContract();
      contract.budget_guard[field] = 0;
      expect(() => validateGoldenPathContract(contract)).toThrow();
    }
  });

  it('hashes recursively reordered JSON identically', () => {
    const reordered = {
      budget_guard: {
        atom_parallelism: 1,
        atom_runtime_sec: 1800,
        atom_cost_cap_usd: 2,
        total_cost_cap_usd: 10,
      },
      success_and_close: VALID_CONTRACT.success_and_close,
      release_and_blast_radius: VALID_CONTRACT.release_and_blast_radius,
      external_commitment_changes: VALID_CONTRACT.external_commitment_changes,
      yield_order: VALID_CONTRACT.yield_order,
      lifelines_and_nfr: {
        items: [{
          rationale: '重复写入即业务失败',
          verification: 'SELECT COUNT(*) = 1',
          class: 'lifeline',
          statement: '写入必须唯一',
        }],
      },
      fr_summary: VALID_CONTRACT.fr_summary,
    };

    expect(hashGoldenPathContract(reordered))
      .toBe(hashGoldenPathContract(VALID_CONTRACT));
  });
});
