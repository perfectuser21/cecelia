// packages/engine/tests/hooks/stop-hook-v23-routing.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execSync } from 'child_process'
import { writeFileSync, mkdirSync, rmSync, mkdtempSync } from 'fs'
import { resolve, join } from 'path'
import { tmpdir } from 'os'

const HOOK = resolve(__dirname, '../../hooks/stop-dev.sh')

function makeLight(lightsDir: string, sidShort: string, branch: string) {
  mkdirSync(lightsDir, { recursive: true })
  writeFileSync(join(lightsDir, `${sidShort}-${branch}.live`), JSON.stringify({
    session_id: `${sidShort}-full`, branch, worktree_path: `/tmp/${branch}`, guardian_pid: 99999
  }))
}

describe('stop-dev.sh v23 routing & 特殊场景', () => {
  let testRepo: string
  let lightsDir: string

  beforeEach(() => {
    testRepo = mkdtempSync(join(tmpdir(), 'hookv23r-'))
    execSync(`cd ${testRepo} && git init -q && git -c user.email=t@t -c user.name=t commit --allow-empty -m init -q`)
    lightsDir = join(testRepo, '.cecelia/lights')
  })

  afterEach(() => {
    rmSync(testRepo, { recursive: true, force: true })
  })

  it.skip('1 session_id 缺 + tty → release（仅手动场景：CI 难以伪造 tty）', () => {
    // Spec § 4.3 标注此为手动测试场景。自动化测试中 </dev/null 无法伪造 tty，
    // </dev/null 会让 hook 走非 tty + 空 session_id 分支（保守 block，由 case 2 覆盖反向）。
    // 真 tty 模式需 `script` 工具，跨平台兼容性不可控，故 skip。
    expect(true).toBe(true)
  })

  it('2 session_id 缺 + 非 tty (空 payload via pipe) → block', () => {
    makeLight(lightsDir, 'abc12345', 'cp-test')
    let out = ''
    try {
      out = execSync(
        `cd ${testRepo} && CLAUDE_HOOK_CWD=${testRepo} echo '' | bash ${HOOK}`,
        { encoding: 'utf8' }
      )
    } catch (e: any) { out = e.stdout || '' }
    expect(out).toMatch(/"decision"\s*:\s*"block"/)
    expect(out).toMatch(/系统异常|no_session_id/)
  })

  it('3 cwd drift 到主仓库 main：仍 block 自己 session 的灯', () => {
    // 模拟：CLAUDE_HOOK_CWD=主仓库（非 worktree）；lights/ 在主仓库 .cecelia/
    makeLight(lightsDir, 'abc12345', 'cp-x')
    const out = execSync(
      `cd ${testRepo} && CLAUDE_HOOK_CWD=${testRepo} echo '{"session_id":"abc12345-x"}' | bash ${HOOK}`,
      { encoding: 'utf8' }
    )
    expect(out).toMatch(/"decision"\s*:\s*"block"/)
  })

  it('4 不在 git 仓库 → release（普通系统目录）', () => {
    const noGitDir = mkdtempSync(join(tmpdir(), 'nogit-'))
    let out = ''
    try {
      out = execSync(
        `cd ${noGitDir} && CLAUDE_HOOK_CWD=${noGitDir} echo '{"session_id":"abc12345-x"}' | bash ${HOOK}`,
        { encoding: 'utf8' }
      )
    } catch (e: any) { out = e.stdout || '' }
    expect(out).not.toMatch(/decision.*block/)
    rmSync(noGitDir, { recursive: true, force: true })
  })

  it('5 hook 决策日志写入 ~/.claude/hook-logs/stop-dev.jsonl', () => {
    makeLight(lightsDir, 'abc12345', 'cp-test')
    const fakeHome = mkdtempSync(join(tmpdir(), 'hooklog-'))
    execSync(
      `cd ${testRepo} && echo '{"session_id":"abc12345-x"}' | HOME=${fakeHome} CLAUDE_HOOK_CWD=${testRepo} bash ${HOOK}`,
      { encoding: 'utf8' }
    )
    const logFile = join(fakeHome, '.claude/hook-logs/stop-dev.jsonl')
    const log = require('fs').readFileSync(logFile, 'utf8').trim()
    const last = JSON.parse(log.split('\n').pop()!)
    expect(last.decision).toBe('block')
    expect(last.reason_code).toBe('lights_alive')
    rmSync(fakeHome, { recursive: true, force: true })
  })
})
