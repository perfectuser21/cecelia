/**
 * run.js CLI 入口单测：parseArgs 解析契约。
 * buildRealDeps/main 组装真实 pg/execSync，不在单测覆盖（--dry-run 冒烟见 scripts/smoke/orchestrator-smoke.sh）。
 */
import { describe, it, expect, vi } from 'vitest';
import { buildRealDeps, parseArgs } from '../run.js';

describe('parseArgs', () => {
  it('--task-id 必填，缺失即抛用法错误', () => {
    expect(() => parseArgs([])).toThrow(/--task-id/);
  });

  it('解析 --task-id / --run-id / --dry-run', () => {
    const a = parseArgs(['--task-id', 'T1', '--run-id', 'R1', '--dry-run']);
    expect(a).toEqual({ taskId: 'T1', runId: 'R1', dryRun: true });
  });

  it('默认 dryRun=false、runId=null', () => {
    const a = parseArgs(['--task-id', 'T1']);
    expect(a).toEqual({ taskId: 'T1', runId: null, dryRun: false });
  });
});

describe('buildRealDeps', () => {
  it('组装真实 dispatcher，不再返回 T3 NotImplemented 占位', async () => {
    const dispatch = vi.fn();
    const deps = await buildRealDeps({
      pool: { query: vi.fn() },
      dispatch,
      execCmd: vi.fn(),
      fileExists: vi.fn(),
      readFile: vi.fn(),
    });

    expect(deps.dispatch).toBe(dispatch);
    expect(String(deps.dispatch)).not.toContain('NotImplemented');
  });
});
