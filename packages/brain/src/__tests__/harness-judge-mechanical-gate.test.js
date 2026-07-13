import { describe, it, expect, vi } from 'vitest';
import { runMechanicalGate, runJudgeGate } from '../harness-judge.js';

function goodCtx(overrides = {}) {
  return {
    taskId: 'task-1111',
    worktreePath: '/wt',
    sprintDir: 'sprints/x',
    brainResult: { verdict: 'PASS', exit_code: 0, log_tail: 'npm test ok', judgments_written: 2, ...(overrides.brainResult || {}) },
    ...overrides,
  };
}

function makeDeps({ testFiles = ['a.test.ts'], behaviorCount = 3, env = 'local_api', judgmentRows = 2 } = {}) {
  return {
    listTestFilesFn: vi.fn(async () => testFiles),
    readFileFn: vi.fn(async (p) => {
      if (String(p).includes('contract-dod')) return Array(behaviorCount).fill('- [ ] [BEHAVIOR] x').join('\n');
      throw new Error('ENOENT');
    }),
    dbPool: { query: vi.fn(async (sql) => {
      if (/FROM tasks/.test(sql)) return { rows: [{ target_environment: env }] };
      if (/COUNT.*FROM decisions/is.test(sql)) return { rows: [{ count: judgmentRows }] };
      return { rows: [] };
    }) },
  };
}

describe('runMechanicalGate（刀B：DeepSeek 前纯代码闸）', () => {
  it('全部合规 → pass:true', async () => {
    const r = await runMechanicalGate(goodCtx(), makeDeps());
    expect(r.pass).toBe(true);
  });
  it('behavior_tests=0（无测试文件且 contract-dod 无 [BEHAVIOR]）→ FAIL', async () => {
    const deps = makeDeps({ testFiles: [] });
    deps.readFileFn = vi.fn(async () => { throw new Error('ENOENT'); });
    const r = await runMechanicalGate(goodCtx(), deps);
    expect(r.pass).toBe(false);
    expect(r.reasons.join()).toMatch(/behavior_tests/);
  });
  it('.brain-result.json 缺 exit_code → FAIL', async () => {
    const ctx = goodCtx(); delete ctx.brainResult.exit_code;
    const r = await runMechanicalGate(ctx, makeDeps());
    expect(r.pass).toBe(false);
    expect(r.reasons.join()).toMatch(/exit_code/);
  });
  it('local_api 环境 log_tail 空但有命令输出（agentStdout）→ 不误杀', async () => {
    const ctx = goodCtx({ agentStdout: '$ npm test\nall pass' }); ctx.brainResult.log_tail = '';
    const r = await runMechanicalGate(ctx, makeDeps({ env: 'local_api' }));
    expect(r.pass).toBe(true);
  });
  it('windows_wechat 真机环境 log_tail 空 → FAIL', async () => {
    const ctx = goodCtx({ agentStdout: 'x' }); ctx.brainResult.log_tail = '';
    const r = await runMechanicalGate(ctx, makeDeps({ env: 'windows_wechat' }));
    expect(r.pass).toBe(false);
  });
  it('judgments_written=5 声明 > decisions 回读 0 → FAIL', async () => {
    const ctx = goodCtx(); ctx.brainResult.judgments_written = 5;
    const r = await runMechanicalGate(ctx, makeDeps({ judgmentRows: 0 }));
    expect(r.pass).toBe(false);
    expect(r.reasons.join()).toMatch(/judgments/);
  });
  it('judgments_written 非数字声明（如 "abc"）→ FAIL 不静默放行', async () => {
    const ctx = goodCtx(); ctx.brainResult.judgments_written = 'abc';
    const r = await runMechanicalGate(ctx, makeDeps({ judgmentRows: 0 }));
    expect(r.pass).toBe(false);
    expect(r.reasons.join()).toMatch(/judgments/);
  });
  it('无 judgments_written 声明 → 跳过不 FAIL', async () => {
    const ctx = goodCtx(); delete ctx.brainResult.judgments_written;
    const r = await runMechanicalGate(ctx, makeDeps({ judgmentRows: 0 }));
    expect(r.pass).toBe(true);
  });
  it('target_environment 查不到 → 缺省 local_api 最宽口径', async () => {
    const deps = makeDeps();
    deps.dbPool.query = vi.fn(async (sql) => {
      if (/FROM tasks/.test(sql)) return { rows: [] };
      if (/COUNT.*FROM decisions/is.test(sql)) return { rows: [{ count: 2 }] };
      return { rows: [] };
    });
    const ctx = goodCtx({ agentStdout: 'cmd out' }); ctx.brainResult.log_tail = '';
    const r = await runMechanicalGate(ctx, deps);
    expect(r.pass).toBe(true);
  });
});

describe('runJudgeGate 接线：机械闸 FAIL → 不调 DeepSeek', () => {
  it('behavior_tests=0 时 judgeFn 零调用且 verdict=FAIL judged=true', async () => {
    const judgeFn = vi.fn();
    const r = await runJudgeGate(
      { agentVerdict: 'PASS', worktreePath: '/wt', sprintDir: 'sprints/x', taskId: 't1',
        brainResult: { verdict: 'PASS', exit_code: 0, log_tail: 'ok' } },
      {
        judgeFn,
        listTestFilesFn: async () => [],
        collectEvidence: async () => ({ contractE2E: 'e2e', goldenPathSteps: ['s1'], transcript: '', agentStdout: '', brainResult: { verdict: 'PASS', exit_code: 0, log_tail: 'ok' } }),
        readFileFn: async () => { throw new Error('ENOENT'); },
        dbPool: { query: async () => ({ rows: [] }) },
        writeFileFn: async () => {},
      }
    );
    expect(r.verdict).toBe('FAIL');
    expect(r.judged).toBe(true);
    expect(judgeFn).not.toHaveBeenCalled();
  });
  it('agentVerdict=FAIL 直接透传（机械闸只管 PASS 复核路径）', async () => {
    const r = await runJudgeGate({ agentVerdict: 'FAIL', agentFeedback: 'x' }, {});
    expect(r.verdict).toBe('FAIL');
    expect(r.judged).toBe(false);
  });
});
