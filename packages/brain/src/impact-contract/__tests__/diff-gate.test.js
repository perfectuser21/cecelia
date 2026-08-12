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
function makeFreshMapperResult({ affectedNodes = [], requiredAssertions = [], baseRevision } = {}) {
  const result = {
    freshness: { status: 'fresh' },
    affected_nodes: affectedNodes,
    required_assertions: requiredAssertions,
  };
  if (baseRevision) {
    result.fact_revisions = { 'cecelia': baseRevision };
  }
  return result;
}

describe('FR-4 Diff Impact Gate', () => {

  describe('情形一：实际影响 ⊆ 声明影响', () => {

    test('实际影响完全被声明且被可执行断言覆盖时 Diff Gate 通过（pass）', async () => {
      // 合同声明 ['impact-contract', 'task-routing']，实际只影响 ['impact-contract']
      const assertion = {
        assertion_id: 'impact-contract.test.js',
        command: 'npm test',
        covers_capability_ids: ['impact-contract'],
      };
      const result = compareImpactContract(
        ['impact-contract', 'task-routing'], // contractNodes
        ['impact-contract'],                 // actualNodes（⊆ 合同）
        [assertion],                         // contractAssertions
        [assertion],                         // actualAssertions
      );
      expect(result.verdict).toBe('pass');
      expect(result.added_nodes).toEqual([]);
      expect(result.reason_code).toBe(null);
    });

    test('影响缩小时，仅覆盖已移除节点的合同断言不制造假 drift', () => {
      const retainedAssertion = {
        assertion_id: 'impact-contract.test.js',
        command: 'npm test',
        covers_capability_ids: ['impact-contract'],
      };
      const result = compareImpactContract(
        ['impact-contract', 'task-routing'],
        ['impact-contract'],
        [retainedAssertion, {
          assertion_id: 'task-routing.test.js',
          command: 'npm test',
          covers_capability_ids: ['task-routing'],
        }],
        [retainedAssertion],
      );

      expect(result.verdict).toBe('pass');
      expect(result.removed_nodes).toEqual(['task-routing']);
      expect(result.removed_assertions).toEqual([]);
    });

    test('已有受影响 Capability 没有任何可执行断言时也必须 drift', () => {
      const result = compareImpactContract(
        ['impact-contract'],
        ['impact-contract'],
        [],
        [],
      );

      expect(result).toMatchObject({
        verdict: 'drift',
        reason_code: 'CONTRACT_IMPACT_DRIFT',
        drift_nodes: ['impact-contract'],
      });
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
      const existingAssertion = {
        assertion_id: 'impact_contract_works',
        command: 'npm test',
        covers_capability_ids: ['impact-contract'],
      };
      const result = compareImpactContract(
        ['impact-contract'],                 // contractNodes
        ['impact-contract', 'task-routing'], // actualNodes（新增 task-routing）
        [existingAssertion],                 // contractAssertions
        [existingAssertion, {
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
      const existingAssertion = {
        assertion_id: 'impact_contract_works',
        command: 'npm test',
        covers_capability_ids: ['impact-contract'],
      };
      const result = compareImpactContract(
        ['impact-contract'],
        ['impact-contract', 'task-routing'],
        [existingAssertion],
        [existingAssertion, {
          assertion_id: 'task_routing_works',
          command: 'npm test',
          covers_capability_ids: ['task-routing'],
        }],
      );
      expect(result.verdict).toBe('extend');
      // added_assertions 记录了新断言
      expect(result.added_assertions.includes('task_routing_works')).toBeTruthy();
    });

    test('同一 assertion_ref 的 Journey revision 漂移也必须 extend', () => {
      const baseAssertion = {
        assertion_id: 'packages/brain/src/example.test.js',
        command: 'npx vitest run packages/brain/src/example.test.js',
        covers_capability_ids: ['impact-contract'],
        journey_step_link_id: '11111111-1111-4111-8111-111111111111',
        assertion_revision: 1,
        assertion_digest: 'a'.repeat(64),
      };
      const result = compareImpactContract(
        ['impact-contract'],
        ['impact-contract'],
        [baseAssertion],
        [{ ...baseAssertion, assertion_revision: 2 }],
      );

      expect(result.verdict).toBe('extend');
      expect(result.changed_assertions).toEqual(['packages/brain/src/example.test.js']);
    });

    test('节点不变但 Mapper 新增断言时也必须刷新合同', () => {
      const assertion = {
        assertion_id: 'packages/brain/src/example.test.js',
        command: 'npx vitest run packages/brain/src/example.test.js',
        covers_capability_ids: ['impact-contract'],
        journey_step_link_id: '11111111-1111-4111-8111-111111111111',
        assertion_revision: 1,
        assertion_digest: 'a'.repeat(64),
      };
      const result = compareImpactContract(
        ['impact-contract'], ['impact-contract'], [], [assertion],
      );

      expect(result.verdict).toBe('extend');
      expect(result.added_assertions).toEqual([assertion.assertion_id]);
    });

    test('Mapper 移除合同断言时必须 drift，不能保留旧合同后假 pass', () => {
      const assertion = {
        assertion_id: 'packages/brain/src/example.test.js', command: 'npm test',
        covers_capability_ids: ['impact-contract'],
      };
      const result = compareImpactContract(
        ['impact-contract'], ['impact-contract'], [assertion], [],
      );

      expect(result.verdict).toBe('drift');
      expect(result.removed_assertions).toEqual([assertion.assertion_id]);
      expect(result.drift_nodes).toEqual(['impact-contract']);
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
      const existingAssertion = {
        assertion_id: 'impact_contract_works',
        command: 'npm test',
        covers_capability_ids: ['impact-contract'],
      };
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
                  required_assertions: [existingAssertion],
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
          fact_revisions: { cecelia: 'base' },
          freshness: { status: 'fresh' },
          affected_nodes: ['impact-contract', 'task-routing'],
          required_assertions: [existingAssertion, {
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

    test('只有 assertion revision 更新时仍持久化 Mapper 最新合同', async () => {
      const oldAssertion = {
        assertion_id: 'packages/brain/src/example.test.js',
        command: 'npx vitest run packages/brain/src/example.test.js',
        covers_capability_ids: ['impact-contract'],
        journey_step_link_id: '11111111-1111-4111-8111-111111111111',
        assertion_revision: 1,
        assertion_digest: 'a'.repeat(64),
      };
      const db = { query: vi.fn(async () => ({ rows: [{
        id: 'contract-old', repo: 'cecelia', change_kind: 'bugfix', base_revision: 'base',
        contract_body: {
          affected_capabilities: [{ capability_id: 'impact-contract' }],
          required_assertions: [oldAssertion],
        },
      }] })) };
      const persistContract = vi.fn(async (_db, input) => ({
        contract: { id: 'contract-new', contract_body: input.contract_body }, created: true,
      }));
      const result = await evaluateDiffGate({
        db, taskId: 'task-revision', repo: 'cecelia', headRevision: 'head', persistContract,
        mapClient: async () => ({
          manifest_digest: '1'.repeat(64), projection_digest: '2'.repeat(64),
          fact_revisions: { cecelia: 'base' }, freshness: { status: 'fresh' },
          affected_nodes: [{ capability_id: 'impact-contract' }],
          required_assertions: [{ ...oldAssertion, assertion_revision: 2 }],
        }),
      });

      expect(result.gate).toBe('extend');
      expect(persistContract).toHaveBeenCalledOnce();
      expect(persistContract.mock.calls[0][1].contract_body.required_assertions[0])
        .toMatchObject({ assertion_revision: 2 });
      expect(result.required_assertions[0]).toMatchObject({ assertion_revision: 2 });
    });

    test('同一 base revision 的 projection digest 漂移时刷新合同版本', async () => {
      const db = { query: vi.fn(async () => ({ rows: [{
        id: 'contract-old', repo: 'cecelia', change_kind: 'bugfix', base_revision: 'base',
        manifest_digest: '1'.repeat(64), projection_digest: '2'.repeat(64),
        contract_body: { affected_capabilities: [{ capability_id: 'impact-contract' }], required_assertions: [] },
      }] })) };
      const persistContract = vi.fn(async (_db, input) => ({
        contract: { id: 'contract-new', contract_body: input.contract_body }, created: true,
      }));
      const mapClient = vi.fn(async () => ({
        manifest_digest: '3'.repeat(64), projection_digest: '4'.repeat(64),
        fact_revisions: { cecelia: 'base' }, freshness: { status: 'fresh' },
        affected_nodes: [{ capability_id: 'impact-contract' }], required_assertions: [],
      }));
      const result = await evaluateDiffGate({
        db, taskId: 'task-digest', repo: 'cecelia', headRevision: 'head', mapClient, persistContract,
      });

      expect(mapClient).toHaveBeenCalledWith(expect.objectContaining({
        manifestDigest: '1'.repeat(64), projectionDigest: '2'.repeat(64),
      }));
      expect(result).toMatchObject({
        gate: 'impact_unknown', reason: 'manifest_digest_mismatch', retryable: true,
      });
      expect(persistContract).not.toHaveBeenCalled();
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
        fact_revisions: { cecelia: 'base' },
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
      expect(taskBlock.sql.match(/blocked_reason\s*=/g)).toHaveLength(1);
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
          fact_revisions: { cecelia: 'base' },
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
        // fact_revisions 与合同 base_revision 不对齐
        fact_revisions: { 'cecelia': 'stale999' },
      });

      const result = await evaluateDiffGate({
        db: { query: vi.fn(async () => ({ rows: [{
          id: 'contract-revision', repo: 'cecelia', base_revision: 'base123',
          contract_body: { affected_capabilities: [], required_assertions: [] },
        }] })) },
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
