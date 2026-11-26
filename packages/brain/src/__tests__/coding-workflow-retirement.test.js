import { describe, expect, it, vi } from 'vitest';
vi.mock('../db.js', () => ({ default: { query: vi.fn(() => { throw Error('production_database_forbidden'); }) } }));
import { routeWork } from '../work-router.js';
import { createRoutedTask } from '../work-routing-store.js';
import { resolveDispatchRoute, normalizeBorrowedTaskType } from '../lib/dispatch-route.js';
import { claimTaskWithLease } from '../lib/task-lease.js';
import { DB_WHITELISTED_TASK_TYPES, getTaskType } from '../lib/task-type-registry.js';

const request = extra => ({ source: 'api', source_id: 'retired-coding', title: '开发',
  requested_task_type: 'dev', mutation_intent: 'write', declared_change_kind: 'bugfix',
  repo_hint: 'cecelia', map_scope_hint: ['F1'], branch: 'cp-retirement', base_sha: 'a'.repeat(40), ...extra });
const facts = [{ repo: 'cecelia', scope_key: 'cecelia' }];
function database() {
  return { query: vi.fn(async (sql, params) => {
    if (/WITH authoritative_scope AS/.test(sql)) return { rows: [{ node_key: 'F1' }] };
    if (/INSERT INTO tasks/.test(sql)) return { rows: [{ id: 'task-1', task_type: params[3], payload: JSON.parse(params[9]) }] };
    if (/INSERT INTO work_routing_receipts/.test(sql)) return { rows: [{ id: 'receipt-1' }] };
    return { rows: [] };
  }) };
}

describe('旧自主coding退役，用户派发agent和有头开发保留', () => {
  it('真实建单入口将用户开发交普通codex_dev agent，有头仍用dev', async () => {
    for (const headed of [false, true]) {
      const db = database();
      const result = await createRoutedTask(db, request(headed ? { metadata: { headed_manual: 'true' } } : {}), facts);
      expect(result.task.task_type).toBe(headed ? 'dev' : 'codex_dev');
      expect(result.decision).toMatchObject(headed
        ? { canonical_task_type: 'dev', pipeline: 'headed_development', orchestrator: 'headed-session' }
        : { canonical_task_type: 'codex_dev', pipeline: 'agent_development', orchestrator: 'codex-bridge' });
      expect(result.task.payload).not.toHaveProperty('coding_workflow');
      if (!headed) expect(result.task.payload.base_repo).toBe('perfectuser21/cecelia');
    }
    expect(routeWork({ source: 'api', source_id: 'ordinary-flow', title: '流程账本', mutation_intent: 'none',
      declared_domain: 'operations', requested_task_type: 'workflow_run', task: { status: 'in_progress' } }))
      .toMatchObject({ canonical_task_type: 'workflow_run', pipeline: 'operations' });
  });

  it('Agent仓库严格匹配现役桥接支持，不能把Skills或虚拟源码落错默认仓',()=>{
    for (const repo of ['zenithjoy-skills','commander-generic-workspace']) {
      expect(()=>routeWork(request({repo_hint:repo}),[{repo,scope_key:repo}])).toThrow('agent_repo_unsupported');
      expect(routeWork(request({repo_hint:repo,metadata:{headed_manual:'true'}}),[{repo,scope_key:repo}])).toMatchObject({canonical_task_type:'dev',repo});
    }
  });

  it('旧类型和旧data借壳在所有创建状态均拒绝，不能借有头标记复活', async () => {
    for (const status of ['queued', 'blocked', 'in_progress', 'completed']) {
      for (const value of [true, 'true', 't']) {
        const db = { query: vi.fn() };
        await expect(createRoutedTask(db, request({ requested_task_type: 'data',
          metadata: { coding_workflow: value, headed_manual: 'true' }, task: { status } }), facts))
          .rejects.toMatchObject({ code: 'task_type_retired' });
        expect(db.query).not.toHaveBeenCalled();
        expect(resolveDispatchRoute({ task_type: 'data', payload: { coding_workflow: value, headed_manual: true } }))
          .toMatchObject({ available: false, route: 'retired-development' });
        expect(() => normalizeBorrowedTaskType('data', { coding_workflow: value })).toThrow('task_type_retired');
      }
      const db = { query: vi.fn() };
      await expect(createRoutedTask(db, request({ requested_task_type: 'coding_workflow', task: { status } }), facts))
        .rejects.toMatchObject({ code: 'task_type_retired' });
      expect(db.query).not.toHaveBeenCalled();
    }
  });

  it('现役注册表移除旧自主类型，数据库历史枚举仍可读', () => {
    expect(getTaskType('coding_workflow')).toBeNull();
    expect(DB_WHITELISTED_TASK_TYPES).toContain('coding_workflow');
    expect(resolveDispatchRoute({ task_type: 'coding_workflow', payload: { machine: 'xian-m4', executor: 'codex' } }))
      .toMatchObject({ available: false, route: 'retired-development' });
  });

  it('已排队的旧任务不能重新认领启动，旧kind也不能领取其他任务', async () => {
    for (const start of [undefined, true]) {
      const query = vi.fn(async sql => /SELECT .*FROM tasks WHERE id=\$1 FOR UPDATE/.test(sql)
        ? { rows: [{ id: 'old-task', task_type: 'coding_workflow', payload: {} }] } : { rows: [] });
      const db = { query, release: vi.fn() };
      const pool = { ...db, connect: vi.fn(async () => db) };
      const result = await claimTaskWithLease(pool, { taskId: 'old-task', claimer: 'any-actor', start, leaseSeconds: 60 });
      expect(result.status).toBe(410);
      expect(result.body.error).toBe('task_type_retired');
      expect(query.mock.calls.some(([sql]) => /UPDATE tasks|INSERT INTO task_leases/.test(sql))).toBe(false);
    }
    const query = vi.fn();
    expect(await claimTaskWithLease({ query }, { taskId: 'other', claimer: 'old-runner', executorKind: 'coding-workflow-runner' }))
      .toMatchObject({ status: 410, body: { error: 'executor_kind_retired' } });
    expect(query).not.toHaveBeenCalled();
  });
});
