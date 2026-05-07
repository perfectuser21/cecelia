// packages/engine/tests/hooks/stop-hook-v23-decision.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execSync } from 'child_process'
import { writeFileSync, mkdirSync, rmSync, mkdtempSync, utimesSync } from 'fs'
import { resolve, join } from 'path'
import { tmpdir } from 'os'

const HOOK = resolve(__dirname, '../../hooks/stop-dev.sh')

function runHook(testRepo: string, sessionId: string): { stdout: string, stderr: string, code: number } {
  const payload = JSON.stringify({ session_id: sessionId })
  try {
    const out = execSync(
      `cd ${testRepo} && CLAUDE_HOOK_CWD=${testRepo} echo '${payload}' | bash ${HOOK}`,
      { encoding: 'utf8' }
    )
    return { stdout: out, stderr: '', code: 0 }
  } catch (e: any) {
    return { stdout: e.stdout || '', stderr: e.stderr || '', code: e.status }
  }
}

function makeLight(lightsDir: string, sidShort: string, branch: string, opts: { ageSeconds?: number, guardianPid?: number } = {}) {
  mkdirSync(lightsDir, { recursive: true })
  const f = join(lightsDir, `${sidShort}-${branch}.live`)
  writeFileSync(f, JSON.stringify({
    session_id: `${sidShort}-full-uuid`,
    branch,
    worktree_path: `/tmp/wt-${branch}`,
    started_at: new Date().toISOString(),
    host: 'test-host',
    guardian_pid: opts.guardianPid || 99999,
  }))
  if (opts.ageSeconds) {
    const t = (Date.now() - opts.ageSeconds * 1000) / 1000
    utimesSync(f, t, t)
  }
  return f
}

describe('stop-dev.sh v23 decision matrix', () => {
  let testRepo: string
  let lightsDir: string

  beforeEach(() => {
    testRepo = mkdtempSync(join(tmpdir(), 'hookv23-'))
    execSync(`cd ${testRepo} && git init -q && git -c user.email=t@t -c user.name=t commit --allow-empty -m init -q`)
    lightsDir = join(testRepo, '.cecelia/lights')
  })

  afterEach(() => {
    rmSync(testRepo, { recursive: true, force: true })
  })

  it('1 自己的灯亮（mtime 新鲜）→ block', () => {
    makeLight(lightsDir, 'abc12345', 'cp-test')
    const r = runHook(testRepo, 'abc12345-full-uuid')
    expect(r.stdout).toMatch(/"decision"\s*:\s*"block"/)
  })

  it('2 自己的灯熄（mtime 超 5min）→ release', () => {
    makeLight(lightsDir, 'abc12345', 'cp-test', { ageSeconds: 600 })
    const r = runHook(testRepo, 'abc12345-full-uuid')
    expect(r.stdout).not.toMatch(/decision.*block/)
  })

  it('3 别人的灯亮 + 自己没灯 → release', () => {
    makeLight(lightsDir, 'def67890', 'cp-other')
    const r = runHook(testRepo, 'abc12345-full-uuid')
    expect(r.stdout).not.toMatch(/decision.*block/)
  })

  it('4 别人的灯亮 + 自己的灯亮 → block（只看自己）', () => {
    makeLight(lightsDir, 'def67890', 'cp-other')
    makeLight(lightsDir, 'abc12345', 'cp-mine')
    const r = runHook(testRepo, 'abc12345-full-uuid')
    expect(r.stdout).toMatch(/"decision"\s*:\s*"block"/)
    expect(r.stdout).toMatch(/cp-mine/)
  })

  it('5 自己 3 灯亮（多 worktree 并行）→ block + reason 含数量', () => {
    makeLight(lightsDir, 'abc12345', 'cp-1')
    makeLight(lightsDir, 'abc12345', 'cp-2')
    makeLight(lightsDir, 'abc12345', 'cp-3')
    const r = runHook(testRepo, 'abc12345-full-uuid')
    expect(r.stdout).toMatch(/"decision"\s*:\s*"block"/)
    expect(r.stdout).toMatch(/3\s*条/)
  })

  it('6 lights/ 目录不存在 → release（普通对话）', () => {
    const r = runHook(testRepo, 'abc12345-full-uuid')
    expect(r.stdout).not.toMatch(/decision.*block/)
  })

  it('7 BYPASS=1（双因子）→ release（v23.2 双因子升级：env + .bypass-active marker）', () => {
    makeLight(lightsDir, 'abc12345', 'cp-test')
    // 双因子 layer 3：必须同时有 env 和 fresh marker 文件
    mkdirSync(join(testRepo, '.cecelia'), { recursive: true })
    writeFileSync(join(testRepo, '.cecelia/.bypass-active'), '')
    const out = execSync(
      `cd ${testRepo} && echo '{"session_id":"abc12345-x"}' | CLAUDE_HOOK_CWD=${testRepo} CECELIA_STOP_HOOK_BYPASS=1 bash ${HOOK}`,
      { encoding: 'utf8' }
    )
    expect(out).not.toMatch(/decision.*block/)
  })

  it('8 灯文件 JSON 损坏 → 仍能给出 reason（branch 字段空但不挂）', () => {
    mkdirSync(lightsDir, { recursive: true })
    writeFileSync(join(lightsDir, 'abc12345-cp-broken.live'), '{this is not json')
    const r = runHook(testRepo, 'abc12345-full-uuid')
    expect(r.stdout).toMatch(/"decision"\s*:\s*"block"/)
  })
})
