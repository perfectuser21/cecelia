/**
 * FR-4 Diff Impact Gate 与 drift 仲裁测试
 * 覆盖：实际影响 ⊆ 声明影响放行、新增影响触发 drift、Mapper 异常 fail-closed
 *
 * 策略：
 *   - compareImpactContract（纯函数）→ 直接测试，无需 stub
 *   - evaluateDiffGate（需 DB + mapClient）→ 注入事务客户端与 mock mapClient
 *
 * Mapper 在单元层通过依赖注入构造确定性投影，真实 HTTP 客户端另有回归测试。
 */

import { describe, test, expect, vi } from 'vitest';
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

    test('没有 active contract 时 fail-closed，且不调用 Mapper', async () => {
      const db = { query: vi.fn(async () => ({ rows: [] })) };
      const mapClient = vi.fn();

      const result = await evaluateDiffGate({ db, taskId: 'task-001', mapClient });

      expect(result).toMatchObject({
        gate: 'impact_unknown',
        reason: 'contract_missing',
        retryable: false,
      });
      expect(mapClient).not.toHaveBeenCalled();
    });

  });

  describe('情形二：新增影响有对应断言', () => {

    test('assertion_id 名称相似但无结构化 capability 绑定时仍判 drift', () => {
      const result = compareImpactContract(
        [],
        ['billing'],
        [],
        [{ assertion_id: 'bill', command: 'npm test' }],
      );
      expect(result.verdict).toBe('drift');
    });

    test('新增影响已有断言时 Diff Gate 扩展合同并通过（extend）', async () => {
      // 合同只声明 ['impact-contract']，实际还影响 ['task-routing']
      // 但 actualAssertions 中有覆盖 task-routing 的断言
      const result = compareImpactContract(
        ['impact-contract'],                 // contractNodes
        ['impact-contract', 'task-routing'], // actualNodes（新增 task-routing）
        [],                                  // contractAssertions
        [{
          assertion_id: 'task_routing_works',
          command: 'npm test',
          covers_capability_ids: ['task-routing'],
        }],
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
        [{
          assertion_id: 'task_routing_works',
          command: 'npm test',
          covers_capability_ids: ['task-routing'],
        }],
      );
      expect(result.verdict).toBe('extend');
      // added_assertions 记录了新断言
      expect(result.added_assertions.includes('task_routing_works')).toBeTruthy();
    });

    test('只有 assertion_id 没有可执行 command 不能把新增影响判成已覆盖', () => {
      const result = compareImpactContract(
        ['impact-contract'],
        ['impact-contract', 'task-routing'],
        [],
        ['task_routing_works'],
      );
      expect(result.verdict).toBe('drift');
    });

    test('extend 裁决持久化包含新增节点、断言和最新 digest 的合同版本', async () => {
      const db = {
        query: vi.fn(async (sql) => {
          if (String(sql).includes('FROM harness_impact_contracts')) {
            return {
              rows: [{
                id: 'contract-1',
                repo: 'cecelia',
                change_kind: 'bugfix',
                base_revision: 'base',
                contract_body: {
                  affected_capabilities: [{ capability_id: 'impact-contract' }],
                  required_assertions: [],
                },
              }],
            };
          }
          return { rows: [] };
        }),
      };
      const persistContract = vi.fn(async (_db, input) => ({
        contract: { id: 'contract-2', ...input },
        created: true,
      }));
      const result = await evaluateDiffGate({
        db,
        taskId: 'task-extend',
        repo: 'cecelia',
        headRevision: 'head',
        mapClient: async () => ({
          manifest_digest: 'manifest-2',
          projection_digest: 'projection-2',
          fact_revisions: { cecelia: 'head' },
          freshness: { status: 'fresh' },
          affected_nodes: ['impact-contract', 'task-routing'],
          required_assertions: [{
            assertion_id: 'task_routing_works',
            command: 'npm test',
            covers_capability_ids: ['task-routing'],
          }],
        }),
        persistContract,
      });

      expect(result.gate).toBe('extend');
      expect(persistContract).toHaveBeenCalledOnce();
      const input = persistContract.mock.calls[0][1];
      expect(input.projection_digest).toBe('projection-2');
      expect(input.contract_body.affected_capabilities).toEqual(expect.arrayContaining([
        { capability_id: 'task-routing' },
      ]));
      expect(input.contract_body.required_assertions).toEqual(expect.arrayContaining([
        expect.objectContaining({ assertion_id: 'task_routing_works', command: 'npm test' }),
      ]));
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

    test('drift 写入正式 Gap Ledger 并阻塞真实 tasks 表', async () => {
      const calls = [];
      const db = {
        query: vi.fn(async (sql, params) => {
          const s = String(sql);
          calls.push({ sql: s, params });
          if (s.includes('FROM harness_impact_contracts')) {
            return {
              rows: [{
                id: 'contract-1',
                repo: 'cecelia',
                base_revision: 'base',
                contract_body: {
                  affected_capabilities: [{ capability_id: 'impact-contract' }],
                  required_assertions: [],
                },
              }],
            };
          }
          if (s.includes('INSERT INTO harness_gaps')) {
            return {
              rows: [{
                id: 'gap-1',
                source_task_id: 'task-002',
                impact_node_id: 'tick-loop',
                created_at: new Date(),
                updated_at: new Date(),
              }],
            };
          }
          return { rows: [] };
        }),
      };
      const mapClient = async () => ({
        manifest_digest: 'manifest',
        projection_digest: 'projection',
        freshness: { status: 'fresh' },
        fact_revisions: { cecelia: 'head' },
        affected_nodes: ['impact-contract', 'tick-loop'],
        required_assertions: [],
      });

      const result = await evaluateDiffGate({
        db,
        taskId: 'task-002',
        mapClient,
        headRevision: 'head',
        repo: 'cecelia',
      });

      expect(result.gate).toBe('drift');
      expect(calls.some(({ sql }) => sql.includes('INSERT INTO harness_gaps'))).toBe(true);
      expect(calls.some(({ sql }) => sql.includes('UPDATE tasks') && sql.includes("status = 'blocked'"))).toBe(true);
      const taskBlock = calls.find(({ sql }) => sql.includes('UPDATE tasks') && sql.includes("status = 'blocked'"));
      expect(taskBlock.sql).toContain("blocked_reason = 'contract_impact_drift'");
      expect(calls.some(({ sql }) => sql.includes('harness_tasks'))).toBe(false);
    });

    test('drift 的 Gap Ledger 与任务阻塞必须在同一事务提交', async () => {
      const clientCalls = [];
      const client = {
        query: vi.fn(async (sql) => {
          const statement = String(sql);
          clientCalls.push(statement);
          if (statement.includes('INSERT INTO harness_gaps')) {
            return {
              rows: [{
                id: 'gap-tx',
                source_task_id: 'task-tx',
                impact_node_id: 'tick-loop',
                created: true,
              }],
            };
          }
          return { rows: [] };
        }),
        release: vi.fn(),
      };
      const pool = {
        query: vi.fn(async (sql) => {
          if (String(sql).includes('FROM harness_impact_contracts')) {
            return {
              rows: [{
                id: 'contract-tx',
                repo: 'cecelia',
                base_revision: 'base',
                contract_body: {
                  affected_capabilities: [{ capability_id: 'impact-contract' }],
                  required_assertions: [],
                },
              }],
            };
          }
          return { rows: [] };
        }),
        connect: vi.fn(async () => client),
      };

      const result = await evaluateDiffGate({
        db: pool,
        taskId: 'task-tx',
        repo: 'cecelia',
        headRevision: 'head',
        mapClient: async () => ({
          manifest_digest: 'manifest',
          projection_digest: 'projection',
          freshness: { status: 'fresh' },
          fact_revisions: { cecelia: 'head' },
          affected_nodes: ['impact-contract', 'tick-loop'],
          required_assertions: [],
        }),
      });

      expect(result.gate).toBe('drift');
      expect(clientCalls[0]).toBe('BEGIN');
      expect(clientCalls.at(-1)).toBe('COMMIT');
      expect(clientCalls.some((sql) => sql.includes('INSERT INTO harness_gaps'))).toBe(true);
      expect(clientCalls.some((sql) => sql.includes('UPDATE tasks'))).toBe(true);
      expect(client.release).toHaveBeenCalledOnce();
    });

  });

  describe('fail-closed：Mapper 异常时 Diff Gate 不假绿', () => {

    test('fact_revisions 缺少目标 repo 时返回 impact_unknown', async () => {
      const db = {
        query: vi.fn(async () => ({
          rows: [{
            id: 'contract-1',
            task_id: 'task-001',
            repo: 'cecelia',
            base_revision: 'base',
            contract_body: {
              affected_capabilities: [],
              required_assertions: [],
            },
          }],
        })),
      };
      const result = await evaluateDiffGate({
        db,
        taskId: 'task-001',
        repo: 'cecelia',
        headRevision: 'head',
        mapClient: vi.fn().mockResolvedValue({
          ...makeFreshMapperResult(),
          fact_revisions: {},
        }),
      });

      expect(result).toMatchObject({
        gate: 'impact_unknown',
        reason: 'revision_evidence_missing',
        retryable: true,
      });
    });

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
