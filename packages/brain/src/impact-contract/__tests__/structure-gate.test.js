/**
 * FR-3 Structure Gate 测试
 * 覆盖：三种不可判定情形均拒绝放行、不可判定不等于零影响
 *
 * 单元测试通过注入受控 Mapper fixture 覆盖成功、不可达、过期与 revision 冲突；
 * HTTP 客户端和 PostgreSQL 真闭环由各自集成测试覆盖。
 */

import { describe, test, expect, vi } from 'vitest';

import { evaluateStructureGate } from '../structure-gate.js';

// ---------- 测试 fixtures ----------

const BASE_TASK = {
  id: 'test-task-001',
  change_kind: 'bugfix',
};

const BASE_CONTRACT = {
  task_id: 'test-task-001',
  change_kind: 'bugfix',
  repo: 'cecelia',
  base_revision: 'abc1234abc1234abc1234abc1234abc1234abc12',
  head_revision: 'def5678def5678def5678def5678def5678def56',
  affected_capabilities: [{ capability_id: 'cap-001' }],
  required_assertions: [],
  contract_body: {
    task_id: 'test-task-001',
    change_kind: 'bugfix',
    base_revision: 'abc1234abc1234abc1234abc1234abc1234abc12',
    affected_capabilities: [{ capability_id: 'cap-001' }],
    required_assertions: [],
  },
};

// 模拟 Mapper 正常响应
function makeNormalMapClient() {
  return async ({ repo, baseRevision, headRevision }) => ({
    manifest_digest: 'stub_manifest_digest',
    projection_digest: 'stub_projection_digest',
    fact_revisions: { [repo || 'cecelia']: headRevision || baseRevision || 'stub_revision' },
    freshness: { status: 'fresh', reason_code: null },
    affected_nodes: [],
    required_assertions: [],
  });
}

// 模拟 Mapper 不可达（抛出连接错误）
function makeUnavailableMapClient() {
  return async () => {
    const err = new Error('connect ECONNREFUSED 127.0.0.1:9999');
    err.code = 'ECONNREFUSED';
    throw err;
  };
}

// 模拟 Mapper 返回 stale freshness
function makeStaleFreshnessMapClient() {
  return async ({ repo, baseRevision }) => ({
    manifest_digest: 'stub_manifest_digest',
    projection_digest: 'stub_projection_digest',
    fact_revisions: { [repo || 'cecelia']: baseRevision || 'stub_revision' },
    freshness: { status: 'stale', reason_code: 'ttl_exceeded' },
    affected_nodes: [],
    required_assertions: [],
  });
}

// 模拟 Mapper 返回 revision mismatch（fact_revisions 与合同 base_revision 不同）
function makeRevisionMismatchMapClient() {
  return async ({ repo }) => ({
    manifest_digest: 'stub_manifest_digest',
    projection_digest: 'stub_projection_digest',
    fact_revisions: { [repo || 'cecelia']: 'different_sha_not_matching_contract' },
    freshness: { status: 'fresh', reason_code: null },
    affected_nodes: [],
    required_assertions: [],
  });
}

// ---------- 测试 ----------

describe('FR-3 Structure Gate', () => {

  describe('不可判定情形一：Mapper unavailable', () => {

    test('Mapper 不可达时 Structure Gate 返回失败（不放行）', async () => {
      // 注入连接失败，验证真实门禁的 fail-closed 分支
      const result = await evaluateStructureGate({
        db: null,
        task: BASE_TASK,
        contract: BASE_CONTRACT,
        mapClient: makeUnavailableMapClient(),
      });
      expect(result.gate).toBe('blocked');
    });

    test('Mapper unavailable 响应包含 reason=mapper_unavailable', async () => {
      const result = await evaluateStructureGate({
        db: null,
        task: BASE_TASK,
        contract: BASE_CONTRACT,
        mapClient: makeUnavailableMapClient(),
      });
      expect(result.reason).toBe('mapper_unavailable');
    });

    test('Mapper unavailable 响应包含 retryable=true', async () => {
      const result = await evaluateStructureGate({
        db: null,
        task: BASE_TASK,
        contract: BASE_CONTRACT,
        mapClient: makeUnavailableMapClient(),
      });
      expect(result.retryable).toBe(true);
    });

    test('Mapper unavailable 不产生 impact_scope=[] 的假绿结果', async () => {
      // 关键约束：fail-closed 原则，unavailable ≠ 零影响
      const result = await evaluateStructureGate({
        db: null,
        task: BASE_TASK,
        contract: BASE_CONTRACT,
        mapClient: makeUnavailableMapClient(),
      });
      // 不应返回 2xx，不应放行
      expect(result.gate).not.toBe('pass');
      expect(result.httpStatus >= 400).toBeTruthy();
    });

  });

  describe('不可判定情形二：Mapper stale（freshness 超时）', () => {

    test('Mapper 返回 stale freshness 时 Structure Gate 返回失败', async () => {
      // 注入 freshness 超时标记
      const result = await evaluateStructureGate({
        db: null,
        task: BASE_TASK,
        contract: BASE_CONTRACT,
        mapClient: makeStaleFreshnessMapClient(),
      });
      expect(result.gate).toBe('blocked');
    });

    test('Mapper stale 响应包含 reason=mapper_stale', async () => {
      const result = await evaluateStructureGate({
        db: null,
        task: BASE_TASK,
        contract: BASE_CONTRACT,
        mapClient: makeStaleFreshnessMapClient(),
      });
      expect(result.reason).toBe('mapper_stale');
    });

    test('Mapper stale 响应包含 retryable=true', async () => {
      const result = await evaluateStructureGate({
        db: null,
        task: BASE_TASK,
        contract: BASE_CONTRACT,
        mapClient: makeStaleFreshnessMapClient(),
      });
      expect(result.retryable).toBe(true);
    });

  });

  describe('不可判定情形三：revision mismatch', () => {

    test('fact_revisions 缺少目标 repo 时 Structure Gate fail-closed', async () => {
      const result = await evaluateStructureGate({
        db: null,
        task: BASE_TASK,
        contract: BASE_CONTRACT,
        mapClient: async () => ({
          manifest_digest: 'stub_manifest_digest',
          projection_digest: 'stub_projection_digest',
          fact_revisions: {},
          freshness: { status: 'fresh', reason_code: null },
          affected_nodes: [],
          required_assertions: [],
        }),
      });

      expect(result).toMatchObject({
        gate: 'blocked',
        reason: 'revision_evidence_missing',
        retryable: true,
      });
    });

    test('合同 base_revision 与 HEAD 不匹配时 Structure Gate 返回 409', async () => {
      // 构造：合同中 base_revision = "abc...", Mapper 返回的 fact_revisions 包含不同 revision
      // 使用固定投影事实验证 revision 对账
      const result = await evaluateStructureGate({
        db: null,
        task: BASE_TASK,
        contract: BASE_CONTRACT,
        mapClient: makeRevisionMismatchMapClient(),
      });
      expect(result.httpStatus).toBe(409);
    });

    test('revision mismatch 响应包含 reason=revision_mismatch', async () => {
      const result = await evaluateStructureGate({
        db: null,
        task: BASE_TASK,
        contract: BASE_CONTRACT,
        mapClient: makeRevisionMismatchMapClient(),
      });
      expect(result.reason).toBe('revision_mismatch');
    });

    test('revision mismatch 响应包含 retryable=true', async () => {
      const result = await evaluateStructureGate({
        db: null,
        task: BASE_TASK,
        contract: BASE_CONTRACT,
        mapClient: makeRevisionMismatchMapClient(),
      });
      expect(result.retryable).toBe(true);
    });

  });

  describe('放行条件（正向）', () => {

    test('schema 合法 + Mapper 可达 + freshness 新鲜 + revision 匹配时 Structure Gate 放行', async () => {
      // 注入正常 Mapper 响应
      const result = await evaluateStructureGate({
        db: null,
        task: BASE_TASK,
        contract: BASE_CONTRACT,
        mapClient: makeNormalMapClient(),
      });
      expect(result.gate).toBe('pass');
    });

    test('持久化合同必须固化 Mapper digest、fact revisions 与 freshness', async () => {
      const persistContract = vi.fn(async (_db, input) => ({
        contract: { id: 'contract-1', ...input },
        created: true,
      }));
      const result = await evaluateStructureGate({
        db: {},
        task: BASE_TASK,
        contract: BASE_CONTRACT,
        mapClient: makeNormalMapClient(),
        persistContract,
      });

      expect(result.gate).toBe('pass');
      const input = persistContract.mock.calls[0][1];
      expect(input.manifest_digest).toBe('stub_manifest_digest');
      expect(input.projection_digest).toBe('stub_projection_digest');
      expect(input.contract_body).toMatchObject({
        manifest_digest: 'stub_manifest_digest',
        projection_digest: 'stub_projection_digest',
        freshness_evidence: { status: 'fresh' },
      });
      expect(input.contract_body.fact_revisions).toBeDefined();
    });

  });

  describe('fail-closed 原则兜底', () => {

    test('任何不可判定情形下 gate 结果绝不为 pass', async () => {
      // 遍历三种不可判定情形，验证每种情形的 gate 结果 !== "pass"
      // 三种不可判定场景
      const scenarios = [
        { name: 'unavailable', mapClient: makeUnavailableMapClient() },
        { name: 'stale', mapClient: makeStaleFreshnessMapClient() },
        { name: 'revision_mismatch', mapClient: makeRevisionMismatchMapClient() },
      ];

      for (const scenario of scenarios) {
        const result = await evaluateStructureGate({
          db: null,
          task: BASE_TASK,
          contract: BASE_CONTRACT,
          mapClient: scenario.mapClient,
        });
        expect(result.gate).not.toBe('pass');
      }
    });

  });

});
