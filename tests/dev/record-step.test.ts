/**
 * @file record-step.test.ts
 * @description 测试 record-step.sh 脚本
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execSync } from 'child_process'
import fs from 'fs'
import path from 'path'

const SCRIPT_PATH = 'skills/dev/scripts/record-step.sh'
const LOG_FILE = '.dev-execution-log.jsonl'
const TEMP_DIR = '.dev-temp'

describe('record-step.sh', () => {
  beforeEach(() => {
    // 清理测试环境
    if (fs.existsSync(LOG_FILE)) {
      fs.unlinkSync(LOG_FILE)
    }
    if (fs.existsSync(TEMP_DIR)) {
      fs.rmSync(TEMP_DIR, { recursive: true })
    }
  })

  afterEach(() => {
    // 清理测试环境
    if (fs.existsSync(LOG_FILE)) {
      fs.unlinkSync(LOG_FILE)
    }
    if (fs.existsSync(TEMP_DIR)) {
      fs.rmSync(TEMP_DIR, { recursive: true })
    }
  })

  it('应该记录步骤开始时间', () => {
    execSync(`bash ${SCRIPT_PATH} start prd`)

    const tempFile = path.join(TEMP_DIR, '01-prd.start')
    expect(fs.existsSync(tempFile)).toBe(true)

    const startTime = parseInt(fs.readFileSync(tempFile, 'utf-8').trim())
    expect(startTime).toBeGreaterThan(0)
  })

  it('应该记录步骤结束并写入日志', () => {
    // 先记录开始
    execSync(`bash ${SCRIPT_PATH} start prd`)

    // 等待 1 秒
    execSync('sleep 1')

    // 记录结束
    execSync(`bash ${SCRIPT_PATH} end prd success`)

    // 检查日志文件
    expect(fs.existsSync(LOG_FILE)).toBe(true)

    const logContent = fs.readFileSync(LOG_FILE, 'utf-8').trim()
    const logEntry = JSON.parse(logContent)

    expect(logEntry.step).toBe('01-prd')
    expect(logEntry.status).toBe('success')
    expect(logEntry.duration).toBeGreaterThanOrEqual(1)
    expect(logEntry.retries).toBe(0)
    expect(logEntry.issues).toEqual([])
  })

  it('应该正确记录重试次数', () => {
    execSync(`bash ${SCRIPT_PATH} start code`)
    execSync(`bash ${SCRIPT_PATH} retry code`)
    execSync(`bash ${SCRIPT_PATH} retry code`)
    execSync(`bash ${SCRIPT_PATH} end code success`)

    const logContent = fs.readFileSync(LOG_FILE, 'utf-8').trim()
    const logEntry = JSON.parse(logContent)

    expect(logEntry.step).toBe('05-code')
    expect(logEntry.retries).toBe(2)
  })

  it('应该正确记录问题列表', () => {
    execSync(`bash ${SCRIPT_PATH} start code`)
    execSync(`bash ${SCRIPT_PATH} issue code "架构冲突"`)
    execSync(`bash ${SCRIPT_PATH} issue code "需要重构"`)
    execSync(`bash ${SCRIPT_PATH} end code success`)

    const logContent = fs.readFileSync(LOG_FILE, 'utf-8').trim()
    const logEntry = JSON.parse(logContent)

    expect(logEntry.step).toBe('05-code')
    expect(logEntry.issues).toContain('架构冲突')
    expect(logEntry.issues).toContain('需要重构')
  })

  it('应该清理临时文件', () => {
    execSync(`bash ${SCRIPT_PATH} start prd`)
    execSync(`bash ${SCRIPT_PATH} end prd success`)

    const tempFile = path.join(TEMP_DIR, '01-prd.start')
    expect(fs.existsSync(tempFile)).toBe(false)
  })
})
