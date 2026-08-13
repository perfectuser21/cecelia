import { describe, it, expect } from 'vitest';
import { decideF1State, resolveF1Certification } from '../f1-certification.js';

// 纯单测 + 依赖注入（传入 fake db，非 vi.mock 模块）：穷举认证决策分支。
// 真 PG 的落库/聚合正确性由 f1-capability-certification.integration.test.js（nightly）守护，
// 本文件只锁定 decideF1State/resolveF1Certification 的判定逻辑与响应装配。

const SHA = 'a'.repeat(40);
const HASH = '3ade5843bbd84777bd3b1a3bb2cdd0bb6c8da83bf611ce307bb26f169dee15c8';

/**
 * 造一个按 SQL 关键字路由返回预设 rows 的 fake db。
 * @param {{ contract?: any[], cell?: any[], receipt?: any[] }} plan
 */
function fakeDb({ contract = [], cell = [], receipt = [] } = {}) {
  return {
    async query(sql) {
      if (sql.includes('golden_path_contract_versions')) return { rows: contract };
      if (sql.includes('journey_step_links')) return { rows: cell };
      if (sql.includes('journey_assertion_receipts')) return { rows: receipt };
      throw new Error(`unexpected query: ${sql}`);
    },
  };
}

const baseParams = {
  capability: 'F1',
  gp_contract_id: '48ef45ab-83a1-48b7-a4d5-d4afba9ccaf3',
  gp_contract_version: '1',
  gp_contract_hash: HASH,
  journey_id: 'e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29',
  step_id: 'aad25bdb-bdd6-47f4-9a99-e1176e23ac8b',
};

describe('decideF1State — fail-closed 判定顺序', () => {
  it('合同不匹配 → gray/contract_identity_mismatch（最先兜底）', () => {
    expect(decideF1State({ contractMatch: false, featureBound: true, receipt: { verdict: 'PASS', source_sha: SHA }, expectedMergeSha: SHA }))
      .toEqual({ state: 'gray', reason_code: 'contract_identity_mismatch' });
  });
  it('缺 Feature → gray/anchor_target_missing', () => {
    expect(decideF1State({ contractMatch: true, featureBound: false, receipt: null, expectedMergeSha: SHA }))
      .toEqual({ state: 'gray', reason_code: 'anchor_target_missing' });
  });
  it('无 receipt → gray/no_receipt', () => {
    expect(decideF1State({ contractMatch: true, featureBound: true, receipt: null, expectedMergeSha: SHA }))
      .toEqual({ state: 'gray', reason_code: 'no_receipt' });
  });
  it('receipt FAIL → red/receipt_fail', () => {
    expect(decideF1State({ contractMatch: true, featureBound: true, receipt: { verdict: 'FAIL', source_sha: SHA }, expectedMergeSha: SHA }))
      .toEqual({ state: 'red', reason_code: 'receipt_fail' });
  });
  it('PASS 但缺 expected_merge_sha → unknown/revision_mismatch', () => {
    expect(decideF1State({ contractMatch: true, featureBound: true, receipt: { verdict: 'PASS', source_sha: SHA }, expectedMergeSha: null }))
      .toEqual({ state: 'unknown', reason_code: 'revision_mismatch' });
  });
  it('PASS 但 SHA 不一致 → unknown/revision_mismatch', () => {
    expect(decideF1State({ contractMatch: true, featureBound: true, receipt: { verdict: 'PASS', source_sha: SHA }, expectedMergeSha: 'b'.repeat(40) }))
      .toEqual({ state: 'unknown', reason_code: 'revision_mismatch' });
  });
  it('PASS 且 SHA 一致 → green/pass_current_revision', () => {
    expect(decideF1State({ contractMatch: true, featureBound: true, receipt: { verdict: 'PASS', source_sha: SHA }, expectedMergeSha: SHA }))
      .toEqual({ state: 'green', reason_code: 'pass_current_revision' });
  });
});

describe('resolveF1Certification — 读回装配（依赖注入 fake db）', () => {
  it('receipt 查询必须锁定同一 GP Contract id/hash，不能消费别的验收回执', async () => {
    let receiptQuery = null;
    const db = {
      async query(sql, params) {
        if (sql.includes('golden_path_contract_versions')) return { rows: [{ id: baseParams.gp_contract_id }] };
        if (sql.includes('journey_step_links')) return { rows: [{ id: 'cell-1' }] };
        if (sql.includes('journey_assertion_receipts')) {
          receiptQuery = { sql, params };
          return { rows: [] };
        }
        throw new Error(`unexpected query: ${sql}`);
      },
    };

    await resolveF1Certification(db, { ...baseParams, expected_merge_sha: SHA });

    expect(receiptQuery.sql).toMatch(/gp_contract_id\s*=\s*\$2/);
    expect(receiptQuery.sql).toMatch(/gp_contract_hash\s*=\s*\$3/);
    expect(receiptQuery.params).toEqual(['cell-1', baseParams.gp_contract_id, HASH]);
  });

  it('green：回显冻结身份 + receipt_id + merge_sha，synthetic 恒 false', async () => {
    const db = fakeDb({
      contract: [{ id: baseParams.gp_contract_id }],
      cell: [{ id: 'cell-1' }],
      receipt: [{ id: 'receipt-1', verdict: 'PASS', source_sha: SHA }],
    });
    const body = await resolveF1Certification(db, { ...baseParams, expected_merge_sha: SHA });
    expect(body).toMatchObject({
      capability: 'F1',
      state: 'green',
      reason_code: 'pass_current_revision',
      gp_contract_version: 1,
      gp_contract_hash: HASH,
      receipt_id: 'receipt-1',
      merge_sha: SHA,
      synthetic: false,
    });
  });

  it('no_contract：contract 未命中 → 不查 cell，gray + receipt_id=null', async () => {
    const db = fakeDb({ contract: [] });
    const body = await resolveF1Certification(db, { ...baseParams, expected_merge_sha: SHA });
    expect(body.state).toBe('gray');
    expect(body.reason_code).toBe('contract_identity_mismatch');
    expect(body.receipt_id).toBeNull();
    expect(body.merge_sha).toBeNull();
  });

  it('missing_feature：cell 无绑定 → anchor_target_missing', async () => {
    const db = fakeDb({ contract: [{ id: baseParams.gp_contract_id }], cell: [] });
    const body = await resolveF1Certification(db, { ...baseParams, expected_merge_sha: SHA });
    expect(body.state).toBe('gray');
    expect(body.reason_code).toBe('anchor_target_missing');
  });

  it('wrong_sha：receipt source_sha≠expected → unknown/revision_mismatch', async () => {
    const db = fakeDb({
      contract: [{ id: baseParams.gp_contract_id }],
      cell: [{ id: 'cell-1' }],
      receipt: [{ id: 'r', verdict: 'PASS', source_sha: 'c'.repeat(40) }],
    });
    const body = await resolveF1Certification(db, { ...baseParams, expected_merge_sha: SHA });
    expect(body.state).toBe('unknown');
    expect(body.reason_code).toBe('revision_mismatch');
    expect(body.receipt_id).toBeNull();
  });
});
