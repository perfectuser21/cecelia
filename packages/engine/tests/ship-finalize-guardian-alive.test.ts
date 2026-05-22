import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execSync, spawnSync } from 'child_process'
import { writeFileSync, mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'

const SHIP_FINALIZE = require('path').resolve(__dirname, '../../scripts/ship-finalize.sh')

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

    // 启动 mock guardian（sleep 进程）
    const sleepResult = execSync('bash -c "sleep 60 & echo $!"', { encoding: 'utf8' })
    guardianPid = parseInt(sleepResult.trim())

    // 写 light 文件
    const lightFile = join(lightsDir, `abc12345-${branch}.live`)
    writeFileSync(lightFile, JSON.stringify({
      branch,
      guardian_pid: guardianPid,
      session_id: 'abc12345-test',
      session_id_short: 'abc12345',
    }))

    // 执行 ship-finalize.sh
    const output = execSync(
      `cd ${mainRepo} && bash ${SHIP_FINALIZE} ${branch} 123 https://github.com/x/y/pull/123 2>&1 || true`,
      { encoding: 'utf8' }
    )

    // 验证 guardian 仍然存活（kill -0 = 检查进程存在，不发信号）
    const aliveCheck = spawnSync('kill', ['-0', String(guardianPid)])
    expect(aliveCheck.status).toBe(0) // status=0 = 进程存活

    // 验证输出中不含 SIGTERM
    expect(output).not.toContain('SIGTERM')

    // 验证 done-marker 已写（ship-finalize 的 done-marker 功能应保留）
    const markers = require('fs').readdirSync(join(mainRepo, '.cecelia/done-markers'))
    expect(markers.length).toBeGreaterThan(0)
  })
})
