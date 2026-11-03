import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolve } from 'path'


// 即使误移除 --dry-run，测试仍只进入私有目录、私有HOME和不可达的Brain边界。
function dryRun(script: string, args: string[] = []) {
  const dir = mkdtempSync(join(tmpdir(), 'launcher-dry-run-'));
  const home = join(dir, 'home');
  mkdirSync(home);
  try {
    return execFileSync('bash', [script, '--dry-run', ...args], {
      cwd: dir, encoding: 'utf8', timeout: 5000,
      env: { PATH: process.env.PATH || '/usr/bin:/bin', HOME: home, LANG: 'C.UTF-8',
        GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null', BRAIN_URL: 'http://127.0.0.1:1',
        CECELIA_WORK_DIR: dir, LOCK_DIR: join(dir, 'locks'), WORKTREE_BASE: join(dir, 'worktrees'),
        CECELIA_LOG_FILE: join(dir, 'logs/run.log'), CECELIA_NO_AUTO_WORKTREE: '1' },
    });
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

describe('claude-launch.sh / cecelia-run.sh dry-run 注入 session identity', () => {
  const claudeLaunch = resolve(__dirname, '../../claude-launch.sh')
  const ceceliaRun = resolve(__dirname, '../../../packages/brain/scripts/cecelia-run.sh')

  it('claude-launch.sh --dry-run 输出含 --session-id <uuid>', () => {
    const out = dryRun(claudeLaunch)
    expect(out).toMatch(/--session-id\s+[a-f0-9-]{8,}/)
  })

  it('cecelia-run.sh --dry-run 通过 CLAUDE_SESSION_ID 把 UUID 交给统一 launcher', () => {
    const out = dryRun(ceceliaRun)
    expect(out).toMatch(/CECELIA_DISPATCH=1/)
    expect(out).toMatch(/CLAUDE_SESSION_ID=[a-f0-9-]{8,}/)
    expect(out).toMatch(/bash .*scripts\/claude-launch\.sh -p <prompt>/)
  })
})

describe('claude-launch.sh resume/continue 自动追加 --fork-session', () => {
  const claudeLaunch = resolve(__dirname, '../../claude-launch.sh')

  it('--dry-run --resume <id> 输出含 --fork-session', () => {
    const out = dryRun(claudeLaunch, ['--resume', 'abc123'])
    expect(out).toMatch(/--fork-session/)
  })

  it('--dry-run -c 输出含 --fork-session', () => {
    const out = dryRun(claudeLaunch, ['-c'])
    expect(out).toMatch(/--fork-session/)
  })

  it('--dry-run --continue 输出含 --fork-session', () => {
    const out = dryRun(claudeLaunch, ['--continue'])
    expect(out).toMatch(/--fork-session/)
  })

  it('--dry-run -r 输出含 --fork-session', () => {
    const out = dryRun(claudeLaunch, ['-r'])
    expect(out).toMatch(/--fork-session/)
  })

  it('--dry-run --resume=abc123（等号形式）输出含 --fork-session', () => {
    const out = dryRun(claudeLaunch, ['--resume=abc123'])
    expect(out).toMatch(/--fork-session/)
  })

  // 已知限制：检测按字面子串匹配参数，若某 flag 的值恰为字符串 -r/-c 会被误判为 resume/continue。
  // claude CLI 实际不存在这种参数组合场景，接受此限制。
  it('用户已带 --fork-session 时不重复追加（恰出现 1 次）', () => {
    const out = dryRun(claudeLaunch, ['--resume', 'abc123', '--fork-session'])
    expect(out.match(/--fork-session/g)).toHaveLength(1)
  })

  it('无 resume/continue 时不出现 --fork-session', () => {
    const out = dryRun(claudeLaunch, [])
    expect(out).not.toMatch(/--fork-session/)
  })
})
