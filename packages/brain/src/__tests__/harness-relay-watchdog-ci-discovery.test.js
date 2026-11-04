// 真实watchdog隔离合同；只验证委托，不宣称旧relay已恢复或DB持久化。
import { describe, it, expect, vi } from 'vitest';
import { makeDeps, TASK_ID, RUN_ID, SHORT, PR_URL } from './helpers/relay-watchdog-fixture.js';
import { resumeStalledRelayRuns, _finalizeMergedRun, _parseBaseRepo } from '../harness-relay-watchdog.js';

describe('刀A5 — execTolerant 兜底路径（GP-A：resume_ci_red）', () => {
  it('GP-A: gh pr checks 非零退出 + err.stdout 含 FAILURE JSON → execTolerant 兜底 → ciStatus=fail → spawnFn 调用一次', async () => {
    const deps = makeDeps({ prUrl: PR_URL, prState: 'OPEN', mergeStateStatus: 'CLEAN' });
    // 覆盖 execFn：让 gh pr checks 抛 err（携带 FAILURE stdout），其余命令正常
    deps.execFn = vi.fn().mockImplementation((cmd) => {
      if (/docker ps/.test(cmd)) return '';
      if (/gh pr view/.test(cmd) && /mergeStateStatus/.test(cmd)) {
        return JSON.stringify({ state: 'OPEN', mergeStateStatus: 'CLEAN' });
      }
      if (/gh pr view/.test(cmd)) {
        return JSON.stringify({ state: 'OPEN' });
      }
      if (/gh pr checks/.test(cmd)) {
        const err = new Error('Command failed: gh pr checks exit code 1');
        err.stdout = JSON.stringify([{ name: 'brain-ci', state: 'FAILURE' }]);
        err.stderr = '';
        err.status = 1;
        throw err;
      }
      return '';
    });

    const r = await resumeStalledRelayRuns(deps);

    expect(deps.spawnFn).toHaveBeenCalledOnce();
    expect(r.resumed).toBe(1);
    const checksCalled = deps.execFn.mock.calls.some(([cmd]) => /gh pr checks/.test(cmd));
    expect(checksCalled).toBe(true);
  });
});

describe('刀A5 — execTolerant 兜底路径（GP-B：wait_ci_running）', () => {
  it('GP-B: gh pr checks 非零退出 + err.stdout 全 pending JSON → execTolerant 兜底 → ciStatus=pending → spawnFn 不调用', async () => {
    const deps = makeDeps({ prUrl: PR_URL, prState: 'OPEN', mergeStateStatus: 'CLEAN' });
    deps.execFn = vi.fn().mockImplementation((cmd) => {
      if (/docker ps/.test(cmd)) return '';
      if (/gh pr view/.test(cmd) && /mergeStateStatus/.test(cmd)) {
        return JSON.stringify({ state: 'OPEN', mergeStateStatus: 'CLEAN' });
      }
      if (/gh pr view/.test(cmd)) {
        return JSON.stringify({ state: 'OPEN' });
      }
      if (/gh pr checks/.test(cmd)) {
        const err = new Error('Command failed: gh pr checks exit code 8');
        err.stdout = JSON.stringify([{ name: 'brain-ci', state: 'IN_PROGRESS' }]);
        err.stderr = '';
        err.status = 8;
        throw err;
      }
      return '';
    });

    const r = await resumeStalledRelayRuns(deps);

    expect(deps.spawnFn).not.toHaveBeenCalled();
    expect(r.resumed).toBe(0);
    const checksCalled = deps.execFn.mock.calls.some(([cmd]) => /gh pr checks/.test(cmd));
    expect(checksCalled).toBe(true);
  });
});

describe('刀A5 — execTolerant 兜底路径（GP-C：skip_query_failure）', () => {
  it('GP-C: gh pr checks 非零退出 + 无 stdout 属性 → execTolerant rethrow → 外层 catch 保守跳过 → spawnFn 不调用', async () => {
    const deps = makeDeps({ prUrl: PR_URL, prState: 'OPEN', mergeStateStatus: 'CLEAN' });
    deps.execFn = vi.fn().mockImplementation((cmd) => {
      if (/docker ps/.test(cmd)) return '';
      if (/gh pr view/.test(cmd) && /mergeStateStatus/.test(cmd)) {
        return JSON.stringify({ state: 'OPEN', mergeStateStatus: 'CLEAN' });
      }
      if (/gh pr view/.test(cmd)) {
        return JSON.stringify({ state: 'OPEN' });
      }
      if (/gh pr checks/.test(cmd)) {
        // 无 stdout：模拟真实网络/auth 失败，execTolerant 应 rethrow
        const err = new Error('gh: authentication token not found');
        err.stdout = '';
        throw err;
      }
      return '';
    });

    const r = await resumeStalledRelayRuns(deps);

    expect(deps.spawnFn).not.toHaveBeenCalled();
    expect(r.resumed).toBe(0);
  });
});

describe('刀A2 — generator_done + pr_url 空 反查修复', () => {
  // ── [BEHAVIOR-2] _parseBaseRepo 路径映射 ────────────────────────────────

  describe('[BEHAVIOR-2] _parseBaseRepo 支持宿主机/容器绝对路径', () => {
    it('TC-2: /Users/administrator/perfect21/cecelia → perfectuser21/cecelia', () => {
      expect(_parseBaseRepo('/Users/administrator/perfect21/cecelia')).toBe('perfectuser21/cecelia');
    });

    it('TC-3: /workspace → perfectuser21/cecelia', () => {
      expect(_parseBaseRepo('/workspace')).toBe('perfectuser21/cecelia');
    });

    it('TC-9: URL 格式 base_repo 优先于路径映射（原逻辑不变）', () => {
      expect(_parseBaseRepo('https://github.com/org/repo')).toBe('org/repo');
    });

    it('null → null（原行为不变）', () => {
      expect(_parseBaseRepo(null)).toBeNull();
    });

    it('TC-4: HARNESS_REPO_MAP env 覆盖', () => {
      const orig = process.env.HARNESS_REPO_MAP;
      try {
        process.env.HARNESS_REPO_MAP = JSON.stringify({ 'custom/path': 'myorg/myrepo' });
        expect(_parseBaseRepo('custom/path')).toBe('myorg/myrepo');
      } finally {
        if (orig === undefined) delete process.env.HARNESS_REPO_MAP;
        else process.env.HARNESS_REPO_MAP = orig;
      }
    });

    it('TC-5: 不识别非映射路径 → null', () => {
      expect(_parseBaseRepo('random-string')).toBeNull();
    });
  });

  // ── [BEHAVIOR-1] generator_done + pr_url 空 + 反查 MERGED ────────────────

  describe('[BEHAVIOR-1] generator_done=true + pr_url=null + 反查 MERGED → _finalizeMergedRun 被调', () => {
    it('TC-1: discovered MERGED → mergedPr=1，不 spawn，日志含 discovered_merged_via_fallback', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      try {
        const DISCOVERED_PR = 'https://github.com/perfectuser21/cecelia/pull/1';
        const pool = { query: vi.fn() };
        pool.query.mockImplementation(async (sql) => {
          if (/FROM initiative_runs r/.test(sql)) {
            return {
              rows: [{
                id: RUN_ID,
                initiative_id: TASK_ID,
                current_task_id: TASK_ID,
                phase: 'planning',
                attempts: '1',
                deadline_at: new Date(Date.now() + 3600e3).toISOString(),
                pr_url: null,
                orchestrator_host: 'skill-relay-session',
              }],
            };
          }
          if (/FROM tasks/.test(sql)) {
            return {
              rows: [{
                id: TASK_ID,
                status: 'in_progress',
                title: 't',
                pr_url: null,
                payload: {
                  orchestrator: 'skill-relay',
                  generator_done: true,
                  base_repo: '/Users/administrator/perfect21/cecelia',
                },
              }],
            };
          }
          if (/FROM initiative_run_events/.test(sql)) {
            return { rows: [{ x: 1 }] }; // evaluator gated
          }
          return { rows: [] };
        });

        const spawnFn = vi.fn().mockResolvedValue({ ok: true });
        const execFn = vi.fn().mockImplementation((cmd) => {
          if (/docker ps/.test(cmd)) return '';
          // _discoverPrFromGithub → gh pr list
          if (/gh pr list/.test(cmd)) {
            return JSON.stringify([
              { headRefName: `cp-07150000-ws-${SHORT.slice(0, 8)}`, title: 't', url: DISCOVERED_PR, state: 'MERGED' },
            ]);
          }
          return '';
        });

        const out = await resumeStalledRelayRuns({ pool, execFn, spawnFn });

        // spawnFn 不得被调用
        expect(spawnFn).not.toHaveBeenCalled();
        // mergedPr 计数
        expect(out.mergedPr).toBe(1);
        // pool.query 含 UPDATE initiative_runs ... 'done'
        const sqls = pool.query.mock.calls.map(c => c[0]);
        expect(sqls.some(s => /UPDATE initiative_runs/.test(s) && /'done'/.test(s))).toBe(true);
        // pool.query 含 UPDATE tasks ... 'completed'
        expect(sqls.some(s => /UPDATE tasks/.test(s) && /'completed'/.test(s))).toBe(true);
        // console.log 含 discovered_merged_via_fallback
        const logMessages = consoleSpy.mock.calls.map(c => c.join(' '));
        expect(logMessages.some(m => m.includes('discovered_merged_via_fallback'))).toBe(true);
      } finally {
        consoleSpy.mockRestore();
      }
    });
  });

  // ── [BEHAVIOR-3] generator_done + pr_url 空 + 反查 OPEN → 回写 pr_url ─────

  describe('[BEHAVIOR-3] generator_done=true + pr_url=null + 反查 OPEN → 回写 pr_url，不 spawn', () => {
    it('TC-5: discovered OPEN → UPDATE initiative_runs SET pr_url，spawnFn 不调，resumed=0', async () => {
      const OPEN_PR = 'https://github.com/x/y/pull/2';
      const pool = { query: vi.fn() };
      pool.query.mockImplementation(async (sql) => {
        if (/FROM initiative_runs r/.test(sql)) {
          return {
            rows: [{
              id: RUN_ID,
              initiative_id: TASK_ID,
              current_task_id: TASK_ID,
              phase: 'planning',
              attempts: '1',
              deadline_at: new Date(Date.now() + 3600e3).toISOString(),
              pr_url: null,
              orchestrator_host: 'skill-relay-session',
            }],
          };
        }
        if (/FROM tasks/.test(sql)) {
          return {
            rows: [{
              id: TASK_ID,
              status: 'in_progress',
              title: 't',
              pr_url: null,
              payload: {
                orchestrator: 'skill-relay',
                generator_done: true,
                base_repo: '/Users/administrator/perfect21/cecelia',
              },
            }],
          };
        }
        return { rows: [] };
      });

      const spawnFn = vi.fn().mockResolvedValue({ ok: true });
      const execFn = vi.fn().mockImplementation((cmd) => {
        if (/docker ps/.test(cmd)) return '';
        if (/gh pr list/.test(cmd)) {
          return JSON.stringify([
            { headRefName: `cp-07150000-ws-${SHORT.slice(0, 8)}`, title: 't', url: OPEN_PR, state: 'OPEN' },
          ]);
        }
        return '';
      });

      const out = await resumeStalledRelayRuns({ pool, execFn, spawnFn });

      // spawnFn 不得被调用
      expect(spawnFn).not.toHaveBeenCalled();
      // resumed=0
      expect(out.resumed).toBe(0);
      // UPDATE initiative_runs SET pr_url
      const sqls = pool.query.mock.calls.map(c => c[0]);
      expect(sqls.some(s => /UPDATE initiative_runs SET pr_url/.test(s))).toBe(true);
      // 参数含目标 PR URL
      const prUrlUpdateCall = pool.query.mock.calls.find(c => /UPDATE initiative_runs SET pr_url/.test(c[0]));
      expect(prUrlUpdateCall).toBeTruthy();
      expect(prUrlUpdateCall[1]).toContain(OPEN_PR);
    });
  });

  // ── [BEHAVIOR-4] generator_done 超时兜底不变 ──────────────────────────────

  describe('[BEHAVIOR-4] generator_done 超时兜底语义不变', () => {
    it('TC-8: doneAt 超期 + 无 PR → phase=failed, failure_reason=generator_done_timeout，不 spawn', async () => {
      const pool = { query: vi.fn() };
      pool.query.mockImplementation(async (sql) => {
        if (/FROM initiative_runs r/.test(sql)) {
          return {
            rows: [{
              id: RUN_ID,
              initiative_id: TASK_ID,
              current_task_id: TASK_ID,
              phase: 'planning',
              attempts: '1',
              // 已过期 deadline（7h 前）
              deadline_at: new Date(Date.now() + 3600e3).toISOString(),
              pr_url: null,
              orchestrator_host: 'skill-relay-session',
              started_at: new Date(Date.now() - 7 * 3600e3).toISOString(),
            }],
          };
        }
        if (/FROM tasks/.test(sql)) {
          return {
            rows: [{
              id: TASK_ID,
              status: 'in_progress',
              title: 't',
              pr_url: null,
              payload: {
                orchestrator: 'skill-relay',
                generator_done: true,
                // generator_done_at 设为 7h 前
                generator_done_at: new Date(Date.now() - 7 * 3600e3).toISOString(),
                base_repo: '/workspace',
              },
            }],
          };
        }
        return { rows: [] };
      });

      const spawnFn = vi.fn();
      const execFn = vi.fn().mockImplementation((cmd) => {
        if (/docker ps/.test(cmd)) return '';
        if (/gh pr list/.test(cmd)) return JSON.stringify([]);
        return '';
      });

      const out = await resumeStalledRelayRuns({ pool, execFn, spawnFn });

      // 不 spawn
      expect(spawnFn).not.toHaveBeenCalled();
      // capped=1
      expect(out.capped).toBe(1);
      // SQL 含 phase='failed' + failure_reason='generator_done_timeout'
      const sqls = pool.query.mock.calls.map(c => c[0]);
      expect(sqls.some(s => /UPDATE initiative_runs SET phase='failed'/.test(s) && /generator_done_timeout/.test(s))).toBe(true);
    });
  });
});
