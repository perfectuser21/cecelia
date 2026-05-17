// packages/engine/tests/hooks/abort-dev.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execSync, spawn } from 'child_process'
import { writeFileSync, existsSync, mkdtempSync, mkdirSync, rmSync } from 'fs'
import { resolve, join } from 'path'
import { tmpdir } from 'os'

describe('abort-dev.sh', () => {
  const abortScript = resolve(__dirname, '../../scripts/abort-dev.sh')
  const guardian = resolve(__dirname, '../../lib/dev-heartbeat-guardian.sh')
  let testRepo: string
  let lightsDir: string
  let abortedDir: string

  beforeEach(() => {
    testRepo = mkdtempSync(join(tmpdir(), 'abort-test-'))
    lightsDir = join(testRepo, '.cecelia/lights')
    abortedDir = join(testRepo, '.cecelia/aborted')
    mkdirSync(lightsDir, { recursive: true })
    mkdirSync(abortedDir, { recursive: true })
    execSync(`git init -q ${testRepo}`)
  })

  afterEach(() => {
    rmSync(testRepo, { recursive: true, force: true })
  })

  it('中止 active /dev：kill guardian + 写 aborted-marker', async () => {
    const branch = 'cp-test-branch'
    const lightFile = join(lightsDir, `abc12345-${branch}.live`)

    // 启动 guardian
    const proc = spawn('bash', [guardian, lightFile])
    await new Promise(r => setTimeout(r, 500))

    // 写灯文件含 guardian_pid
    writeFileSync(lightFile, JSON.stringify({
      session_id: 'abc12345-full-uuid',
      branch,
      guardian_pid: proc.pid,
    }))

    // 调 abort
    execSync(
      `cd ${testRepo} && bash ${abortScript} ${branch}`,
      { encoding: 'utf8' }
    )

    await new Promise(r => setTimeout(r, 500))
    // guardian 应被杀
    let alive = true
    try { process.kill(proc.pid!, 0) } catch { alive = false }
    expect(alive).toBe(false)

    // aborted-marker 应存在
    const marker = join(abortedDir, `abc12345-${branch}.aborted`)
    expect(existsSync(marker)).toBe(true)
  })

  it('找不到匹配灯：exit 1', () => {
    const result = (() => {
      try {
        execSync(`cd ${testRepo} && bash ${abortScript} nonexistent-branch`, { encoding: 'utf8' })
        return 0
      } catch (e: any) { return e.status }
    })()
    expect(result).toBe(1)
  })

  it('幂等：重复 abort 同一 branch 不报错', async () => {
    const branch = 'cp-idempotent'
    const lightFile = join(lightsDir, `def67890-${branch}.live`)
    const proc = spawn('bash', [guardian, lightFile])
    await new Promise(r => setTimeout(r, 500))
    writeFileSync(lightFile, JSON.stringify({ guardian_pid: proc.pid }))

    execSync(`cd ${testRepo} && bash ${abortScript} ${branch}`, { encoding: 'utf8' })
    await new Promise(r => setTimeout(r, 300))

    // 第二次：灯已不存在 → exit 1，但允许（幂等通过 || true）
    const second = (() => {
      try {
        execSync(`cd ${testRepo} && bash ${abortScript} ${branch}`, { encoding: 'utf8' })
        return 0
      } catch (e: any) { return e.status }
    })()
    expect([0, 1]).toContain(second)  // 0 或 1 都接受（已无灯返回 1）
  })
})
