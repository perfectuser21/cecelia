/**
 * script 执行体的注册表 / 活性合同 / 重试策略 / 机器别名 / 建单入口拒绝（链 bf5088a3 棒3 PR A）。
 */
import { describe, it, expect, vi } from 'vitest';
import { getTaskType, KIND_FOR_TASK_TYPE, TASK_TYPE_REGISTRY, EXECUTOR_KIND_FOR_TASK_TYPE, TICK_DISPATCH_EXCLUDED } from '../lib/task-type-registry.js';
import { EXECUTOR_CONTRACTS, VALID_EXECUTOR_KINDS, EXECUTOR_KIND_FOR } from '../executor-contracts.js';
import { RETRY_POLICY, getBackoffMs, getMaxRetries } from '../lib/retry-policy.js';
import { resolveMachineId, MACHINES } from '../machine-registry.js';
import { deriveTaskKind, resolveTaskAttributes } from '../lib/task-kind.js';
import { createRoutedTask } from '../work-routing-store.js';

describe('注册表：script_run', () => {
  it('声明为一步交付（kind=agent），执行体/活性/面都是 script，进 DB 白名单、免锚', () => {
    const e = getTaskType('script_run');
    expect(e).toBeTruthy();
    expect(e.kind).toBe('agent');
    expect(e.surface).toBe('script');
    expect(e.executor).toBe('script');
    expect(e.watchdog).toBe('script');
    expect(e.db).toBe(true);
    expect(e.pr).toBe(false);
    expect(e.coding).toBe(false);
    expect(e.tags).toContain('anchor_exempt');
    expect(e.tags).toContain('system_no_prd'); // payload.cmd 就是规格，pre-flight 不要求 PRD 描述
    expect(KIND_FOR_TASK_TYPE.script_run).toBe('agent');
    expect(deriveTaskKind('script_run')).toBe('agent');
    expect(EXECUTOR_KIND_FOR_TASK_TYPE.script_run).toBe('script');
    expect(EXECUTOR_KIND_FOR.script_run).toBe('script');
  });

  it('每个类型仍逐一声明 kind（棒 4 的不变量不被新类型破坏）', () => {
    for (const [name, entry] of Object.entries(TASK_TYPE_REGISTRY)) {
      expect(['agent', 'workflow'], name).toContain(entry.kind);
    }
  });

  it('PR B 起 script_run 进 tick 派发（执行体 script-executor 已接线：dispatcher 专用出口 + executor 分支 + 收割 job）', () => {
    expect(getTaskType('script_run').tick_dispatchable).toBe(true);
    expect(TICK_DISPATCH_EXCLUDED).not.toContain('script_run');
  });

  it('resolveTaskAttributes 读得到 script_run 的 kind', () => {
    expect(resolveTaskAttributes({ task_type: 'script_run', payload: {} }).kind).toBe('agent');
  });
});

describe('活性合同：script', () => {
  it("VALID_EXECUTOR_KINDS 含 'script'，合同 fail 策略，窗口盖住最长 timeout（3600s）", () => {
    expect(VALID_EXECUTOR_KINDS).toContain('script');
    const c = EXECUTOR_CONTRACTS.script;
    expect(c).toBeTruthy();
    expect(c.onStale).toBe('fail');
    expect(c.staleMinutes).toBeGreaterThan(60);
  });

  it('probe：payload 缺 host / run_id 或 host 非跑场机 → unknown（fail-open，绝不误杀，也不发 ssh）', async () => {
    const c = EXECUTOR_CONTRACTS.script;
    expect(await c.probe({ id: 't', payload: {} })).toBe('unknown');
    expect(await c.probe({ id: 't', payload: { host: 'us-vps', script_run_id: 'script-t-a1' } })).toBe('unknown');
    expect(await c.probe({ id: 't', payload: { host: 'xian-m4', script_run_id: '../etc/passwd' } })).toBe('unknown');
  });
});

describe('重试策略：script_exec 走同一张 retry-policy 表', () => {
  it('一次重试后耗尽', () => {
    expect(RETRY_POLICY.script_exec).toBeTruthy();
    expect(getMaxRetries('script_exec')).toBe(1);
    expect(getBackoffMs('script_exec', 0)).toBeGreaterThan(0);
    expect(getBackoffMs('script_exec', 1)).toBeNull();
  });
});

describe('machine-registry：别名解析', () => {
  it('id 与别名（大小写不敏感）都解析为注册表 id；未知返回 null', () => {
    expect(resolveMachineId('xian-mac-m4')).toBe('xian-mac-m4');
    expect(resolveMachineId('XIAN-M4')).toBe('xian-mac-m4');
    expect(resolveMachineId('xian-m1')).toBe('xian-mac-m1');
    expect(resolveMachineId('mmv')).toBe(MACHINES.find((m) => m.machineRole === 'primary').id);
    expect(resolveMachineId('nope')).toBeNull();
    expect(resolveMachineId('')).toBeNull();
    expect(resolveMachineId(undefined)).toBeNull();
  });
});

describe('建单入口：createRoutedTask 拒绝违规 script_run', () => {
  const makePool = () => ({
    query: vi.fn(async (sql) => {
      if (/INSERT INTO tasks/.test(sql)) return { rows: [{ id: 't1', payload: {} }], rowCount: 1 };
      if (/INSERT INTO work_routing_receipts/.test(sql)) return { rows: [{ id: 'r1' }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    }),
  });
  const req = (metadata) => ({
    source: 'api',
    source_id: `s-${Math.random().toString(36).slice(2)}`,
    title: '脚本步',
    description: 'd',
    requested_task_type: 'script_run',
    mutation_intent: 'none',
    declared_domain: 'operations',
    metadata,
    task: { priority: 'P2' },
  });

  it('host=us-vps → 抛 script_payload_invalid，事务回滚，不 INSERT', async () => {
    const pool = makePool();
    let err;
    try { await createRoutedTask(pool, req({ host: 'us-vps', cmd: 'echo hi', timeout_sec: 10 })); } catch (e) { err = e; }
    expect(err?.code).toBe('script_payload_invalid');
    expect(pool.query.mock.calls.some(([sql]) => /INSERT INTO tasks/.test(sql))).toBe(false);
    expect(pool.query.mock.calls.some(([sql]) => sql === 'ROLLBACK')).toBe(true);
  });

  it('合法 payload → 正常 INSERT', async () => {
    const pool = makePool();
    await createRoutedTask(pool, req({ host: 'xian-m4', cmd: 'echo hi', timeout_sec: 10 }));
    expect(pool.query.mock.calls.some(([sql]) => /INSERT INTO tasks/.test(sql))).toBe(true);
  });
});
