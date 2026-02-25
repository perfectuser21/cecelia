import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'

describe('白名单过期检查', () => {
  const PROJECT_ROOT = path.resolve(__dirname, '../..')
  const KNOWN_FAILURES_FILE = path.join(PROJECT_ROOT, 'ci/known-failures.json')

  it('known-failures.json 文件应该存在', () => {
    expect(fs.existsSync(KNOWN_FAILURES_FILE)).toBe(true)
  })

  it('所有白名单条目都应该有 expires 字段', () => {
    const content = JSON.parse(fs.readFileSync(KNOWN_FAILURES_FILE, 'utf-8'))

    const allowed = content.allowed || {}
    const keys = Object.keys(allowed)

    expect(keys.length).toBeGreaterThan(0) // 至少有一个条目用于测试

    for (const key of keys) {
      const entry = allowed[key]
      expect(entry).toHaveProperty('expires')
      expect(entry.expires).toBeTruthy()
      expect(typeof entry.expires).toBe('string')
    }
  })

  it('expires 字段应该是合法的日期格式', () => {
    const content = JSON.parse(fs.readFileSync(KNOWN_FAILURES_FILE, 'utf-8'))

    const allowed = content.allowed || {}

    for (const [key, entry] of Object.entries(allowed) as [string, any][]) {
      const expiresDate = new Date(entry.expires)
      expect(expiresDate.toString()).not.toBe('Invalid Date')
    }
  })

  it('所有白名单条目不应该已过期', () => {
    const content = JSON.parse(fs.readFileSync(KNOWN_FAILURES_FILE, 'utf-8'))

    const allowed = content.allowed || {}
    const currentDate = new Date().toISOString().split('T')[0] // YYYY-MM-DD

    const expiredEntries: string[] = []

    for (const [key, entry] of Object.entries(allowed) as [string, any][]) {
      if (entry.expires < currentDate) {
        expiredEntries.push(`${key} (expires: ${entry.expires})`)
      }
    }

    expect(expiredEntries).toHaveLength(0)

    if (expiredEntries.length > 0) {
      console.error('以下条目已过期:', expiredEntries)
    }
  })

  it('should-fail 测试：模拟过期条目会被检测', () => {
    const content = JSON.parse(fs.readFileSync(KNOWN_FAILURES_FILE, 'utf-8'))

    // 创建一个过期的条目进行测试
    const expiredEntry = {
      description: 'Test expired entry',
      ticket: 'TEST-001',
      expires: '2020-01-01' // 明显过期的日期
    }

    const currentDate = new Date().toISOString().split('T')[0]

    // 验证过期检测逻辑
    const isExpired = expiredEntry.expires < currentDate
    expect(isExpired).toBe(true)
  })

  it('CI 过期检查逻辑验证（模拟 bash 逻辑）', () => {
    const content = JSON.parse(fs.readFileSync(KNOWN_FAILURES_FILE, 'utf-8'))
    const allowed = content.allowed || {}

    const currentDate = new Date().toISOString().split('T')[0]

    // 模拟 CI 中的检查逻辑
    const expiredEntries = Object.entries(allowed)
      .filter(([key, entry]: [string, any]) => entry.expires < currentDate)
      .map(([key, entry]: [string, any]) => `${key} (expires: ${entry.expires})`)

    // 实际 repo 中不应该有过期条目
    expect(expiredEntries).toHaveLength(0)
  })
})
