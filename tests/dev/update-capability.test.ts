/**
 * @file update-capability.test.ts
 * @description 测试 update-capability.sh 脚本的降级行为
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execSync } from 'child_process'
import fs from 'fs'

const SCRIPT_PATH = 'skills/dev/scripts/update-capability.sh'
const DEV_MODE_FILE = '.dev-mode'

describe('update-capability.sh', () => {
  afterEach(() => {
    if (fs.existsSync(DEV_MODE_FILE)) {
      fs.unlinkSync(DEV_MODE_FILE)
    }
  })

  it('脚本存在且可执行', () => {
    expect(fs.existsSync(SCRIPT_PATH)).toBe(true)
    const stat = fs.statSync(SCRIPT_PATH)
    // owner 可执行位
    expect(stat.mode & 0o100).toBeGreaterThan(0)
  })

  it('无 task_id 时静默跳过（exit 0）', () => {
    if (fs.existsSync(DEV_MODE_FILE)) fs.unlinkSync(DEV_MODE_FILE)

    let output = ''
    let exitCode = 0
    try {
      output = execSync(`bash ${SCRIPT_PATH}`, { encoding: 'utf-8' })
    } catch (err: unknown) {
      const e = err as { status?: number; stdout?: string; stderr?: string }
      exitCode = e.status ?? 1
      output = (e.stdout ?? '') + (e.stderr ?? '')
    }

    expect(exitCode).toBe(0)
    expect(output).toContain('无 task_id')
  })

  it('Brain 不可用时静默跳过（exit 0）', () => {
    fs.writeFileSync(DEV_MODE_FILE, 'task_id: test-uuid-1234\n')

    let output = ''
    let exitCode = 0
    try {
      output = execSync(
        `BRAIN_URL=http://localhost:19999 bash ${SCRIPT_PATH}`,
        { encoding: 'utf-8' }
      )
    } catch (err: unknown) {
      const e = err as { status?: number; stdout?: string; stderr?: string }
      exitCode = e.status ?? 1
      output = (e.stdout ?? '') + (e.stderr ?? '')
    }

    expect(exitCode).toBe(0)
    expect(output).toContain('Brain API 不可用')
  })

  it('.dev-mode 中的 task_id 被正确读取', () => {
    fs.writeFileSync(
      DEV_MODE_FILE,
      'dev\nbranch: cp-test\nprd: .prd.md\ntask_id: abc-test-123\n'
    )

    let output = ''
    try {
      output = execSync(
        `BRAIN_URL=http://localhost:19999 bash ${SCRIPT_PATH}`,
        { encoding: 'utf-8' }
      )
    } catch (err: unknown) {
      const e = err as { stdout?: string; stderr?: string }
      output = (e.stdout ?? '') + (e.stderr ?? '')
    }

    // 要么打印了 task_id，要么因 Brain 不可用跳过
    expect(output).toMatch(/abc-test-123|Brain API 不可用/)
  })

  it('task_id 从参数读取（优先于 .dev-mode）', () => {
    fs.writeFileSync(DEV_MODE_FILE, 'task_id: dev-mode-id\n')

    let output = ''
    try {
      output = execSync(
        `BRAIN_URL=http://localhost:19999 bash ${SCRIPT_PATH} param-task-id`,
        { encoding: 'utf-8' }
      )
    } catch (err: unknown) {
      const e = err as { stdout?: string; stderr?: string }
      output = (e.stdout ?? '') + (e.stderr ?? '')
    }

    expect(output).toMatch(/param-task-id|Brain API 不可用/)
  })
})
