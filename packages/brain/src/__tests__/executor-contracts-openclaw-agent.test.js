/**
 * executor-contracts-openclaw-agent.test.js
 *
 * openclaw-agent 执行体合同（Task 6）：Brain 经 ssh 在 MMV(us-mac-m4) 起的
 * `openclaw agent` 进程。活性：远端 ~/brain-runs/<run_id>.exit 存在 → 已结束
 * （dead，等收割）；不存在但 .pid 存活 → alive；ssh 拿不到答案 → unknown
 * （fail-open）；缺 run_id → unknown，不发 ssh（不拿不完整信息瞎猜）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// 终审 I6：executor-contracts.js 的 SSH_BASE_ARGS 改从中立模块 lib/ssh-args.js
// import（不再经 notion-push-sync.js），不再拖带 ops-collector.js/host-exec.js/
// work-routing-store.js 那条重依赖链，mock 收窄回只需要本文件真正用到的
// execFileSync（executor-contracts.js 顶部还有一个 `import { execSync } from
// 'child_process'`，docker probe 用，与本文件的 openclaw-agent probe 无关，
// 不需要在这里 mock）。
vi.mock('node:child_process', () => ({ execFileSync: vi.fn() }));
import { execFileSync } from 'node:child_process';
import { EXECUTOR_CONTRACTS, EXECUTOR_KIND_FOR, VALID_EXECUTOR_KINDS, assessTaskLiveness } from '../executor-contracts.js';

const task = (over = {}) => ({
  id: 'aaaaaaaa-0000-0000-0000-000000000009', status: 'in_progress', executor_kind: 'openclaw-agent',
  updated_at: new Date(Date.now() - 50 * 60000).toISOString(),
  last_attempt_at: new Date(Date.now() - 50 * 60000).toISOString(),
  payload: { run_id: 'notion-abc-1' }, ...over,
});

describe('openclaw-agent 合同', () => {
  beforeEach(() => vi.clearAllMocks());

  it('登记为合法 executor_kind，且 qiumi_task 打标为它', () => {
    expect(VALID_EXECUTOR_KINDS).toContain('openclaw-agent');
    expect(EXECUTOR_KIND_FOR.qiumi_task).toBe('openclaw-agent');
    expect(EXECUTOR_KIND_FOR.__bridge_path).toBe('bridge'); // sentinel 保留
    expect(EXECUTOR_CONTRACTS['openclaw-agent']).toMatchObject({ staleMinutes: 45, onStale: 'fail' });
  });

  it('远端 .exit 已落 → dead（进程结束，等收割）', async () => {
    execFileSync.mockReturnValue('0\n');
    const r = await EXECUTOR_CONTRACTS['openclaw-agent'].probe(task(), {});
    expect(r).toBe('dead');
    const [cmd, args] = execFileSync.mock.calls[0];
    expect(cmd).toBe('ssh');
    expect(args.at(-2)).toBe('administrator@100.71.151.105');
    expect(args.at(-1)).toContain('brain-runs/notion-abc-1.exit');
  });

  it('远端无 .exit 但 pid 存活 → alive', async () => {
    execFileSync.mockReturnValue('RUNNING\n');
    expect(await EXECUTOR_CONTRACTS['openclaw-agent'].probe(task(), {})).toBe('alive');
  });

  it('ssh 报错 → unknown（fail-open）', async () => {
    execFileSync.mockImplementation(() => { throw new Error('ssh: connect timeout'); });
    expect(await EXECUTOR_CONTRACTS['openclaw-agent'].probe(task(), {})).toBe('unknown');
  });

  it('缺 run_id → unknown，不发 ssh', async () => {
    expect(await EXECUTOR_CONTRACTS['openclaw-agent'].probe(task({ payload: {} }), {})).toBe('unknown');
    expect(execFileSync).not.toHaveBeenCalled();
  });

  it('assessTaskLiveness 对 dead 返回 onStale=fail', async () => {
    execFileSync.mockReturnValue('1\n');
    const v = await assessTaskLiveness(task(), {});
    expect(v.verdict).toBe('dead');
    expect(v.onStale).toBe('fail');
  });
});
