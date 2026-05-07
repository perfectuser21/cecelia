// packages/engine/tests/skills/engine-worktree-guardian.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execSync } from 'child_process'
import { existsSync, readFileSync, mkdtempSync, rmSync, mkdirSync } from 'fs'
import { resolve, join } from 'path'
import { tmpdir } from 'os'

const SCRIPT = resolve(__dirname, '../../skills/dev/scripts/worktree-manage.sh')

describe('worktree-manage.sh + guardian fork（PR-2）', () => {
  let mainRepo: string

  beforeEach(() => {
    mainRepo = mkdtempSync(join(tmpdir(), 'wtgrd-'))
    execSync(
      `cd ${mainRepo} && git init -q && git -c user.email=t@t -c user.name=t commit --allow-empty -m init -q && git branch -M main`,
      { stdio: 'pipe' }
    )
  })

  afterEach(() => {
    // 杀残留 guardian
    try { execSync(`pkill -f 'dev-heartbeat-guardian.sh.*${mainRepo}' || true`) } catch {}
    rmSync(mainRepo, { recursive: true, force: true })
  })

  it('1 cmd_create 后 .cecelia/lights/<sid>-<branch>.live 存在', () => {
    const env = { ...process.env, CLAUDE_SESSION_ID: 'abc12345-feat-test', GUARDIAN_INTERVAL_SEC: '1' }
    execSync(`cd ${mainRepo} && bash ${SCRIPT} create test-pr2-1`, { encoding: 'utf8', env })

    const lightsDir = join(mainRepo, '.cecelia/lights')
    expect(existsSync(lightsDir)).toBe(true)
    const files = require('fs').readdirSync(lightsDir).filter((f: string) => f.startsWith('abc12345-cp-'))
    expect(files.length).toBeGreaterThan(0)

    const light = JSON.parse(readFileSync(join(lightsDir, files[0]), 'utf8'))
    expect(light.session_id).toBe('abc12345-feat-test')
    expect(light.guardian_pid).toBeGreaterThan(0)
    expect(light.branch).toMatch(/^cp-/)
  })

  it('2 guardian 进程启动且每秒刷新 mtime', async () => {
    const env = { ...process.env, CLAUDE_SESSION_ID: 'def67890-feat-x', GUARDIAN_INTERVAL_SEC: '1' }
    execSync(`cd ${mainRepo} && bash ${SCRIPT} create test-pr2-2`, { encoding: 'utf8', env })

    const lightsDir = join(mainRepo, '.cecelia/lights')
    const files = require('fs').readdirSync(lightsDir).filter((f: string) => f.startsWith('def67890-'))
    const lightFile = join(lightsDir, files[0])

    const m1 = require('fs').statSync(lightFile).mtimeMs
    await new Promise(r => setTimeout(r, 2200))
    const m2 = require('fs').statSync(lightFile).mtimeMs

    expect(m2).toBeGreaterThan(m1)  // mtime 被更新
  }, 8000)

  it('3 灯文件 guardian_pid 字段引用真实进程', () => {
    const env = { ...process.env, CLAUDE_SESSION_ID: 'ghi11223-test', GUARDIAN_INTERVAL_SEC: '1' }
    execSync(`cd ${mainRepo} && bash ${SCRIPT} create test-pr2-3`, { encoding: 'utf8', env })

    const lightsDir = join(mainRepo, '.cecelia/lights')
    const files = require('fs').readdirSync(lightsDir).filter((f: string) => f.startsWith('ghi11223-'))
    const light = JSON.parse(readFileSync(join(lightsDir, files[0]), 'utf8'))

    // process.kill(pid, 0) 不抛 → 进程存在
    expect(() => process.kill(light.guardian_pid, 0)).not.toThrow()
  })
})
