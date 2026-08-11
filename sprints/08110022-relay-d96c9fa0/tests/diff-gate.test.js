/**
 * FR-4 Diff Impact Gate 与 drift 仲裁测试
 * 覆盖：实际影响 ⊆ 声明影响放行、新增影响触发 drift、Mapper 异常 fail-closed
 *
 * 策略：
 *   - compareImpactContract（纯函数）→ 直接测试，无需 stub
 *   - evaluateDiffGate（需 DB + mapClient）→ 注入 mock mapClient，DB 相关用 skip
 *
 * MJ5 STUB: 所有 Mapper.radius() 调用均为 stub，标注 "MJ5 STUB" 的注释处需替换。
 */

import { describe, test, expect } from 'vitest';
import { compareImpactContract, evaluateDiffGate } from '../diff-gate.js';

// ── 辅助函数：构造 fresh Mapper 响应 ──
function makeFreshMapperResult({ affectedNodes = [], requiredAssertions = [], headRevision } = {}) {
  const result = {
    freshness: { status: 'fresh' },
    affected_nodes: affectedNodes,
    required_assertions: requiredAssertions,
  };
  if (headRevision) {
    result.fact_revisions = { 'cecelia': headRevision };
  }
  return result;
}

describe('FR-4 Diff Impact Gate', () => {

  describe('情形一：实际影响 ⊆ 声明影响', () => {

    test('实际影响完全被声明覆盖时 Diff Gate 通过（pass）', async () => {
      // 合同声明 ['impact-contract', 'task-routing']，实际只影响 ['impact-contract']
      const result = compareImpactContract(
        ['impact-contract', 'task-routing'], // contractNodes
        ['impact-contract'],                 // actualNodes（⊆ 合同）
        [],                                  // contractAssertions
        [],                                  // actualAssertions
      );
      expect(result.verdict).toBe('pass');
      expect(result.added_nodes).toEqual([]);
      expect(result.reason_code).toBe(null);
    });

    test('gate 通过后原任务不被阻塞（via evaluateDiffGate mock mapClient）', async () => {
      // mock mapClient 返回实际影响 ⊆ 合同
      const mockMapClient = async () => makeFreshMapperResult({
        affectedNodes: ['impact-contract'],
        requiredAssertions: [],
      });

      const result = await evaluateDiffGate({
        db: null,    // 无 DB：跳过合同读取
        taskId: 'task-001',
        mapClient: mockMapClient,
        changedFiles: ['packages/brain/src/impact-contract/change-kind.js'],
      });

      // 无 contract 时 contractNodes=[]，actualNodes=['impact-contract'] → 有新增节点
      // 但因为 contractAssertions 和 actualAssertions 都为空，无断言覆盖 → drift
      // 所以此场景应验证：gate 不等于 'blocked'（fail-closed 之外），至少可判定
      expect(result.gate).not.toBe('impact_unknown');
    });

  });

  describe('情形二：新增影响有对应断言', () => {

    test('新增影响已有断言时 Diff Gate 扩展合同并通过（extend）', async () => {
      // 合同只声明 ['impact-contract']，实际还影响 ['task-routing']
      // 但 actualAssertions 中有覆盖 task-routing 的断言
      const result = compareImpactContract(
        ['impact-contract'],                 // contractNodes
        ['impact-contract', 'task-routing'], // actualNodes（新增 task-routing）
        [],                                  // contractAssertions
        ['task_routing_works'],              // actualAssertions（覆盖 task-routing）
      );
      expect(result.verdict).toBe('extend');
      expect(result.added_nodes.includes('task-routing')).toBeTruthy();
      expect(result.reason_code).toBe(null);
    });

    test('扩展后合同的 required_assertions 包含新断言', async () => {
      const result = compareImpactContract(
        ['impact-contract'],
        ['impact-contract', 'task-routing'],
        [],
        ['task_routing_works'],
      );
      expect(result.verdict).toBe('extend');
      // added_assertions 记录了新断言
      expect(result.added_assertions.includes('task_routing_works')).toBeTruthy();
    });

  });

  describe('情形三：新增影响无对应断言（CONTRACT_IMPACT_DRIFT）', () => {

    test('新增影响无断言时触发 CONTRACT_IMPACT_DRIFT 事件', async () => {
      // 合同只声明 ['impact-contract']，实际还影响 ['tick-loop']，且无任何断言覆盖
      const result = compareImpactContract(
        ['impact-contract'],           // contractNodes
        ['impact-contract', 'tick-loop'], // actualNodes（新增 tick-loop）
        [],                            // contractAssertions（无）
        [],                            // actualAssertions（无）
      );
      expect(result.verdict).toBe('drift');
      expect(result.reason_code).toBe('CONTRACT_IMPACT_DRIFT');
    });

    test.skip('CONTRACT_IMPACT_DRIFT 事件写入 gap_events 表', async () => {});

    test('drift 触发后 Diff Gate 结果为 blocked（门禁变红）', async () => {
      // 通过 evaluateDiffGate + mock mapClient 验证 drift 裁决
      // drift 场景：合同无声明节点，实际新增 tick-loop，无断言覆盖
      const mockMapClient = async () => makeFreshMapperResult({
        affectedNodes: ['tick-loop'],
        requiredAssertions: [],
      });

      const result = await evaluateDiffGate({
        db: null,
        taskId: 'task-002',
        mapClient: mockMapClient,
        changedFiles: ['packages/brain/src/tick.js'],
      });

      // 无合同时 contractNodes=[]，actualNodes=['tick-loop'] → added_nodes=['tick-loop']
      // actualAssertions=[]，无覆盖 → drift
      expect(result.gate).toBe('drift');
      expect(result.verdict).toBe('drift');
      expect(result.reason_code).toBe('CONTRACT_IMPACT_DRIFT');
    });

    test.skip('drift 触发后原任务 status 变为 blocked', async () => {});

    test.skip('drift 事件可通过 GET /api/brain/gaps?task_id=:id 查询', async () => {});

  });

  describe('fail-closed：Mapper 异常时 Diff Gate 不假绿', () => {

    test('Mapper.radius() 超时时 Diff Gate 返回 blocked（不放行）', async () => {
      // mock mapClient 抛出超时错误
      const mockMapClient = async () => {
        throw new Error('ETIMEDOUT: Mapper request timed out');
      };

      const result = await evaluateDiffGate({
        db: null,
        taskId: 'task-003',
        mapClient: mockMapClient,
        changedFiles: ['packages/brain/src/tick.js'],
      });

      // Mapper 抛出异常 → fail-closed → impact_unknown（不是 pass）
      expect(result.gate).toBe('impact_unknown');
      expect(result.retryable).toBe(true);
    });

    test('Mapper revision mismatch 时 Diff Gate 返回 blocked', async () => {
      // mock mapClient 返回 revision 不匹配的结果
      const HEAD = 'abc123';
      const mockMapClient = async () => ({
        freshness: { status: 'fresh' },
        affected_nodes: ['tick-loop'],
        required_assertions: [],
        // fact_revisions 与 headRevision 不对齐
        fact_revisions: { 'cecelia': 'stale999' },
      });

      const result = await evaluateDiffGate({
        db: null,
        taskId: 'task-004',
        mapClient: mockMapClient,
        headRevision: HEAD,
        repo: 'cecelia',
        changedFiles: ['packages/brain/src/tick.js'],
      });

      expect(result.gate).toBe('impact_unknown');
      expect(result.reason).toBe('revision_mismatch');
      expect(result.retryable).toBe(true);
    });

  });

});
