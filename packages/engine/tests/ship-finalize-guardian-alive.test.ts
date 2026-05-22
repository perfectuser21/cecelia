import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execSync, spawnSync, spawn } from 'child_process'
import { writeFileSync, mkdirSync, rmSync, readdirSync } from 'fs'
import { join, resolve } from 'path'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'

const SHIP_FINALIZE = resolve(__dirname, '../scripts/ship-finalize.sh')

describe('ship-finalize.sh — Fix 1：guardian 在 ship-finalize 后仍存活', () => {
  let mainRepo: string
  let guardianPid: number

  beforeEach(() => {
    mainRepo = mkdtempSync(join(tmpdir(), 'sfgrd-'))
    execSync(
      `cd ${mainRepo} && git init -q && git -c user.email=t@t -c user.name=t commit --allow-empty -m init -q && git branch -M main`,
      { stdio: 'pipe' }
    )
  })

  afterEach(() => {
    try { if (guardianPid) process.kill(guardianPid) } catch {}
    rmSync(mainRepo, { recursive: true, force: true })
  })

  it('ship-finalize.sh 执行后 guardian 进程仍然存活', () => {
    const branch = 'cp-test-ship-finalize'
    const lightsDir = join(mainRepo, '.cecelia/lights')
    mkdirSync(lightsDir, { recursive: true })
    mkdirSync(join(mainRepo, '.cecelia/done-markers'), { recursive: true })

    let gpid: number | null = null
    try {
      // 启动 mock guardian（使用 spawn detached 真正后台运行，避免 execSync 阻塞等待）
      const guardian = spawn('sleep', ['60'], { detached: true, stdio: 'ignore' })
      guardian.unref()
      gpid = guardian.pid!
      guardianPid = gpid  // 备份给 afterEach

      // 写 light 文件
      const lightFile = join(lightsDir, `abc12345-${branch}.live`)
      writeFileSync(lightFile, JSON.stringify({
        branch,
        guardian_pid: gpid,
        session_id: 'abc12345-test',
        session_id_short: 'abc12345',
      }))

      // 执行 ship-finalize.sh
      const output = execSync(
        `cd ${mainRepo} && bash ${SHIP_FINALIZE} ${branch} 123 https://github.com/x/y/pull/123 2>&1 || true`,
        { encoding: 'utf8' }
      )

      // 主断言：输出中不含 SIGTERM（Fix 1 实现后 ship-finalize 不应 kill guardian）
      expect(output).not.toContain('SIGTERM')

      // 补充确认：kill -0 验证进程存活（注意：此检查在 SIGTERM 发出后极短时间内可能有竞态，
      // 主要可靠性依赖上面的 output 断言）
      const aliveCheck = spawnSync('kill', ['-0', String(gpid)])
      expect(aliveCheck.status).toBe(0) // status=0 = 进程存活

      // 验证 done-marker 已写（ship-finalize 的 done-marker 功能应保留）
      const markers = readdirSync(join(mainRepo, '.cecelia/done-markers'))
      expect(markers.length).toBeGreaterThan(0)
    } finally {
      if (gpid) try { process.kill(gpid) } catch {}
    }
  })
})
