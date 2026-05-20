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

// v24：在 testRepo 创建 mock devloop-check.sh，让 classify_session 返回 blocked
function setupClassifyMock(repo: string, status: 'blocked' | 'not-dev' = 'blocked'): void {
  const libDir = join(repo, 'packages/engine/lib')
  mkdirSync(libDir, { recursive: true })
  const mockPayload = status === 'blocked'
    ? '{"status":"blocked","reason":"mock dev session in progress"}'
    : '{"status":"not-dev","reason":"mock not dev"}'
  writeFileSync(join(libDir, 'devloop-check.sh'), `#!/usr/bin/env bash
classify_session() { echo '${mockPayload}'; return 0; }
log_hook_decision() { :; }
`)
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

  it('2 session_id 缺（CLAUDE_HOOK_SESSION_ID 未设置）→ release（v24 新语义：非受控 /dev 会话放行）', () => {
    makeLight(lightsDir, 'abc12345', 'cp-test')
    let out = ''
    try {
      out = execSync(
        // v24：session_id 从 env var 读，不设 CLAUDE_HOOK_SESSION_ID → no_env_session_id → release
        `cd ${testRepo} && CLAUDE_HOOK_CWD=${testRepo} bash ${HOOK}`,
        { encoding: 'utf8' }
      )
    } catch (e: any) { out = e.stdout || '' }
    // v24 新语义：session_id 空 = 非受控 /dev 会话 = 直接放行（不 block）
    expect(out).toMatch(/"decision"\s*:\s*"release"/)
    expect(out).toMatch(/no_env_session_id/)
  })

  it('3 cwd drift 到主仓库 main：仍 block 自己 session 的灯', () => {
    // 模拟：CLAUDE_HOOK_CWD=主仓库（非 worktree）；lights/ 在主仓库 .cecelia/
    makeLight(lightsDir, 'abc12345', 'cp-x')
    // v24：需要 mock classify_session 返回 blocked
    setupClassifyMock(testRepo, 'blocked')
    const out = execSync(
      // v24：session_id 改从 CLAUDE_HOOK_SESSION_ID env var 读取
      `cd ${testRepo} && CLAUDE_HOOK_SESSION_ID=abc12345-x CLAUDE_HOOK_CWD=${testRepo} bash ${HOOK}`,
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
    // v24：需要 mock classify_session 返回 blocked，且 log_hook_decision 来自 devloop-check.sh
    // 这里我们需要真实的 log_hook_decision：不 mock 整个 devloop-check.sh，而是只 mock classify_session
    const libDir = join(testRepo, 'packages/engine/lib')
    mkdirSync(libDir, { recursive: true })
    // 拷贝真实的 devloop-check.sh 并追加 classify_session mock 覆盖
    const realLib = resolve(__dirname, '../../lib/devloop-check.sh')
    const realContent = require('fs').readFileSync(realLib, 'utf8')
    require('fs').writeFileSync(join(libDir, 'devloop-check.sh'),
      realContent + '\n# v24 test mock override\nclassify_session() { echo \'{"status":"blocked","reason":"mock dev session in progress"}\'; return 0; }\n'
    )
    const fakeHome = mkdtempSync(join(tmpdir(), 'hooklog-'))
    execSync(
      // v24：session_id 改从 CLAUDE_HOOK_SESSION_ID env var 读取
      `cd ${testRepo} && CLAUDE_HOOK_SESSION_ID=abc12345-x HOME=${fakeHome} CLAUDE_HOOK_CWD=${testRepo} bash ${HOOK}`,
      { encoding: 'utf8' }
    )
    const logFile = join(fakeHome, '.claude/hook-logs/stop-dev.jsonl')
    const log = require('fs').readFileSync(logFile, 'utf8').trim()
    const last = JSON.parse(log.split('\n').pop()!)
    expect(last.decision).toBe('block')
    // v24：reason_code 改为 classify_blocked（而非 lights_alive）
    expect(last.reason_code).toBe('classify_blocked')
    rmSync(fakeHome, { recursive: true, force: true })
  })
})
