import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execSync } from 'child_process'
import { writeFileSync, mkdtempSync, mkdirSync, rmSync, utimesSync } from 'fs'
import { resolve, join } from 'path'
import { tmpdir } from 'os'

const HOOK = resolve(__dirname, '../../hooks/stop-dev.sh')

// v24：在 testRepo 创建 mock devloop-check.sh，让 classify_session 返回 blocked
// （stop-dev.sh 先在 main_repo/packages/engine/lib/ 查找 devloop-check.sh）
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

function setupRepo(): string {
  const repo = mkdtempSync(join(tmpdir(), 'bypass3l-'))
  execSync(`cd ${repo} && git init -q && git config user.email t@t && git config user.name t && git commit --allow-empty -m init -q`)
  mkdirSync(join(repo, '.cecelia/lights'), { recursive: true })
  // 写一盏自己的活灯（保证非 bypass 时会 block）
  writeFileSync(
    join(repo, '.cecelia/lights/abc12345-cp-test.live'),
    JSON.stringify({ session_id: 'abc12345-x', branch: 'cp-test', guardian_pid: 99999 })
  )
  return repo
}

function runHook(repo: string, env: Record<string, string> = {}): string {
  // v24：session_id 从 CLAUDE_HOOK_SESSION_ID env var 读取，不再从 stdin 解析
  const allEnv = { CLAUDE_HOOK_SESSION_ID: 'abc12345-x', CLAUDE_HOOK_CWD: repo, ...env }
  const envStr = Object.entries(allEnv).map(([k, v]) => `${k}=${v}`).join(' ')
  try {
    return execSync(
      `cd ${repo} && ${envStr} bash ${HOOK}`,
      { encoding: 'utf8' }
    )
  } catch (e: any) {
    return e.stdout || ''
  }
}

describe('BYPASS 三层防滥用 — 双因子触发', () => {
  let repo: string

  beforeEach(() => {
    repo = setupRepo()
    // v24：灯亮后走 classify_session，需 mock 返回 blocked 才会 block
    setupClassifyMock(repo, 'blocked')
  })

  afterEach(() => {
    rmSync(repo, { recursive: true, force: true })
  })

  it('C1 env=1 + 无 marker → 不 bypass（走正常决策，灯亮 → block）', () => {
    const out = runHook(repo, { CECELIA_STOP_HOOK_BYPASS: '1' })
    // 应该 block（灯亮 + classify_session=blocked）而不是 release
    expect(out).toMatch(/"decision"\s*:\s*"block"/)
    // v24：block 时 reason 字段来自 classify_session 的 reason
    expect(out).toMatch(/mock dev session|Dev session in progress/)
  })

  it('C2 env=1 + fresh marker → bypass release', () => {
    // 创建 marker 文件，mtime 是当前
    const marker = join(repo, '.cecelia/.bypass-active')
    writeFileSync(marker, '')

    const out = runHook(repo, { CECELIA_STOP_HOOK_BYPASS: '1' })
    // 灯亮但被 bypass 覆盖 → release（无 block JSON）
    expect(out).not.toMatch(/"decision"\s*:\s*"block"/)
  })

  it('C3 env=1 + stale marker（>30min） → 不 bypass', () => {
    const marker = join(repo, '.cecelia/.bypass-active')
    writeFileSync(marker, '')
    // 把 mtime 设到 1 小时前
    const hourAgo = (Date.now() - 3600 * 1000) / 1000
    utimesSync(marker, hourAgo, hourAgo)

    const out = runHook(repo, { CECELIA_STOP_HOOK_BYPASS: '1' })
    expect(out).toMatch(/"decision"\s*:\s*"block"/)
  })

  it('C4 env=0 + fresh marker → 不 bypass（marker alone 不够）', () => {
    const marker = join(repo, '.cecelia/.bypass-active')
    writeFileSync(marker, '')

    const out = runHook(repo, {})
    // 没设 BYPASS env → 不触发 bypass，灯亮 → block
    expect(out).toMatch(/"decision"\s*:\s*"block"/)
  })
})
