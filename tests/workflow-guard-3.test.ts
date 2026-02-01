import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'fs'

describe('Workflow Guard Test 3', () => {
  const filePath = 'tests/workflow-guard-3.txt'

  it('文件应该存在', () => {
    expect(existsSync(filePath)).toBe(true)
  })

  it('文件应该包含测试编号 Test 3', () => {
    const content = readFileSync(filePath, 'utf-8')
    expect(content).toContain('Test #3')
  })

  it('文件应该包含时间戳', () => {
    const content = readFileSync(filePath, 'utf-8')
    expect(content).toContain('Created:')
    expect(content).toMatch(/\d{4}-\d{2}-\d{2}/)
  })

  it('文件应该包含测试目的', () => {
    const content = readFileSync(filePath, 'utf-8')
    expect(content).toContain('Purpose:')
    expect(content).toContain('Stop Hook')
  })

  it('文件应该包含测试轮次 3/10', () => {
    const content = readFileSync(filePath, 'utf-8')
    expect(content).toContain('Round: 3/10')
  })
})
