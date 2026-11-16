import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const boundary = vi.hoisted(() => {
  const deny = vi.fn(() => { throw new Error('incident_fixture_external_operation_denied'); });
  return { deny, query: vi.fn(), emit: vi.fn(), raise: vi.fn(), sendBark: vi.fn() };
});

// 仅允许自有SQL记录器；缺少mock时在构造连接前失败。
vi.mock('pg', () => {
  class RefusingPool { constructor() { boundary.deny(); } }
  return { Pool: RefusingPool, default: { Pool: RefusingPool } };
});
vi.mock('../../../packages/brain/src/db.js', () => ({ default: { query: boundary.query } }));
vi.mock('../../../packages/brain/src/db/pool.js', () => ({ default: { query: boundary.query } }));
vi.mock('../../../packages/brain/src/alerting.js', () => ({ raise: boundary.raise }));
vi.mock('../../../packages/brain/src/notifier.js', () => ({ sendBark: boundary.sendBark }));
vi.mock('../../../packages/brain/src/event-bus.js', () => ({ emit: boundary.emit }));
vi.mock('../../../packages/brain/src/actions.js', () => ({ createTask: boundary.deny }));
vi.mock('node:http', async original => {
  const actual = await original();
  return { ...actual, request: boundary.deny, get: boundary.deny, default: { ...actual.default, request: boundary.deny, get: boundary.deny } };
});
vi.mock('node:https', async original => {
  const actual = await original();
  return { ...actual, request: boundary.deny, get: boundary.deny, default: { ...actual.default, request: boundary.deny, get: boundary.deny } };
});
vi.mock('node:net', async original => {
  const actual = await original();
  return { ...actual, connect: boundary.deny, createConnection: boundary.deny, default: { ...actual.default, connect: boundary.deny, createConnection: boundary.deny } };
});
vi.mock('node:tls', async original => {
  const actual = await original();
  return { ...actual, connect: boundary.deny, default: { ...actual.default, connect: boundary.deny } };
});
vi.mock('child_process', () => ({
  exec: boundary.deny, execSync: boundary.deny, execFile: boundary.deny,
  execFileSync: boundary.deny, spawn: boundary.deny, spawnSync: boundary.deny, fork: boundary.deny,
}));
vi.mock('node:child_process', () => ({
  exec: boundary.deny, execSync: boundary.deny, execFile: boundary.deny,
  execFileSync: boundary.deny, spawn: boundary.deny, spawnSync: boundary.deny, fork: boundary.deny,
}));

import { runLaunchdPatrol, __resetLaunchdPatrolForTest } from '../../../packages/brain/src/launchd-patrol.js';
import { triggerDeptHeartbeats } from '../../../packages/brain/src/dept-heartbeat.js';
import { recordFailure, getState, FAILURE_THRESHOLD } from '../../../packages/brain/src/circuit-breaker.js';

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', boundary.deny);
  vi.stubGlobal('WebSocket', boundary.deny);
  boundary.emit.mockResolvedValue(undefined);
  boundary.raise.mockResolvedValue(undefined);
  boundary.sendBark.mockResolvedValue(undefined);
  boundary.query.mockImplementation(async sql => {
    if (/^\s*INSERT INTO (incidents|circuit_breaker_states)\b/.test(sql)) return { rows: [], rowCount: 1 };
    return boundary.deny(`incident_fixture_unexpected_sql: ${sql}`);
  });
  __resetLaunchdPatrolForTest();
});
afterEach(() => {
  expect(boundary.deny).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});

function incidents() {
  return boundary.query.mock.calls.filter(([sql]) => /^\s*INSERT INTO incidents\b/.test(sql));
}

function expectIncident(probe, fingerprint, severity, evidence) {
  expect(incidents()).toHaveLength(1);
  const [sql, params] = incidents()[0];
  expect(sql).toMatch(/ON CONFLICT \(fingerprint\) DO UPDATE/);
  expect(params.slice(0, 3)).toEqual([probe, fingerprint, severity]);
  expect(JSON.parse(params[3])).toEqual(evidence);
}

// 白名单只提供stdout，绝不执行launchctl、nc或SSH。
function launchdOutput(disabled = false) {
  const outputs = new Map([
    ['launchctl print-disabled system', disabled ? '"com.cecelia.bridge" => disabled' : ''],
    ['launchctl print system/com.cecelia.bridge', 'state = running'],
    ...['bridge-keepalive', 'token-refresh', 'pf-firewall', 'smoke-nightly', 'guard-drill', 'coding-workflow-runner']
      .map(name => [`launchctl print system/com.cecelia.${name}`, 'state = running']),
    ['nc -z -G 3 localhost 3457', ''],
  ]);
  return vi.fn(command => {
    if (!outputs.has(command)) {
      boundary.deny(command);
    }
    return outputs.get(command);
  });
}

describe('真实探针红信号经reporter到SQL边界', () => {
  it('launchd禁用服务写入规范fingerprint与异常证据', async () => {
    const exec = launchdOutput(true);
    const result = await runLaunchdPatrol({ now: 2_000_000, inContainer: false, exec });
    expect(result).toMatchObject({ ok: true, anomalies: ['disabled:com.cecelia.bridge'] });
    expect(exec).not.toHaveBeenCalledWith('launchctl print system/com.cecelia.bridge');
    expectIncident('launchd-patrol', 'launchd-patrol:com.cecelia.bridge', 'p1', {
      anomaly: 'disabled:com.cecelia.bridge',
      msg: '宿主 launchd 巡检发现 1 项异常: disabled:com.cecelia.bridge',
    });
    expect(boundary.raise).toHaveBeenCalledWith('P1', 'launchd_patrol_anomaly', expect.any(String));
    expect(boundary.sendBark).toHaveBeenCalledOnce();
  });

  it('部门任务创建失败经真实heartbeat handler写入错误证据', async () => {
    const pool = { query: vi.fn(async sql => {
      if (sql.includes('FROM dept_configs')) return { rows: [{ dept_name: 'audit-fixture', repo_path: '/fixture', max_llm_slots: 1 }] };
      if (sql.includes('FROM tasks') || sql.includes('FROM key_results')) return { rows: [] };
      return boundary.deny(`heartbeat_fixture_unexpected_sql: ${sql}`);
    }) };
    const createTask = vi.fn().mockRejectedValue(new Error('fixture_task_creation_failed'));
    const result = await triggerDeptHeartbeats(pool, createTask);
    expect(createTask).toHaveBeenCalledOnce();
    expect(result).toEqual({ triggered: 0, skipped: 1, results: [{ dept: 'audit-fixture', created: false, reason: 'error' }] });
    expectIncident('dept-heartbeat', 'heartbeat-silent:audit-fixture', 'p2', {
      dept_name: 'audit-fixture', error: 'fixture_task_creation_failed',
    });
  });

  it('熔断达到阈值才写incident，并保留真实事件与SQL参数', async () => {
    const key = 'incident-fixture-threshold';
    for (let i = 1; i < FAILURE_THRESHOLD; i++) await recordFailure(key);
    expect(incidents()).toEqual([]);
    expect(getState(key).state).toBe('CLOSED');
    await recordFailure(key);
    expect(getState(key).state).toBe('OPEN');
    const evidence = { key, reason: 'failure_threshold_reached', failures: FAILURE_THRESHOLD };
    expectIncident('circuit-breaker', `circuit-breaker-open:${key}`, 'p0', evidence);
    expect(boundary.emit).toHaveBeenCalledWith('circuit_open', 'circuit_breaker', evidence);
    expect(boundary.raise).toHaveBeenCalledWith('P0', `circuit_open_${key}`, expect.any(String));
  });

  it('健康launchd与已有心跳任务不写incident或发告警', async () => {
    expect(await runLaunchdPatrol({ now: 2_000_000, inContainer: false, exec: launchdOutput() }))
      .toMatchObject({ ok: true, anomalies: [] });
    const pool = { query: vi.fn(async sql => {
      if (sql.includes('FROM dept_configs')) return { rows: [{ dept_name: 'healthy-fixture' }] };
      if (sql.includes('FROM tasks')) return { rows: [{ id: 'existing-fixture-task' }] };
      return boundary.deny(`heartbeat_fixture_unexpected_sql: ${sql}`);
    }) };
    const result = await triggerDeptHeartbeats(pool, boundary.deny);
    expect(result).toMatchObject({ triggered: 0, skipped: 1 });
    expect(incidents()).toEqual([]);
    expect(boundary.raise).not.toHaveBeenCalled();
    expect(boundary.sendBark).not.toHaveBeenCalled();
    expect(boundary.emit).not.toHaveBeenCalled();
  });
});
