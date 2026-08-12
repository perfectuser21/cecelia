/**
 * FR-5 Gap Ledger 测试
 * 覆盖：Gap 状态机单向流转、幂等去重、状态机纯逻辑验证
 *
 * 单元层通过数据库 fixture 验证 SQL 与状态机，真实 PostgreSQL 闭环由集成测试覆盖。
 *
 * sprint: 08110022-relay-d96c9fa0 ws5
 */

import { createHash } from 'node:crypto';
import { describe, test, expect, vi } from 'vitest';

import {
  addHardDependency,
  assignRepairTaskWithDependency,
  createRepairTaskForGap,
  openGapForDrift,
  transitionGapStatus,
} from '../gap-store.js';

// ---------- 纯逻辑：状态机测试 ----------

describe('FR-5 Gap Ledger', () => {

  test('drift 自动创建可由 Kernel/Harness 执行的 repair task', async () => {
    const gap = {
      id: 'gap-auto',
      source_task_id: 'source-task',
      impact_node_id: 'billing',
      current_revision: 'a'.repeat(40),
      owner: 'factory',
      severity: 'high',
    };
    const db = {
      query: vi.fn(async (sql) => {
        const s = String(sql);
        if (s.includes('FROM tasks WHERE id')) {
          return { rows: [{
            title: 'Source', goal_id: 'goal', project_id: 'project', domain: 'factory',
            payload: {
              initiative_id: 'source-task',
              base_repo: 'perfectuser21/cecelia',
              sprint_dir: 'sprints/source',
            },
          }] };
        }
        if (s.includes('INSERT INTO tasks')) return { rows: [{ id: 'repair-task' }] };
        if (s.includes('SELECT * FROM harness_gaps')) return { rows: [gap] };
        if (s.includes('UPDATE harness_gaps')) {
          return { rows: [{ ...gap, repair_task_id: 'repair-task' }] };
        }
        if (s.includes('INSERT INTO task_dependencies')) {
          return { rows: [{ created: true }] };
        }
        return { rows: [] };
      }),
    };

    await createRepairTaskForGap(db, gap, { repo: 'perfectuser21/cecelia' });

    const insert = db.query.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO tasks'));
    const payload = JSON.parse(insert[1][5]);
    expect(payload).toMatchObject({
      change_kind: 'bugfix',
      harness_gap_id: gap.id,
      source_task_id: gap.source_task_id,
      base_repo: 'perfectuser21/cecelia',
      sprint_dir: 'sprints/source',
      impact_contract_required: true,
    });
    expect(payload).not.toHaveProperty('initiative_id');
  });

  test('幂等重投必须使用数据库插入标记，不能用时间差误判为新建', async () => {
    const now = new Date().toISOString();
    const db = {
      query: vi.fn(async (sql) => {
        if (String(sql).includes('INSERT INTO harness_gaps')) {
          return {
            rows: [{
              id: 'existing-gap',
              source_task_id: 'source',
              impact_node_id: 'node',
              created_at: now,
              updated_at: now,
              created: false,
            }],
          };
        }
        return { rows: [] };
      }),
    };

    const result = await openGapForDrift(db, {
      sourceTaskId: 'source',
      impactNodeId: 'node',
      owner: 'factory',
      revision: 'abc123',
    });

    expect(result.created).toBe(false);
    expect(result.gap).not.toHaveProperty('created');
  });

  test('新建 gap 与 discovered 事件必须在同一事务提交', async () => {
    const calls = [];
    const client = {
      query: vi.fn(async (sql) => {
        const statement = String(sql);
        calls.push(statement);
        if (statement.includes('INSERT INTO harness_gaps')) {
          return {
            rows: [{
              id: 'gap-atomic',
              source_task_id: 'source',
              impact_node_id: 'node',
              created: true,
            }],
          };
        }
        return { rows: [] };
      }),
      release: vi.fn(),
    };
    const pool = { connect: vi.fn(async () => client) };

    await openGapForDrift(pool, {
      sourceTaskId: 'source',
      impactNodeId: 'node',
      owner: 'factory',
      revision: 'abc123',
    });

    expect(calls[0]).toBe('BEGIN');
    expect(calls.at(-1)).toBe('COMMIT');
    expect(calls.some((sql) => sql.includes('INSERT INTO gap_events'))).toBe(true);
    expect(client.release).toHaveBeenCalledOnce();
  });

  test('硬依赖同时写 DAG 汇总边与逐 gap 独立关联', async () => {
    const db = {
      query: vi.fn(async (sql) => {
        if (String(sql).includes('INSERT INTO task_dependencies')) {
          return { rows: [{ from_task_id: 'source', to_task_id: 'repair', created: true }] };
        }
        return { rows: [{ gap_id: 'gap', source_task_id: 'source', repair_task_id: 'repair' }] };
      }),
    };

    await addHardDependency(db, {
      fromTaskId: 'source',
      toTaskId: 'repair',
      gapId: 'gap',
    });

    const statements = db.query.mock.calls.map(([sql]) => String(sql));
    expect(statements[0]).toContain('ON CONFLICT (from_task_id, to_task_id)');
    expect(statements.some((sql) => sql.includes('INSERT INTO harness_gap_dependencies'))).toBe(true);
    expect(statements.some((sql) => sql.includes('ON CONFLICT (gap_id)'))).toBe(true);
  });

  test('绑定 repair task 与硬依赖在同一事务内提交', async () => {
    const calls = [];
    const client = {
      query: vi.fn(async (sql) => {
        const s = String(sql);
        calls.push(s);
        if (s.includes('SELECT * FROM harness_gaps')) {
          return { rows: [{ id: 'gap', source_task_id: 'source', repair_task_id: null }] };
        }
        if (s.includes('UPDATE harness_gaps')) {
          return { rows: [{ id: 'gap', source_task_id: 'source', repair_task_id: 'repair' }] };
        }
        if (s.includes('INSERT INTO task_dependencies')) {
          return { rows: [{ gap_id: 'gap', created: true }] };
        }
        return { rows: [] };
      }),
      release: vi.fn(),
    };
    const pool = { connect: vi.fn(async () => client) };

    const result = await assignRepairTaskWithDependency(pool, 'gap', 'repair');

    expect(result.gap.repair_task_id).toBe('repair');
    expect(calls[0]).toBe('BEGIN');
    expect(calls.at(-1)).toBe('COMMIT');
    expect(client.release).toHaveBeenCalledOnce();
  });

  test('改派 repair task 时取消旧 gap 关联，且不误伤仍被其他 gap 使用的 DAG 边', async () => {
    const calls = [];
    const client = {
      query: vi.fn(async (sql) => {
        const s = String(sql);
        calls.push(s);
        if (s.includes('SELECT * FROM harness_gaps')) {
          return { rows: [{ id: 'gap', source_task_id: 'source', repair_task_id: 'repair-old' }] };
        }
        if (s.includes('UPDATE harness_gaps')) {
          return { rows: [{ id: 'gap', source_task_id: 'source', repair_task_id: 'repair-new' }] };
        }
        if (s.includes('INSERT INTO task_dependencies')) {
          return { rows: [{ from_task_id: 'source', to_task_id: 'repair-new', created: true }] };
        }
        return { rows: [] };
      }),
      release: vi.fn(),
    };
    const pool = { connect: vi.fn(async () => client) };

    await assignRepairTaskWithDependency(pool, 'gap', 'repair-new');

    expect(calls.some((sql) => (
      sql.includes('UPDATE harness_gap_dependencies') && sql.includes("status = 'cancelled'")
    ))).toBe(true);
    const oldEdgeUpdate = calls.find((sql) => (
      sql.includes('UPDATE task_dependencies') && sql.includes("status = 'cancelled'")
    ));
    expect(oldEdgeUpdate).toContain('NOT EXISTS');
    expect(oldEdgeUpdate).toContain('harness_gap_dependencies');
  });

  test('resolved 必须携带当前 revision 的 PASS 回执', async () => {
    const db = {
      query: vi.fn(async (sql) => {
        if (String(sql).startsWith('SELECT * FROM harness_gaps')) {
          return { rows: [{ id: 'gap', status: 'verifying', current_revision: 'abc123' }] };
        }
        return { rows: [] };
      }),
    };

    await expect(transitionGapStatus(db, 'gap', 'resolved', {
      resolutionEvidence: {
        assertion_id: 'assertion-1',
        assertion_receipt: { status: 'fail' },
        revision: 'abc123',
      },
    })).rejects.toMatchObject({ code: 'invalid_resolution_evidence' });

    await expect(transitionGapStatus(db, 'gap', 'resolved', {
      resolutionEvidence: {
        assertion_id: 'assertion-1',
        assertion_receipt: { status: 'pass' },
        revision: 'abc123',
      },
    })).rejects.toMatchObject({ code: 'invalid_resolution_evidence' });

    await expect(transitionGapStatus(db, 'gap', 'resolved', {
      resolutionEvidence: {
        assertion_id: 'assertion-1',
        assertion_receipt: { status: 'pass' },
        revision: 'different',
      },
    })).rejects.toMatchObject({ code: 'revision_mismatch' });
  });

  test('最后一个 gap resolved 后恢复 source task', async () => {
    const calls = [];
    const assertionId = 'packages/brain/src/assertion-1.test.js';
    const assertionDigest = createHash('sha256').update(assertionId).digest('hex');
    const journeyStepLinkId = '11111111-1111-4111-8111-111111111111';
    const contractId = '22222222-2222-4222-8222-222222222222';
    const contractHash = 'c'.repeat(64);
    const revision = 'a'.repeat(40);
    const completedAt = '2026-08-11T04:00:00.000Z';
    const db = {
      query: vi.fn(async (sql, params) => {
        const s = String(sql);
        calls.push({ sql: s, params });
        if (s.startsWith('SELECT * FROM harness_gaps')) {
          return {
            rows: [{
              id: 'gap',
              source_task_id: 'source-task',
              repair_task_id: 'repair-task',
              impact_node_id: 'billing',
              status: 'verifying',
              current_revision: revision,
            }],
          };
        }
        if (s.startsWith('SELECT id FROM tasks')) return { rows: [{ id: 'source-task' }] };
        if (s.startsWith('SELECT status, completed_at FROM tasks')) {
          return { rows: [{ status: 'completed', completed_at: completedAt }] };
        }
        if (s.includes('FROM harness_impact_contracts')) {
          return { rows: [{
            id: contractId,
            contract_hash: contractHash,
            repo: 'perfectuser21/cecelia', contract_body: { required_assertions: [{
            assertion_id: assertionId,
            command: `npx vitest run ${assertionId}`,
            covers_capability_ids: ['billing'],
            journey_step_link_id: journeyStepLinkId,
            assertion_revision: 1,
            assertion_digest: assertionDigest,
          }] },
          }] };
        }
        if (s.includes('MAX(created_at) AS verification_started_at')) {
          return { rows: [{ verification_started_at: completedAt }] };
        }
        if (s.includes('FROM journey_assertion_receipts')) {
          return { rows: [{
            id: 'receipt-1',
            journey_step_link_id: journeyStepLinkId,
            verdict: 'PASS',
            exit_code: 0,
            synthetic: false,
            executor_kind: 'brain_assertion_runner',
            machine_id: 'runner-1',
            source_repo: 'perfectuser21/cecelia',
            source_sha: revision,
            impact_contract_id: contractId,
            impact_contract_hash: contractHash,
            verification_task_id: 'repair-task',
            assertion_ref_snapshot: assertionId,
            current_assertion_ref: assertionId,
            assertion_revision: 1,
            current_assertion_revision: 1,
            assertion_digest: assertionDigest,
            command_argv: ['npx', 'vitest', 'run', assertionId],
            completed_at: completedAt,
            output_digest: 'a'.repeat(64),
            scenario_count: 1,
            scenario_evidence: { passed: 1 },
          }] };
        }
        if (s.includes('UPDATE harness_gaps')) {
          return { rows: [{ id: 'gap', source_task_id: 'source-task', status: 'resolved' }] };
        }
        if (s.includes('INSERT INTO gap_events')) return { rows: [{ id: 'event' }] };
        return { rows: [] };
      }),
    };

    await transitionGapStatus(db, 'gap', 'resolved', {
      resolutionEvidence: {
        assertion_id: assertionId,
        receipt_id: 'receipt-1',
        revision,
      },
    });

    const resume = calls.find(({ sql }) => sql.includes('UPDATE tasks') && sql.includes("status = 'queued'"));
    expect(resume).toBeDefined();
    expect(resume.sql).toContain('NOT EXISTS');
    expect(resume.params).toContain('source-task');
  });

  test('聚合断言缺少任一 source binding 的可信回执时不得 resolved', async () => {
    const assertionId = 'packages/brain/src/example.test.js';
    const assertionDigest = createHash('sha256').update(assertionId).digest('hex');
    const primaryLinkId = '11111111-1111-4111-8111-111111111111';
    const secondaryLinkId = '22222222-2222-4222-8222-222222222222';
    const contractId = '33333333-3333-4333-8333-333333333333';
    const contractHash = 'c'.repeat(64);
    const revision = 'a'.repeat(40);
    const completedAt = '2026-08-11T04:00:00.000Z';
    const db = {
      query: vi.fn(async (sql) => {
        const s = String(sql);
        if (s.startsWith('SELECT * FROM harness_gaps')) return { rows: [{
          id: 'gap', source_task_id: 'source-task', repair_task_id: 'repair-task',
          impact_node_id: 'billing', status: 'verifying', current_revision: revision,
        }] };
        if (s.startsWith('SELECT id FROM tasks')) return { rows: [{ id: 'source-task' }] };
        if (s.startsWith('SELECT status, completed_at FROM tasks')) {
          return { rows: [{ status: 'completed', completed_at: completedAt }] };
        }
        if (s.includes('FROM harness_impact_contracts')) return { rows: [{
          id: contractId, contract_hash: contractHash, repo: 'perfectuser21/cecelia',
          contract_body: { required_assertions: [{
            assertion_id: assertionId,
            command: `npx vitest run ${assertionId}`,
            covers_capability_ids: ['billing'],
            journey_step_link_id: primaryLinkId, assertion_revision: 1,
            assertion_digest: assertionDigest,
            source_bindings: [
              { journey_step_link_id: primaryLinkId, assertion_revision: 1, assertion_digest: assertionDigest },
              { journey_step_link_id: secondaryLinkId, assertion_revision: 2, assertion_digest: assertionDigest },
            ],
          }] },
        }] };
        if (s.includes('MAX(created_at) AS verification_started_at')) {
          return { rows: [{ verification_started_at: completedAt }] };
        }
        if (s.includes('FROM journey_assertion_receipts')) return { rows: [{
          id: 'receipt-primary', journey_step_link_id: primaryLinkId,
          verdict: 'PASS', exit_code: 0, synthetic: false,
          executor_kind: 'brain_assertion_runner', machine_id: 'runner-1',
          source_repo: 'perfectuser21/cecelia', source_sha: revision,
          impact_contract_id: contractId, impact_contract_hash: contractHash,
          verification_task_id: 'repair-task', assertion_ref_snapshot: assertionId,
          current_assertion_ref: assertionId, assertion_revision: 1,
          current_assertion_revision: 1, assertion_digest: assertionDigest,
          command_argv: ['npx', 'vitest', 'run', assertionId], completed_at: completedAt,
          output_digest: 'a'.repeat(64), scenario_count: 1,
          scenario_evidence: { passed: 1 },
        }] };
        return { rows: [] };
      }),
    };

    await expect(transitionGapStatus(db, 'gap', 'resolved', {
      resolutionEvidence: { assertion_id: assertionId, receipt_id: 'receipt-primary', revision },
    })).rejects.toMatchObject({ code: 'invalid_resolution_evidence' });
  });

  test('不能用另一条 Journey Step Link 的 PASS 回执关闭 gap', async () => {
    const assertionId = 'assertion-1';
    const assertionDigest = createHash('sha256').update(assertionId).digest('hex');
    const contractLinkId = '11111111-1111-4111-8111-111111111111';
    const receiptLinkId = '22222222-2222-4222-8222-222222222222';
    const db = {
      query: vi.fn(async (sql) => {
        const s = String(sql);
        if (s.startsWith('SELECT * FROM harness_gaps')) {
          return { rows: [{
            id: 'gap',
            source_task_id: 'source-task',
            repair_task_id: 'repair-task',
            impact_node_id: 'billing',
            status: 'verifying',
            current_revision: 'abc123',
          }] };
        }
        if (s.startsWith('SELECT id FROM tasks')) return { rows: [{ id: 'source-task' }] };
        if (s.startsWith('SELECT status, completed_at FROM tasks')) {
          return { rows: [{ status: 'completed', completed_at: new Date().toISOString() }] };
        }
        if (s.includes('FROM harness_impact_contracts')) {
          return { rows: [{ contract_body: { required_assertions: [{
            assertion_id: assertionId,
            covers_capability_ids: ['billing'],
            journey_step_link_id: contractLinkId,
            assertion_revision: 1,
            assertion_digest: assertionDigest,
          }] } }] };
        }
        if (s.includes('MAX(created_at) AS verification_started_at')) {
          return { rows: [{ verification_started_at: new Date().toISOString() }] };
        }
        if (s.includes('FROM journey_assertion_receipts')) {
          return { rows: [{
            id: 'receipt-other-link',
            journey_step_link_id: receiptLinkId,
            verdict: 'PASS',
            exit_code: 0,
            synthetic: false,
            executor_kind: 'brain_assertion_runner',
            source_sha: 'abc123',
            assertion_ref_snapshot: assertionId,
            current_assertion_ref: assertionId,
            assertion_revision: 1,
            current_assertion_revision: 1,
            assertion_digest: assertionDigest,
            output_digest: 'a'.repeat(64),
            scenario_count: 1,
            scenario_evidence: { passed: 1 },
          }] };
        }
        return { rows: [] };
      }),
    };

    await expect(transitionGapStatus(db, 'gap', 'resolved', {
      resolutionEvidence: {
        assertion_id: assertionId,
        receipt_id: 'receipt-other-link',
        revision: 'abc123',
      },
    })).rejects.toMatchObject({ code: 'invalid_resolution_evidence' });
  });

  test('断言不覆盖当前 impact node 时不能关闭 gap', async () => {
    const assertionId = 'assertion-1';
    const assertionDigest = createHash('sha256').update(assertionId).digest('hex');
    const db = {
      query: vi.fn(async (sql) => {
        const s = String(sql);
        if (s.startsWith('SELECT * FROM harness_gaps')) {
          return { rows: [{
            id: 'gap',
            source_task_id: 'source-task',
            repair_task_id: 'repair-task',
            impact_node_id: 'billing',
            status: 'verifying',
            current_revision: 'abc123',
          }] };
        }
        if (s.startsWith('SELECT id FROM tasks')) return { rows: [{ id: 'source-task' }] };
        if (s.startsWith('SELECT status, completed_at FROM tasks')) {
          return { rows: [{ status: 'completed', completed_at: new Date().toISOString() }] };
        }
        if (s.includes('FROM harness_impact_contracts')) {
          return { rows: [{ contract_body: { required_assertions: [{
            assertion_id: assertionId,
            covers_capability_ids: ['task-routing'],
            journey_step_link_id: '11111111-1111-4111-8111-111111111111',
            assertion_revision: 1,
            assertion_digest: assertionDigest,
          }] } }] };
        }
        return { rows: [] };
      }),
    };

    await expect(transitionGapStatus(db, 'gap', 'resolved', {
      resolutionEvidence: {
        assertion_id: assertionId,
        receipt_id: 'receipt-1',
        revision: 'abc123',
      },
    })).rejects.toMatchObject({ code: 'assertion_not_covering_gap' });
  });

  test('相同 idempotency key 的 resolved 回调可重复投递', async () => {
    const existingEvent = { id: 'event-1', idempotency_key: 'resolve-once' };
    const db = {
      query: vi.fn(async (sql) => {
        const s = String(sql);
        if (s.startsWith('SELECT * FROM harness_gaps')) {
          return {
            rows: [{
              id: 'gap',
              source_task_id: 'source-task',
              status: 'resolved',
              current_revision: 'abc123',
            }],
          };
        }
        if (s.startsWith('SELECT * FROM gap_events')) return { rows: [existingEvent] };
        return { rows: [] };
      }),
    };

    const result = await transitionGapStatus(db, 'gap', 'resolved', {
      idempotencyKey: 'resolve-once',
      resolutionEvidence: {
        assertion_id: 'assertion-1',
        assertion_receipt: { status: 'pass' },
        revision: 'abc123',
      },
    });

    expect(result.event).toEqual(existingEvent);
    expect(db.query.mock.calls.some(([sql]) => String(sql).includes('UPDATE harness_gaps'))).toBe(false);
  });

});
