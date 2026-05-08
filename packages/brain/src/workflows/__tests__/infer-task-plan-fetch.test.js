import { describe, it, expect, vi, beforeEach } from 'vitest';

// Use vi.hoisted so variables are available inside vi.mock factory (which is hoisted)
const { execSyncCalls, getExecSyncImpl, setExecSyncImpl } = vi.hoisted(() => {
  const execSyncCalls = [];
  let execSyncImpl = null;
  return {
    execSyncCalls,
    getExecSyncImpl: () => execSyncImpl,
    setExecSyncImpl: (fn) => { execSyncImpl = fn; },
  };
});

const mockExecSync = (cmd, opts) => {
  execSyncCalls.push({ cmd, cwd: opts?.cwd });
  const impl = getExecSyncImpl();
  if (impl) return impl(cmd, opts);
  throw new Error('execSyncImpl not set');
};

// Mock both 'child_process' and 'node:child_process' to cover:
//   harness-initiative.graph.js  → dynamic import('child_process')
//   harness-worktree.js          → import { execFile } from 'node:child_process'
vi.mock('child_process', () => ({
  execSync: (cmd, opts) => {
    execSyncCalls.push({ cmd, cwd: opts?.cwd });
    const impl = getExecSyncImpl();
    if (impl) return impl(cmd, opts);
    throw new Error('execSyncImpl not set');
  },
  execFile: (_cmd, _args, _opts, cb) => {
    if (typeof cb === 'function') cb(null, '', '');
  },
}));

vi.mock('node:child_process', () => ({
  execSync: (cmd, opts) => {
    execSyncCalls.push({ cmd, cwd: opts?.cwd });
    const impl = getExecSyncImpl();
    if (impl) return impl(cmd, opts);
    throw new Error('execSyncImpl not set');
  },
  execFile: (_cmd, _args, _opts, cb) => {
    if (typeof cb === 'function') cb(null, '', '');
  },
}));

import { inferTaskPlanNode } from '../harness-initiative.graph.js';

const baseState = {
  worktreePath: '/tmp/fake-worktree',
  initiativeId: 'init-aaaa',
  task: { payload: { sprint_dir: 'sprints/test' } },
  ganResult: { propose_branch: 'cp-harness-propose-r1-deadbeef' },
};

const validTaskPlan = JSON.stringify({
  initiative_id: 'init-aaaa',
  journey_type: 'autonomous',
  journey_type_reason: 'test',
  tasks: [{ task_id: 'ws1', title: 't', scope: 's', dod: ['[BEHAVIOR] x'], files: ['a.js'], depends_on: [], complexity: 'S', estimated_minutes: 30 }],
});

describe('inferTaskPlanNode git fetch [BEHAVIOR]', () => {
  beforeEach(() => {
    execSyncCalls.length = 0;
    setExecSyncImpl(null);
  });

  it('git fetch origin <branch> 必须在 git show 之前 call', async () => {
    setExecSyncImpl((cmd) => {
      if (cmd.startsWith('git fetch')) return '';
      if (cmd.startsWith('git show')) return validTaskPlan;
      throw new Error('unexpected: ' + cmd);
    });
    const result = await inferTaskPlanNode(baseState);
    expect(execSyncCalls.length).toBeGreaterThanOrEqual(2);
    expect(execSyncCalls[0].cmd).toBe('git fetch origin cp-harness-propose-r1-deadbeef');
    expect(execSyncCalls[1].cmd).toContain('git show origin/cp-harness-propose-r1-deadbeef');
    expect(result.taskPlan).toBeDefined();
    expect(result.taskPlan.tasks.length).toBe(1);
  });

  it('fetch 失败 graceful warn 不阻塞，继续走 git show', async () => {
    setExecSyncImpl((cmd) => {
      if (cmd.startsWith('git fetch')) throw new Error('fatal: could not read from remote');
      if (cmd.startsWith('git show')) return validTaskPlan;
      throw new Error('unexpected: ' + cmd);
    });
    const result = await inferTaskPlanNode(baseState);
    expect(execSyncCalls.length).toBe(2);
    expect(execSyncCalls[1].cmd).toContain('git show');
    expect(result.taskPlan).toBeDefined();
  });

  it('fetch 在正确的 worktreePath cwd 跑', async () => {
    setExecSyncImpl((cmd) => {
      if (cmd.startsWith('git fetch')) return '';
      if (cmd.startsWith('git show')) return validTaskPlan;
      throw new Error('unexpected: ' + cmd);
    });
    await inferTaskPlanNode(baseState);
    expect(execSyncCalls[0].cwd).toBe('/tmp/fake-worktree');
  });
});
