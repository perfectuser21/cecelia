/**
 * @file generate-feedback-report.test.ts
 * @description 测试 generate-feedback-report-v2.sh 脚本
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execSync } from 'child_process'
import fs from 'fs'
import path from 'path'

const SCRIPT_PATH = 'skills/dev/scripts/generate-feedback-report-v2.sh'
const LOG_FILE = '.dev-execution-log.jsonl'
const EXPECTATIONS_FILE = 'skills/dev/lib/step-expectations.json'
const REPORT_DIR = 'docs/dev-reports'

describe('generate-feedback-report-v2.sh', () => {
  beforeEach(() => {
    // 清理报告目录
    if (fs.existsSync(REPORT_DIR)) {
      fs.rmSync(REPORT_DIR, { recursive: true })
    }

    // 创建测试日志
    const testLog = [
      {
        step: '01-prd',
        start: 1707380400,
        end: 1707380723,
        duration: 323,
        status: 'success',
        issues: [],
        retries: 0,
      },
      {
        step: '05-code',
        start: 1707380800,
        end: 1707381925,
        duration: 1125,
        status: 'success',
        issues: ['架构冲突导致重构'],
        retries: 2,
      },
    ]

    fs.writeFileSync(LOG_FILE, testLog.map((e) => JSON.stringify(e)).join('\n'))
  })

  afterEach(() => {
    // 清理测试文件
    if (fs.existsSync(LOG_FILE)) {
      fs.unlinkSync(LOG_FILE)
    }
    if (fs.existsSync(REPORT_DIR)) {
      fs.rmSync(REPORT_DIR, { recursive: true })
    }
  })

  it('应该生成报告文件', () => {
    execSync(`bash ${SCRIPT_PATH}`)

    expect(fs.existsSync(REPORT_DIR)).toBe(true)

    const files = fs.readdirSync(REPORT_DIR)
    expect(files.length).toBeGreaterThan(0)

    const reportFile = path.join(REPORT_DIR, files[0])
    const content = fs.readFileSync(reportFile, 'utf-8')

    expect(content).toContain('# /dev 执行报告')
    expect(content).toContain('效率维度')
    expect(content).toContain('稳定性维度')
    expect(content).toContain('自动化维度')
    expect(content).toContain('质量维度')
  })

  it('应该包含效率维度数据', () => {
    execSync(`bash ${SCRIPT_PATH}`)

    const files = fs.readdirSync(REPORT_DIR)
    const reportFile = path.join(REPORT_DIR, files[0])
    const content = fs.readFileSync(reportFile, 'utf-8')

    expect(content).toContain('01-prd')
    expect(content).toContain('323s')
    expect(content).toContain('05-code')
    expect(content).toContain('1125s')
  })

  it('应该包含稳定性维度数据', () => {
    execSync(`bash ${SCRIPT_PATH}`)

    const files = fs.readdirSync(REPORT_DIR)
    const reportFile = path.join(REPORT_DIR, files[0])
    const content = fs.readFileSync(reportFile, 'utf-8')

    expect(content).toContain('重试次数')
    expect(content).toContain('CI 通过率')
  })

  it('应该包含自动化维度数据', () => {
    execSync(`bash ${SCRIPT_PATH}`)

    const files = fs.readdirSync(REPORT_DIR)
    const reportFile = path.join(REPORT_DIR, files[0])
    const content = fs.readFileSync(reportFile, 'utf-8')

    expect(content).toContain('自动化程度')
    expect(content).toContain('automation_rate')
  })

  it('应该包含改进建议', () => {
    execSync(`bash ${SCRIPT_PATH}`)

    const files = fs.readdirSync(REPORT_DIR)
    const reportFile = path.join(REPORT_DIR, files[0])
    const content = fs.readFileSync(reportFile, 'utf-8')

    expect(content).toContain('改进建议')
    expect(content).toContain('P0')
    expect(content).toContain('P1')
    expect(content).toContain('P2')
  })
})
