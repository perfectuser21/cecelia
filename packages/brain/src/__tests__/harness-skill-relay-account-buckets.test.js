import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  _setActiveCodexRelays,
  snapshotCodexRelayHome,
  spawnSkillRelaySession,
} from '../harness-skill-relay.js';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function codexTask(account = 'team1', suffix = '1111') {
  return {
    id: `aaaabbbb-cccc-dddd-eeee-ffff0000${suffix}`,
    title: `Codex ${account} controller`,
    payload: {
      orchestrator: 'skill-relay',
      executor: 'codex',
      executor_account: account,
      sprint_dir: `sprints/account-${account}-${suffix}`,
    },
  };
}

function makeDeps(overrides = {}) {
  return {
    pool: { query: vi.fn().mockResolvedValue({ rows: [] }) },
    spawnFn: vi.fn().mockResolvedValue({ containerId: 'cid' }),
    loadSkill: vi.fn().mockReturnValue('SKILL'),
    ensureWt: vi.fn().mockResolvedValue('/tmp/wt'),
    resolveAccountFn: vi.fn(),
    resolveCodexRelayAccountFn: vi.fn(({ requestedAccount }) => ({
      id: requestedAccount || 'team1',
      home: `/Users/administrator/.codex-${requestedAccount || 'team1'}`,
    })),
    snapshotCodexHome: vi.fn((_home, taskId) =>
      `/Users/administrator/claude-output/codex-relay-credentials/${taskId}`),
    cleanupCodexHome: vi.fn(),
    tokenFn: vi.fn().mockResolvedValue('gh-token'),
    execFn: vi.fn().mockReturnValue(''),
    now: () => new Date('2026-07-26T01:00:00Z'),
    ...overrides,
  };
}

afterEach(() => {
  _setActiveCodexRelays(0);
  vi.unstubAllEnvs();
});

describe('One Session Codex controller account resolution', () => {
  it('payload.executor_account 明确指定 team4 时，server-side resolver 选择 team4 home', async () => {
    vi.stubEnv('CODEX_RELAY_HOME', '/Users/administrator/.codex-team2');
    const deps = makeDeps();
    const task = codexTask('team4');

    const result = await spawnSkillRelaySession(task, deps);

    expect(result.ok).toBe(true);
    expect(deps.resolveCodexRelayAccountFn).toHaveBeenCalledWith(expect.objectContaining({
      task,
      requestedAccount: 'team4',
    }));
    expect(deps.snapshotCodexHome).toHaveBeenCalledWith(
      '/Users/administrator/.codex-team4',
      task.id,
    );
    expect(deps.spawnFn.mock.calls[0][0].env.CECELIA_EXECUTOR_ACCOUNT).toBe('team4');
  });

  it('payload 未指定账户时，使用 server-side resolver 返回的账户', async () => {
    vi.stubEnv('CODEX_RELAY_HOME', '/Users/administrator/.codex-team2');
    const task = codexTask(undefined, '2222');
    delete task.payload.executor_account;
    const deps = makeDeps({
      resolveCodexRelayAccountFn: vi.fn(() => ({
        id: 'team3',
        home: '/Users/administrator/.codex-team3',
      })),
    });

    const result = await spawnSkillRelaySession(task, deps);

    expect(result.ok).toBe(true);
    expect(deps.snapshotCodexHome).toHaveBeenCalledWith(
      '/Users/administrator/.codex-team3',
      task.id,
    );
    expect(deps.spawnFn.mock.calls[0][0].env.CECELIA_EXECUTOR_ACCOUNT).toBe('team3');
    const persistedAccount = deps.pool.query.mock.calls.find(
      ([sql]) => /UPDATE tasks/.test(sql) && /executor_account/.test(sql),
    );
    expect(persistedAccount, 'resolver 选出的账户必须回写 payload 供 DB 并发守门').toBeTruthy();
    expect(persistedAccount[1]).toContain('team3');
  });
});

describe('One Session Codex concurrency is bucketed by account', () => {
  it('同一账户已有 controller 时 defer', async () => {
    vi.stubEnv('CODEX_RELAY_HOME', '/Users/administrator/.codex-team1');
    _setActiveCodexRelays({ team1: 1 });
    const deps = makeDeps();

    const result = await spawnSkillRelaySession(codexTask('team1'), deps);

    expect(result).toMatchObject({
      ok: false,
      deferred: true,
      reason: 'codex_concurrent_limit',
    });
    expect(deps.spawnFn).not.toHaveBeenCalled();
  });

  it('不同账户不被进程内账户桶互相阻塞', async () => {
    vi.stubEnv('CODEX_RELAY_HOME', '/Users/administrator/.codex-team2');
    _setActiveCodexRelays({ team1: 1 });
    const deps = makeDeps();

    const result = await spawnSkillRelaySession(codexTask('team2', '2222'), deps);

    expect(result.ok).toBe(true);
    expect(deps.spawnFn).toHaveBeenCalledOnce();
  });

  it('四个不同账户已活跃时命中 Codex controller 总上限 4', async () => {
    vi.stubEnv('CODEX_RELAY_HOME', '/Users/administrator/.codex-team5');
    _setActiveCodexRelays({ team1: 1, team2: 1, team3: 1, team4: 1 });
    const deps = makeDeps();

    const result = await spawnSkillRelaySession(codexTask('team5', '5555'), deps);

    expect(result).toMatchObject({
      ok: false,
      deferred: true,
      reason: 'codex_concurrent_limit',
    });
    expect(deps.spawnFn).not.toHaveBeenCalled();
  });

  it('DB 守门只统计同 executor_account，team1 活跃不阻塞 team2', async () => {
    vi.stubEnv('CODEX_RELAY_HOME', '/Users/administrator/.codex-team2');
    const pool = {
      query: vi.fn(async (sql, params = []) => {
        if (/SELECT COUNT\(\*\)/.test(sql)) {
          const accountScoped = /executor_account/.test(sql) && params.includes('team2');
          return { rows: [{ count: accountScoped ? '0' : '1' }] };
        }
        return { rows: [] };
      }),
    };
    const deps = makeDeps({ pool });

    const result = await spawnSkillRelaySession(codexTask('team2', '2222'), deps);

    expect(result.ok).toBe(true);
    const gateCall = pool.query.mock.calls.find(([sql]) => /SELECT COUNT\(\*\)/.test(sql));
    expect(gateCall[0]).toMatch(/executor_account/);
    expect(gateCall[1]).toContain('team2');
  });
});

describe('Codex credential snapshot lifecycle', () => {
  it('快照落 CODEX_RELAY_SNAPSHOT_ROOT 宿主可见目录且权限为 0700', () => {
    const sandbox = mkdtempSync(join(tmpdir(), 'codex-relay-red-'));
    const source = join(sandbox, 'source');
    const hostVisibleRoot = join(sandbox, 'host-visible');
    mkdirSync(source, { recursive: true });
    mkdirSync(hostVisibleRoot, { recursive: true });
    chmodSync(hostVisibleRoot, 0o700);
    writeFileSync(join(source, 'auth.json'), '{"tokens":{"access_token":"secret"}}');
    vi.stubEnv('CODEX_RELAY_SNAPSHOT_ROOT', hostVisibleRoot);

    let snapshot;
    try {
      snapshot = snapshotCodexRelayHome(source, 'task-host-visible');
      expect(snapshot.startsWith(`${hostVisibleRoot}/`)).toBe(true);
      expect(statSync(snapshot).mode & 0o777).toBe(0o700);
      expect(readFileSync(join(snapshot, 'auth.json'), 'utf8')).toContain('secret');
    } finally {
      rmSync(snapshot || '', { recursive: true, force: true });
      rmSync(sandbox, { recursive: true, force: true });
    }
  });

  it('spawn 失败时立即清理已创建的凭据快照', async () => {
    vi.stubEnv('CODEX_RELAY_HOME', '/Users/administrator/.codex-team5');
    const snapshotDir = '/Users/administrator/claude-output/codex-relay-credentials/task-team5';
    const cleanupCodexHome = vi.fn();
    const deps = makeDeps({
      snapshotCodexHome: vi.fn().mockReturnValue(snapshotDir),
      cleanupCodexHome,
      spawnFn: vi.fn().mockRejectedValue(new Error('docker unavailable')),
    });

    const result = await spawnSkillRelaySession(codexTask('team5', '5555'), deps);

    expect(result.ok).toBe(false);
    expect(cleanupCodexHome).toHaveBeenCalledWith(snapshotDir);
  });
});

describe('Brain container Codex account wiring', () => {
  it('team1-5 的 mount 与 credentials health 账户集合一致', () => {
    const compose = readFileSync(
      new URL('../../../../docker-compose.yml', import.meta.url),
      'utf8',
    );
    const health = readFileSync(
      new URL('../credentials-health-scheduler.js', import.meta.url),
      'utf8',
    );

    for (const account of ['team1', 'team2', 'team3', 'team4', 'team5']) {
      expect(compose).toContain(
        `/Users/administrator/.codex-${account}:/Users/administrator/.codex-${account}:ro`,
      );
      expect(health).toMatch(new RegExp(`['"]${account}['"]`));
    }
  });
});
