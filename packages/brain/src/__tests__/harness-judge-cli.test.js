/**
 * N3：harness-judge-cli.mjs 单测 —— runJudgeGate 的 thin CLI wrapper。
 * harness-controller skill Step 5 调用：exit 0=PASS / 2=FAIL / 1=用法或执行错误。
 * main(argv, deps) 注入 judgeGateFn/readFileFn，不真调 DeepSeek。
 */
import { describe, it, expect, vi } from 'vitest';
import { main, parseCliArgs } from '../../../../scripts/harness-judge-cli.mjs';

const BASE_ARGS = ['--task-id', 't-1', '--sprint-dir', 'sprints/x', '--worktree', '/tmp/wt'];

function makeDeps(overrides = {}) {
  return {
    judgeGateFn: vi.fn().mockResolvedValue({ verdict: 'PASS', feedback: null, judged: true }),
    readFileFn: vi.fn().mockResolvedValue(JSON.stringify({ verdict: 'PASS', feedback: 'agent ok' })),
    log: vi.fn(),
    ...overrides,
  };
}

describe('parseCliArgs', () => {
  it('必填缺失 → throw 用法错误', () => {
    expect(() => parseCliArgs(['--task-id', 't-1'])).toThrow(/--sprint-dir|--worktree|用法/);
  });
  it('全参解析', () => {
    const a = parseCliArgs([...BASE_ARGS, '--agent-verdict', 'PASS', '--prompt-dir', '/p']);
    expect(a).toMatchObject({ taskId: 't-1', sprintDir: 'sprints/x', worktree: '/tmp/wt', agentVerdict: 'PASS', promptDir: '/p' });
  });
});

describe('main', () => {
  it('judge PASS → exit 0，stdout JSON 含 verdict', async () => {
    const deps = makeDeps();
    const code = await main([...BASE_ARGS, '--agent-verdict', 'PASS'], deps);
    expect(code).toBe(0);
    const out = deps.log.mock.calls.map((c) => c[0]).join('\n');
    expect(JSON.parse(out.split('\n').pop())).toMatchObject({ verdict: 'PASS', judged: true });
  });

  it('judge FAIL → exit 2', async () => {
    const deps = makeDeps({
      judgeGateFn: vi.fn().mockResolvedValue({ verdict: 'FAIL', feedback: '步骤3未覆盖', judged: true }),
    });
    const code = await main([...BASE_ARGS, '--agent-verdict', 'PASS'], deps);
    expect(code).toBe(2);
  });

  it('agent-verdict 缺省 → 从 worktree/.brain-result.json 读（含 FIXED 归一 PASS）', async () => {
    const deps = makeDeps({
      readFileFn: vi.fn().mockResolvedValue(JSON.stringify({ verdict: 'FIXED', feedback: 'f' })),
    });
    const code = await main(BASE_ARGS, deps);
    expect(code).toBe(0);
    // FIXED 归一为 PASS 后才进 judge（judge 只对 PASS 生效——前科语义）
    expect(deps.judgeGateFn.mock.calls[0][0].agentVerdict).toBe('PASS');
  });

  it('agent verdict 非 PASS → 透传 FAIL、judged=false、exit 2（judge 不烧钱）', async () => {
    const deps = makeDeps();
    const code = await main([...BASE_ARGS, '--agent-verdict', 'FAIL'], deps);
    expect(code).toBe(2);
    // runJudgeGate 内部对非 PASS 透传（本 CLI 直接传入让其透传，judgeGateFn 收到 FAIL）
    expect(deps.judgeGateFn.mock.calls[0][0].agentVerdict).toBe('FAIL');
  });

  it('judgeGateFn 抛错 → exit 1', async () => {
    const deps = makeDeps({ judgeGateFn: vi.fn().mockRejectedValue(new Error('deepseek down')) });
    const code = await main([...BASE_ARGS, '--agent-verdict', 'PASS'], deps);
    expect(code).toBe(1);
  });

  it('brain-result 缺失且未给 --agent-verdict → exit 1 带清晰错误', async () => {
    const deps = makeDeps({ readFileFn: vi.fn().mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' })) });
    const code = await main(BASE_ARGS, deps);
    expect(code).toBe(1);
  });
});
