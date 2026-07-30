/**
 * 合同测试（回归永久留 CI）— watchdog-gh-compat
 * Sprint: sprints/07162330-watchdog-gh-compat
 *
 * 铁律：
 * 1. 必须覆盖「容器内老 gh」行为：mock execFn 对 `gh pr checks --json` 抛
 *    'unknown flag: --json' 且无 stdout → 修复前保守跳过(resumed=0,failing)，
 *    修复后走 pr view statusCheckRollup 路径正确判定 CI 红并重点火
 * 2. `_parseBaseRepo('/Users/administrator/perfect21/zenithjoy-skills')` →
 *    修复前返回 null 或 wrong value (failing)，修复后返回 'perfectuser21/zenithjoy-skills'
 * 3. 禁 mock 掉版本差异（execFn 必须真实模拟老版 gh 报错原文）
 * 4. 既有 A1/A5/A2 测试回归保护（本文件内回归断言）
 *
 * 状态：FAILING（修复前）— 修复后转为 PASSING（B1-fallback 和 B2 两条核心 failing）
 */
import { describe, it, expect, vi } from 'vitest';
import { _parseBaseRepo, resumeStalledRelayRuns } from '../../../packages/brain/src/harness-relay-watchdog.js';

// ── 辅助：构建最小可用的 fake DB pool ──────────────────────────────────────────
function buildFakePool({ runs = [], task = null } = {}) {
  return {
    query: vi.fn(async (sql, _params) => {
      if (sql.includes('FROM initiative_runs r')) return { rows: runs };
      if (sql.includes('SELECT id, status')) return { rows: task ? [task] : [] };
      return { rows: [] };
    }),
  };
}

// ── 辅助：构建在途 OPEN PR 的 run 行 ─────────────────────────────────────────
function buildOpenPrRun(overrides = {}) {
  return {
    id: '10000000-0000-4000-8000-000000000006',
    initiative_id: 'task-ghcompat-01',
    current_task_id: 'task-ghcompat-01',
    phase: 'running',
    pr_url: 'https://github.com/perfectuser21/cecelia/pull/999',
    orchestrator_host: 'skill-relay-session',
    attempts: 1,
    deadline_at: null,
    started_at: new Date(Date.now() - 60_000).toISOString(),
    completed_at: null,
    tmux_killed_at: null,
    ...overrides,
  };
}

function buildInProgressTask(overrides = {}) {
  return {
    id: 'task-ghcompat-01',
    status: 'in_progress',
    title: 'test task',
    description: null,
    payload: { orchestrator: 'skill-relay', base_repo: '/Users/administrator/perfect21/cecelia' },
    pr_url: null,
    ...overrides,
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// [BEHAVIOR] B1 — 老版 gh `--json` 报错时不保守跳过，走 pr view 路径判定 CI 红
//
// FAILING 状态（修复前）：现版本 resumed=0（保守跳过）
// 修复后：resumed=1（走 pr view statusCheckRollup 路径 → CI 红 → 重点火）
// ══════════════════════════════════════════════════════════════════════════════
describe('[BEHAVIOR] B1 — 老版 gh `--json` 报错走 pr view statusCheckRollup 路径', () => {
  it('[B1-fallback-ci-red] 老版gh报错 → fallback pr view statusCheckRollup → CI红 → resumed=1 [FAILING]', async () => {
    // 这是修复后应 PASS 的核心断言
    // 修复前此测试 FAIL（resumed=0，现版本保守跳过）
    const prUrl = 'https://github.com/perfectuser21/cecelia/pull/999';
    const execFn = vi.fn((cmd) => {
      // gh pr view --json state（PR merge 状态查询）→ OPEN
      if (cmd === `gh pr view "${prUrl}" --json state`) {
        return JSON.stringify({ state: 'OPEN' });
      }
      // 现版本调用：gh pr view --json state,mergeStateStatus（CI 检测前置）
      // 修复后不再调用此命令（改为 statusCheckRollup,mergeStateStatus）
      // 为使 execFn 覆盖两种路径，此处返回 OPEN/DIRTY
      if (cmd === `gh pr view "${prUrl}" --json state,mergeStateStatus`) {
        return JSON.stringify({ state: 'OPEN', mergeStateStatus: 'DIRTY' });
      }
      // 修复后代码调用：gh pr view --json statusCheckRollup,mergeStateStatus
      if (cmd.includes('statusCheckRollup')) {
        return JSON.stringify({
          statusCheckRollup: [
            { name: 'CI / test', state: 'FAILURE', conclusion: 'FAILURE' },
          ],
          mergeStateStatus: 'DIRTY',
        });
      }
      // 老版 gh：pr checks --json → 报错，无 stdout（容器内真实老版 gh 行为）
      if (cmd.includes('gh pr checks') && cmd.includes('--json')) {
        const err = new Error('unknown flag: --json');
        err.stdout = ''; // 关键：无 stdout，execTolerant 会 re-throw
        err.stderr = 'Flag --json is not supported by your version of gh\nunknown flag: --json\n';
        throw err;
      }
      if (cmd.includes('docker ps')) return '';
      throw new Error(`Unexpected: ${cmd}`);
    });

    const run = buildOpenPrRun({ pr_url: prUrl });
    const task = buildInProgressTask({ id: 'task-ghcompat-01', pr_url: null });
    const pool = buildFakePool({ runs: [run], task });
    const spawnFn = vi.fn(async () => ({ ok: true, containerId: 'cecelia-relay-ghcompat-01-test' }));

    const out = await resumeStalledRelayRuns({ pool, execFn, spawnFn });

    // 修复前：resumed=0（保守跳过）→ 此断言 FAIL
    // 修复后：resumed=1（CI 红 → 重点火）→ 此断言 PASS
    expect(out.resumed).toBe(1);
  });

  it('[B1-execTolerant-rethrow] execTolerant：err.stdout 为空时必须 re-throw', () => {
    // 这是 execTolerant 的固定行为（不受修复影响）
    // 目的：记录 re-throw 行为，确保修复不破坏 execTolerant 语义
    function execTolerant(execFn, cmd) {
      try { return execFn(cmd); }
      catch (err) {
        if (typeof err.stdout === 'string' && err.stdout.length > 0) return err.stdout;
        throw err;
      }
    }
    const oldGhExecFn = (cmd) => {
      if (cmd.includes('--json')) {
        const err = new Error('unknown flag: --json');
        err.stdout = '';
        throw err;
      }
      return '';
    };
    expect(() => execTolerant(oldGhExecFn, 'gh pr checks --json state')).toThrow('unknown flag: --json');
  });

  it('[B3-empty-statusCheckRollup] 空数组 statusCheckRollup → pending → resumed=0', async () => {
    // 修复后 fallback 到 pr view，但 statusCheckRollup 为空 → pending → 不重点火
    const prUrl = 'https://github.com/perfectuser21/cecelia/pull/777';
    const execFn = vi.fn((cmd) => {
      if (cmd === `gh pr view "${prUrl}" --json state`) return JSON.stringify({ state: 'OPEN' });
      // 现版本 state,mergeStateStatus 调用兼容
      if (cmd === `gh pr view "${prUrl}" --json state,mergeStateStatus`) {
        return JSON.stringify({ state: 'OPEN', mergeStateStatus: 'CLEAN' });
      }
      // 修复后调用 statusCheckRollup → 空数组
      if (cmd.includes('statusCheckRollup')) {
        return JSON.stringify({ statusCheckRollup: [], mergeStateStatus: 'CLEAN' });
      }
      // 老版 gh pr checks → 报错
      if (cmd.includes('gh pr checks') && cmd.includes('--json')) {
        const err = new Error('unknown flag: --json');
        err.stdout = '';
        throw err;
      }
      if (cmd.includes('docker ps')) return '';
      throw new Error(`Unexpected: ${cmd}`);
    });

    const run = buildOpenPrRun({ initiative_id: 'task-b3', pr_url: prUrl });
    const task = buildInProgressTask({ id: 'task-b3', pr_url: prUrl });
    const pool = buildFakePool({ runs: [run], task });
    const spawnFn = vi.fn(async () => ({ ok: true }));

    const out = await resumeStalledRelayRuns({ pool, execFn, spawnFn });

    // 无检查项 → pending → 不重点火（保守策略）
    expect(out.resumed).toBe(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// [BEHAVIOR] B2 — _parseBaseRepo zenithjoy-skills 路径映射
//
// FAILING 状态（修复前）：现版本映射表无 zenithjoy-skills，返回 null 或错误映射
// 修复后：精确返回 'perfectuser21/zenithjoy-skills'
// ══════════════════════════════════════════════════════════════════════════════
describe('[BEHAVIOR] B2 — _parseBaseRepo zenithjoy-skills 仓库映射', () => {
  it('[B2-exact] _parseBaseRepo zenithjoy-skills 路径返回 perfectuser21/zenithjoy-skills [FAILING]', () => {
    // 修复前 FAIL：返回 null 或 'perfectuser21/zenithjoy-workspace'
    // 修复后 PASS：返回 'perfectuser21/zenithjoy-skills'
    const result = _parseBaseRepo('/Users/administrator/perfect21/zenithjoy-skills');
    expect(result).toBe('perfectuser21/zenithjoy-skills');
  });

  it('[B2-no-workspace-regression] /workspace → cecelia 映射不变（回归）', () => {
    expect(_parseBaseRepo('/workspace')).toBe('perfectuser21/cecelia');
  });

  it('[B2-no-cecelia-regression] cecelia 路径映射不变（回归）', () => {
    expect(_parseBaseRepo('/Users/administrator/perfect21/cecelia')).toBe('perfectuser21/cecelia');
  });

  it('[B2-zenithjoy-workspace-regression] zenithjoy（非 skills）→ zenithjoy-workspace（回归）', () => {
    // 这是 zenithjoy 的原有映射，修复不得破坏
    expect(_parseBaseRepo('/Users/administrator/perfect21/zenithjoy')).toBe('perfectuser21/zenithjoy-workspace');
  });

  it('[B2-github-url-regression] GitHub URL 格式优先走 regex（回归）', () => {
    expect(_parseBaseRepo('https://github.com/perfectuser21/some-repo')).toBe('perfectuser21/some-repo');
  });

  it('[B2-null-input] 非字符串输入返回 null', () => {
    expect(_parseBaseRepo(null)).toBe(null);
    expect(_parseBaseRepo(undefined)).toBe(null);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// [REGRESSION] 既有 A1/A5/A2 行为回归保护
// ══════════════════════════════════════════════════════════════════════════════
describe('[REGRESSION] 既有 watchdog 行为回归保护', () => {
  it('[A1-reg] PR MERGED → 正常收口 mergedPr=1, resumed=0', async () => {
    const prUrl = 'https://github.com/perfectuser21/cecelia/pull/100';
    const execFn = vi.fn((cmd) => {
      if (cmd.includes('gh pr view') && cmd.includes('--json state') && !cmd.includes('statusCheckRollup')) {
        return JSON.stringify({ state: 'MERGED' });
      }
      if (cmd.includes('docker ps')) return '';
      throw new Error(`Unexpected: ${cmd}`);
    });

    const run = buildOpenPrRun({ initiative_id: 'task-reg-01', pr_url: prUrl });
    const task = buildInProgressTask({ id: 'task-reg-01', pr_url: prUrl });
    const pool = buildFakePool({ runs: [run], task });
    const spawnFn = vi.fn(async () => ({ ok: true }));

    const out = await resumeStalledRelayRuns({ pool, execFn, spawnFn });

    expect(out.mergedPr).toBe(1);
    expect(out.resumed).toBe(0);
  });

  it('[A5-reg] PR OPEN + CI pending（statusCheckRollup=[IN_PROGRESS]）→ resumed=0', async () => {
    // 修复后：老版 gh 报错 → fallback pr view → 返回 IN_PROGRESS → pending → 不重点火
    const prUrl = 'https://github.com/perfectuser21/cecelia/pull/200';
    const execFn = vi.fn((cmd) => {
      if (cmd === `gh pr view "${prUrl}" --json state`) {
        return JSON.stringify({ state: 'OPEN' });
      }
      // 现版本 state,mergeStateStatus 调用兼容
      if (cmd === `gh pr view "${prUrl}" --json state,mergeStateStatus`) {
        return JSON.stringify({ state: 'OPEN', mergeStateStatus: 'BLOCKED' });
      }
      // 修复后调用 statusCheckRollup → IN_PROGRESS → pending
      if (cmd.includes('statusCheckRollup')) {
        return JSON.stringify({
          statusCheckRollup: [{ name: 'CI / test', state: 'IN_PROGRESS' }],
          mergeStateStatus: 'BLOCKED',
        });
      }
      // 老版 gh pr checks → 报错
      if (cmd.includes('gh pr checks') && cmd.includes('--json')) {
        const err = new Error('unknown flag: --json');
        err.stdout = '';
        throw err;
      }
      if (cmd.includes('docker ps')) return '';
      throw new Error(`Unexpected: ${cmd}`);
    });

    const run = buildOpenPrRun({ initiative_id: 'task-reg-02', pr_url: prUrl });
    const task = buildInProgressTask({ id: 'task-reg-02', pr_url: prUrl });
    const pool = buildFakePool({ runs: [run], task });
    const spawnFn = vi.fn(async () => ({ ok: true }));

    const out = await resumeStalledRelayRuns({ pool, execFn, spawnFn });

    expect(out.resumed).toBe(0);
  });

  it('[A2-reg] 无 PR URL + 容器消失 + GitHub 发现 MERGED PR → mergedPr=1', async () => {
    // 验证：GitHub 反查发现 MERGED PR 时正确收口（mergedPr+1）而非重点火
    const discoverUrl = 'https://github.com/perfectuser21/cecelia/pull/300';
    const execFn = vi.fn((cmd) => {
      if (cmd.includes('docker ps')) return '';
      // gh pr list（PR 发现）→ 返回一条 MERGED PR
      // headRefName 必须包含 shortId('task-reg-03') = 'taskreg0'
      if (cmd.includes('gh pr list') && cmd.includes('--json headRefName')) {
        return JSON.stringify([{
          headRefName: 'cp-taskreg0-ws-taskreg03',
          title: '[taskreg0] test task',
          url: discoverUrl,
          state: 'MERGED',
        }]);
      }
      throw new Error(`Unexpected: ${cmd}`);
    });

    const run = buildOpenPrRun({ initiative_id: 'task-reg-03', pr_url: null });
    const task = buildInProgressTask({
      id: 'task-reg-03',
      pr_url: null,
      payload: { orchestrator: 'skill-relay', base_repo: '/Users/administrator/perfect21/cecelia' },
    });
    const pool = buildFakePool({ runs: [run], task });
    const spawnFn = vi.fn(async () => ({ ok: true }));

    const out = await resumeStalledRelayRuns({ pool, execFn, spawnFn });

    // 发现 MERGED PR → 收口 mergedPr=1，不重点火
    expect(out.mergedPr).toBe(1);
    expect(out.resumed).toBe(0);
    expect(spawnFn).not.toHaveBeenCalled();
  });
});
