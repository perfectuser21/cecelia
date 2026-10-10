// 此执行器测试注入模拟传输；真实隔离入口由 runtime-isolation.test.js 验证。
vi.mock('../../../packages/brain/src/runtime-safety.js', () => ({ assertExternalExecutionAllowed: () => {} }));
import { describe, expect, it, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const runner = path.join(repoRoot, 'packages/brain/scripts/cecelia-run.sh');
const taskId = '00000000-0000-4000-8000-00000000cafe';

describe('machine launch provenance command contract', () => {
  it('cecelia-run dry-run 输出 machine provenance 三字段并调用 launcher', () => {
    const result = spawnSync(
      'bash',
      [runner, '--dry-run', taskId, 'checkpoint-contract', '/tmp/prompt-contract'],
      { cwd: repoRoot, encoding: 'utf8', env: process.env }
    );
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('claude-launch.sh');
    expect(result.stdout).toContain('CECELIA_DISPATCH=1');
    expect(result.stdout).toContain('CECELIA_LAUNCHED_BY=cecelia-run');
    expect(result.stdout).toContain(`HARNESS_TASK_ID=${taskId}`);
  });

  it('headed Claude 已退役（任务 76a160b3）：拒绝 claude_channel_retired，不构造 tmux 启动命令', async () => {
    const { spawnSkillRelaySession } = await import(
      '../../../packages/brain/src/harness-skill-relay.js'
    );
    const calls: string[] = [];
    const task = {
      id: taskId,
      title: 'provenance contract',
      payload: {
        orchestrator: 'skill-relay',
        executor: 'claude',
        mode: 'headed',
      },
    };
    const result = await spawnSkillRelaySession(task, {
      pool: { query: vi.fn().mockResolvedValue({ rows: [] }) },
      execFn: (command: string) => {
        calls.push(command);
        return 'TMUX_DEAD';
      },
      inDockerFn: () => false,
      authorizeLegacyRelay: async (_identity, operation) => operation(),
      sshKeyFn: () => null,
      loadSkill: () => 'contract prompt',
      ensureWt: async () => '/tmp/contract-worktree',
      now: () => new Date('2026-07-25T00:00:00Z'),
    });
    expect(result).toMatchObject({ ok: false, error: 'claude_channel_retired' });
    expect(calls.some((command) => command.includes('tmux new-session'))).toBe(false);
  });
});
