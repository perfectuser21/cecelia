// packages/engine/tests/hooks/heartbeat-guardian.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { spawn } from 'child_process'
import { writeFileSync, readFileSync, existsSync, statSync, rmSync, mkdtempSync, unlinkSync } from 'fs'
import { resolve, join } from 'path'
import { tmpdir } from 'os'

describe('dev-heartbeat-guardian.sh', () => {
  const guardian = resolve(__dirname, '../../lib/dev-heartbeat-guardian.sh')
  let testDir: string
  let lightFile: string

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'guardian-test-'))
    lightFile = join(testDir, 'test.live')
  })

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  it('启动后立即创建/touch 灯文件', async () => {
    const proc = spawn('bash', [guardian, lightFile], { detached: false })
    await new Promise(r => setTimeout(r, 500))
    expect(existsSync(lightFile)).toBe(true)
    process.kill(proc.pid!, 'SIGTERM')
    await new Promise(r => setTimeout(r, 200))
  })

  it('收到 SIGTERM 后清理灯文件并退出 0', async () => {
    const proc = spawn('bash', [guardian, lightFile])
    await new Promise(r => setTimeout(r, 500))
    expect(existsSync(lightFile)).toBe(true)

    const exitPromise = new Promise<number>(resolve => {
      proc.on('exit', code => resolve(code ?? -1))
    })
    process.kill(proc.pid!, 'SIGTERM')
    const exitCode = await exitPromise

    expect(exitCode).toBe(0)
    expect(existsSync(lightFile)).toBe(false)
  })

  it('父进程死后 guardian 自杀（ppid 自检）', async () => {
    // 用 setsid 启动 guardian，让它独立于测试进程；测试进程模拟 parent
    // 这里用一个简单代理：fork 一个 shell 当父，shell 退出，guardian 应自杀
    const wrapperScript = `
      GUARDIAN_INTERVAL_SEC=1 bash ${guardian} ${lightFile} &
      GUARDIAN_PID=$!
      echo $GUARDIAN_PID > ${join(testDir, 'guardian.pid')}
      sleep 0.5
      exit 0
    `
    const wrapperFile = join(testDir, 'wrapper.sh')
    writeFileSync(wrapperFile, wrapperScript)
    const wrapper = spawn('bash', [wrapperFile])
    await new Promise(r => setTimeout(r, 1000))
    // 等 wrapper 退出 + guardian 检测 ppid 变化（最多 60s 一次循环）
    // 测试用短 TTL 不现实，改用直接检查 light 文件是否最终消失
    // 简化：用快速变体的 guardian 测试（GUARDIAN_INTERVAL_SEC=1 env）
    await new Promise(r => setTimeout(r, 3000))
    // 期望 guardian 已自杀清理（实际生产 60s 间隔，此 case 在快速模式跑）
    const guardianPid = parseInt(readFileSync(join(testDir, 'guardian.pid'), 'utf8'))
    let guardianAlive = true
    try { process.kill(guardianPid, 0) } catch { guardianAlive = false }
    expect(guardianAlive).toBe(false)
  }, 10000)

  it('参数为空时 exit 1', async () => {
    const proc = spawn('bash', [guardian])
    const exitPromise = new Promise<number>(resolve => {
      proc.on('exit', code => resolve(code ?? -1))
    })
    const exitCode = await exitPromise
    expect(exitCode).toBe(1)
  })
})
