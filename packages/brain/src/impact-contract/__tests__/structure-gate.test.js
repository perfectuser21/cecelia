/**
 * FR-3 Structure Gate 测试
 * 覆盖：三种不可判定情形均拒绝放行、不可判定不等于零影响
 *
 * MJ5 STUB 说明：
 *   本文件中所有 Mapper 调用均使用受控 stub，stub 位置以注释标注。
 *   MJ5 合同（/api/brain/map/radius + projection_digest + freshness）
 *   通过真实环境验收后，将 stub 替换为真实 Mapper 调用。
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

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

// MJ5 STUB: replace with real Mapper call after MJ5 contract passes
// stub：模拟 Mapper 正常响应
function makeNormalMapClient() {
  return async ({ repo, baseRevision }) => ({
    manifest_digest: 'stub_manifest_digest',
    projection_digest: 'stub_projection_digest',
    fact_revisions: { [repo || 'cecelia']: baseRevision || 'stub_revision' },
    freshness: { status: 'fresh', reason_code: null },
    affected_nodes: [],
    required_assertions: [],
  });
}

// MJ5 STUB: replace with real Mapper call after MJ5 contract passes
// stub：模拟 Mapper 不可达（抛出连接错误）
function makeUnavailableMapClient() {
  return async () => {
    const err = new Error('connect ECONNREFUSED 127.0.0.1:9999');
    err.code = 'ECONNREFUSED';
    throw err;
  };
}

// MJ5 STUB: replace with real Mapper call after MJ5 contract passes
// stub：模拟 Mapper 返回 stale freshness
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

// MJ5 STUB: replace with real Mapper call after MJ5 contract passes
// stub：模拟 Mapper 返回 revision mismatch（fact_revisions 与合同 base_revision 不同）
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
      // MJ5 STUB: mock Mapper 返回 connection refused
      // 替换条件：MJ5 合同通过后换为真实 Mapper 调用
      const result = await evaluateStructureGate({
        db: null,
        task: BASE_TASK,
        contract: BASE_CONTRACT,
        mapClient: makeUnavailableMapClient(),
      });
      assert.equal(result.gate, 'blocked', '不可达时 gate 应为 blocked，不放行');
    });

    test('Mapper unavailable 响应包含 reason=mapper_unavailable', async () => {
      // MJ5 STUB: 同上
      const result = await evaluateStructureGate({
        db: null,
        task: BASE_TASK,
        contract: BASE_CONTRACT,
        mapClient: makeUnavailableMapClient(),
      });
      assert.equal(result.reason, 'mapper_unavailable', 'reason 应为 mapper_unavailable');
    });

    test('Mapper unavailable 响应包含 retryable=true', async () => {
      // MJ5 STUB: 同上
      const result = await evaluateStructureGate({
        db: null,
        task: BASE_TASK,
        contract: BASE_CONTRACT,
        mapClient: makeUnavailableMapClient(),
      });
      assert.equal(result.retryable, true, 'retryable 应为 true');
    });

    test('Mapper unavailable 不产生 impact_scope=[] 的假绿结果', async () => {
      // 关键约束：fail-closed 原则，unavailable ≠ 零影响
      // MJ5 STUB: 同上
      const result = await evaluateStructureGate({
        db: null,
        task: BASE_TASK,
        contract: BASE_CONTRACT,
        mapClient: makeUnavailableMapClient(),
      });
      // 不应返回 2xx，不应放行
      assert.notEqual(result.gate, 'pass', 'unavailable 绝不放行（假绿）');
      assert(result.httpStatus >= 400, `httpStatus 应为 4xx/5xx，实际得到 ${result.httpStatus}`);
    });

  });

  describe('不可判定情形二：Mapper stale（freshness 超时）', () => {

    test('Mapper 返回 stale freshness 时 Structure Gate 返回失败', async () => {
      // MJ5 STUB: mock Mapper 返回 freshness 超时标记
      // 替换条件：MJ5 freshness fail-closed 合同通过后换为真实检查
      const result = await evaluateStructureGate({
        db: null,
        task: BASE_TASK,
        contract: BASE_CONTRACT,
        mapClient: makeStaleFreshnessMapClient(),
      });
      assert.equal(result.gate, 'blocked', 'stale 时 gate 应为 blocked');
    });

    test('Mapper stale 响应包含 reason=mapper_stale', async () => {
      // MJ5 STUB: 同上
      const result = await evaluateStructureGate({
        db: null,
        task: BASE_TASK,
        contract: BASE_CONTRACT,
        mapClient: makeStaleFreshnessMapClient(),
      });
      assert.equal(result.reason, 'mapper_stale', 'reason 应为 mapper_stale');
    });

    test('Mapper stale 响应包含 retryable=true', async () => {
      // MJ5 STUB: 同上
      const result = await evaluateStructureGate({
        db: null,
        task: BASE_TASK,
        contract: BASE_CONTRACT,
        mapClient: makeStaleFreshnessMapClient(),
      });
      assert.equal(result.retryable, true, 'retryable 应为 true');
    });

  });

  describe('不可判定情形三：revision mismatch', () => {

    test('合同 base_revision 与 HEAD 不匹配时 Structure Gate 返回 409', async () => {
      // 构造：合同中 base_revision = "abc...", Mapper 返回的 fact_revisions 包含不同 revision
      // MJ5 STUB: revision 检查使用固定 fixture，MJ5 后接入真实 HEAD
      const result = await evaluateStructureGate({
        db: null,
        task: BASE_TASK,
        contract: BASE_CONTRACT,
        mapClient: makeRevisionMismatchMapClient(),
      });
      assert.equal(result.httpStatus, 409, `httpStatus 应为 409，实际得到 ${result.httpStatus}`);
    });

    test('revision mismatch 响应包含 reason=revision_mismatch', async () => {
      // MJ5 STUB: 同上
      const result = await evaluateStructureGate({
        db: null,
        task: BASE_TASK,
        contract: BASE_CONTRACT,
        mapClient: makeRevisionMismatchMapClient(),
      });
      assert.equal(result.reason, 'revision_mismatch', 'reason 应为 revision_mismatch');
    });

    test('revision mismatch 响应包含 retryable=true', async () => {
      // MJ5 STUB: 同上
      const result = await evaluateStructureGate({
        db: null,
        task: BASE_TASK,
        contract: BASE_CONTRACT,
        mapClient: makeRevisionMismatchMapClient(),
      });
      assert.equal(result.retryable, true, 'retryable 应为 true');
    });

  });

  describe('放行条件（正向）', () => {

    test('schema 合法 + Mapper 可达 + freshness 新鲜 + revision 匹配时 Structure Gate 放行', async () => {
      // MJ5 STUB: mock Mapper 返回正常响应
      const result = await evaluateStructureGate({
        db: null,
        task: BASE_TASK,
        contract: BASE_CONTRACT,
        mapClient: makeNormalMapClient(),
      });
      assert.equal(result.gate, 'pass', 'schema 合法且 Mapper 正常时应放行');
    });

  });

  describe('fail-closed 原则兜底', () => {

    test('任何不可判定情形下 gate 结果绝不为 pass', async () => {
      // 遍历三种不可判定情形，验证每种情形的 gate 结果 !== "pass"
      // MJ5 STUB: 三种 stub 场景
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
        assert.notEqual(
          result.gate,
          'pass',
          `场景 ${scenario.name}：gate 绝不应为 pass（fail-closed 原则）`
        );
      }
    });

  });

});
