/**
 * run.js CLI 入口单测：parseArgs 解析契约。
 * buildRealDeps/main 组装真实 pg/execSync，不在单测覆盖（--dry-run 冒烟见 scripts/smoke/orchestrator-smoke.sh）。
 */
import { describe, it, expect } from 'vitest';
import { parseArgs } from '../run.js';

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
