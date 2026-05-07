import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execSync } from 'child_process'
import { writeFileSync, mkdtempSync, mkdirSync, rmSync, utimesSync } from 'fs'
import { resolve, join } from 'path'
import { tmpdir } from 'os'

const HOOK = resolve(__dirname, '../../hooks/stop-dev.sh')

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
  // env 必须放在 pipe 后的 bash 前，否则只对 echo 起作用
  const envStr = Object.entries(env).map(([k, v]) => `${k}=${v}`).join(' ')
  try {
    return execSync(
      `cd ${repo} && echo '{"session_id":"abc12345-x"}' | ${envStr} CLAUDE_HOOK_CWD=${repo} bash ${HOOK}`,
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
  })

  afterEach(() => {
    rmSync(repo, { recursive: true, force: true })
  })

  it('C1 env=1 + 无 marker → 不 bypass（走正常决策，灯亮 → block）', () => {
    const out = runHook(repo, { CECELIA_STOP_HOOK_BYPASS: '1' })
    // 应该 block（灯亮）而不是 release
    expect(out).toMatch(/"decision"\s*:\s*"block"/)
    // reason_code 应该是 lights_alive 而不是 bypass
    expect(out).toMatch(/lights_alive|还有.*条/)
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
