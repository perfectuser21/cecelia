// packages/engine/tests/skills/engine-ship-guardian.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execSync, spawn } from 'child_process'
import { existsSync, readFileSync, mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs'
import { resolve, join } from 'path'
import { tmpdir } from 'os'

const SHIP_FINALIZE = resolve(__dirname, '../../scripts/ship-finalize.sh')
const GUARDIAN = resolve(__dirname, '../../lib/dev-heartbeat-guardian.sh')

describe('ship-finalize.sh — 关 guardian + 写 done-marker（PR-2）', () => {
  let mainRepo: string
  let lightsDir: string
  let doneDir: string

  beforeEach(() => {
    mainRepo = mkdtempSync(join(tmpdir(), 'shipgrd-'))
    execSync(`cd ${mainRepo} && git init -q && git commit --allow-empty -m init -q`)
    lightsDir = join(mainRepo, '.cecelia/lights')
    doneDir = join(mainRepo, '.cecelia/done-markers')
    mkdirSync(lightsDir, { recursive: true })
    mkdirSync(doneDir, { recursive: true })
  })

  afterEach(() => {
    try { execSync(`pkill -f 'dev-heartbeat-guardian' || true`) } catch {}
    rmSync(mainRepo, { recursive: true, force: true })
  })

  it('1 ship-finalize 写 done-marker 到 .cecelia/done-markers/', () => {
    const branch = 'cp-test-ship-1'
    const lightFile = join(lightsDir, `xyz77777-${branch}.live`)
    const proc = spawn('bash', [GUARDIAN, lightFile], {
      env: { ...process.env, GUARDIAN_INTERVAL_SEC: '1' }, detached: false
    })
    return new Promise<void>(resolve_promise => {
      setTimeout(() => {
        writeFileSync(lightFile, JSON.stringify({ branch, guardian_pid: proc.pid }))

        execSync(
          `cd ${mainRepo} && bash ${SHIP_FINALIZE} ${branch} 2823 https://github.com/foo/bar/pull/2823`,
          { encoding: 'utf8' }
        )

        const marker = join(doneDir, `xyz77777-${branch}.done`)
        expect(existsSync(marker)).toBe(true)
        const m = JSON.parse(readFileSync(marker, 'utf8'))
        expect(m.branch).toBe(branch)
        expect(m.pr_number).toBe(2823)
        expect(m.merged).toBe(true)
        resolve_promise()
      }, 500)
    })
  }, 5000)

  it('2 ship-finalize 杀 guardian → 灯文件被清', async () => {
    const branch = 'cp-test-ship-2'
    const lightFile = join(lightsDir, `aaa88888-${branch}.live`)
    const proc = spawn('bash', [GUARDIAN, lightFile], {
      env: { ...process.env, GUARDIAN_INTERVAL_SEC: '1' }, detached: false
    })
    await new Promise(r => setTimeout(r, 500))
    writeFileSync(lightFile, JSON.stringify({ branch, guardian_pid: proc.pid }))

    execSync(`cd ${mainRepo} && bash ${SHIP_FINALIZE} ${branch} 2823 https://x/y/z`, { encoding: 'utf8' })

    await new Promise(r => setTimeout(r, 600))
    expect(existsSync(lightFile)).toBe(false)
    let alive = true
    try { process.kill(proc.pid!, 0) } catch { alive = false }
    expect(alive).toBe(false)
  }, 5000)

  it('3 ship-finalize 找不到匹配灯：退出 1，不报内部错', () => {
    let code = 0
    try {
      execSync(`cd ${mainRepo} && bash ${SHIP_FINALIZE} nonexistent-branch 1 https://x/y/z`, {
        encoding: 'utf8', stdio: 'pipe'
      })
    } catch (e: any) { code = e.status }
    expect(code).toBe(1)
  })
})
