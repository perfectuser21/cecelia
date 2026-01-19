import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

describe('test-automation.txt', () => {
  const filePath = join(__dirname, 'test-automation.txt')

  it('文件存在', () => {
    expect(existsSync(filePath)).toBe(true)
  })

  it('文件包含时间戳', () => {
    const content = readFileSync(filePath, 'utf-8')
    expect(content).toContain('2026-01-19')
    expect(content).toContain('timestamp')
  })

  it('文件包含 Notion 任务 ID', () => {
    const content = readFileSync(filePath, 'utf-8')
    expect(content).toContain('2ed53f413ec581e2aeedd0fd3fc99a43')
  })

  it('文件包含自动化流程说明', () => {
    const content = readFileSync(filePath, 'utf-8')
    expect(content).toContain('automated')
    expect(content).toContain('workflow')
  })
})
