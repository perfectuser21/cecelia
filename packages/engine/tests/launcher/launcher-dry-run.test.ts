// packages/engine/tests/launcher/launcher-dry-run.test.ts
import { describe, it, expect } from 'vitest'
import { execSync } from 'child_process'
import { resolve } from 'path'

describe('claude-launch.sh / cecelia-run.sh dry-run 注入 session identity', () => {
  const claudeLaunch = resolve(__dirname, '../../../../scripts/claude-launch.sh')
  const ceceliaRun = resolve(__dirname, '../../../brain/scripts/cecelia-run.sh')

  it('claude-launch.sh --dry-run 输出含 --session-id <uuid>', () => {
    const out = execSync(`bash ${claudeLaunch} --dry-run`, { encoding: 'utf8', timeout: 5000 })
    expect(out).toMatch(/--session-id\s+[a-f0-9-]{8,}/)
  })

  it('cecelia-run.sh --dry-run 通过 CLAUDE_SESSION_ID 把 UUID 交给统一 launcher', () => {
    const out = execSync(`bash ${ceceliaRun} --dry-run`, { encoding: 'utf8', timeout: 5000 })
    expect(out).toMatch(/CECELIA_DISPATCH=1/)
    expect(out).toMatch(/CLAUDE_SESSION_ID=[a-f0-9-]{8,}/)
    expect(out).toMatch(/bash .*scripts\/claude-launch\.sh -p <prompt>/)
  })
})

describe('claude-launch.sh resume/continue 自动追加 --fork-session', () => {
  const claudeLaunch = resolve(__dirname, '../../../../scripts/claude-launch.sh')
  const env = { ...process.env, CECELIA_NO_AUTO_WORKTREE: '1' }

  it('--dry-run --resume <id> 输出含 --fork-session', () => {
    const out = execSync(`bash ${claudeLaunch} --dry-run --resume abc123`, { encoding: 'utf8', timeout: 5000, env })
    expect(out).toMatch(/--fork-session/)
  })

  it('--dry-run -c 输出含 --fork-session', () => {
    const out = execSync(`bash ${claudeLaunch} --dry-run -c`, { encoding: 'utf8', timeout: 5000, env })
    expect(out).toMatch(/--fork-session/)
  })

  it('--dry-run --continue 输出含 --fork-session', () => {
    const out = execSync(`bash ${claudeLaunch} --dry-run --continue`, { encoding: 'utf8', timeout: 5000, env })
    expect(out).toMatch(/--fork-session/)
  })

  it('--dry-run -r 输出含 --fork-session', () => {
    const out = execSync(`bash ${claudeLaunch} --dry-run -r`, { encoding: 'utf8', timeout: 5000, env })
    expect(out).toMatch(/--fork-session/)
  })

  it('--dry-run --resume=abc123（等号形式）输出含 --fork-session', () => {
    const out = execSync(`bash ${claudeLaunch} --dry-run --resume=abc123`, { encoding: 'utf8', timeout: 5000, env })
    expect(out).toMatch(/--fork-session/)
  })

  // 已知限制：检测按字面子串匹配参数，若某 flag 的值恰为字符串 -r/-c 会被误判为 resume/continue。
  // claude CLI 实际不存在这种参数组合场景，接受此限制。
  it('用户已带 --fork-session 时不重复追加（恰出现 1 次）', () => {
    const out = execSync(`bash ${claudeLaunch} --dry-run --resume abc123 --fork-session`, { encoding: 'utf8', timeout: 5000, env })
    expect(out.match(/--fork-session/g)).toHaveLength(1)
  })

  it('无 resume/continue 时不出现 --fork-session', () => {
    const out = execSync(`bash ${claudeLaunch} --dry-run`, { encoding: 'utf8', timeout: 5000, env })
    expect(out).not.toMatch(/--fork-session/)
  })
})
