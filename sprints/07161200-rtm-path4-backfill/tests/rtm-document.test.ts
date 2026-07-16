import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'

const RTM_PATH = join(process.cwd(), 'docs/rtm/path4-customer-service.md')

describe('[BEHAVIOR] Path4 RTM 文档结构验证', () => {
  it('RTM 文档存在', () => {
    expect(existsSync(RTM_PATH)).toBe(true)
  })

  it('RTM 文档含等级判定标准（头部 L0-L3 定义）', () => {
    const content = readFileSync(RTM_PATH, 'utf-8')
    expect(content).toContain('L0')
    expect(content).toContain('L1')
    expect(content).toContain('L2')
    expect(content).toContain('L3')
    expect(content).toContain('真机')
  })

  it('RTM 文档含 DB 回填声明（建制W2）', () => {
    const content = readFileSync(RTM_PATH, 'utf-8')
    expect(content).toContain('建制W2')
    expect(content).toContain('verification_level')
  })

  it('RTM 表格含 16 行（S1-S16 全覆盖）', () => {
    const content = readFileSync(RTM_PATH, 'utf-8')
    const rows = [
      'S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8',
      'S9', 'S10', 'S11', 'S12', 'S13', 'S14', 'S15', 'S16',
    ]
    for (const step of rows) {
      expect(content).toContain(`| **${step}**`)
    }
  })

  it('抽样 S1：有取证指针 + 实际等级 + 承诺等级', () => {
    const content = readFileSync(RTM_PATH, 'utf-8')
    const s1Line = content.split('\n').find(l => l.includes('| **S1**'))
    expect(s1Line).toBeTruthy()
    expect(s1Line).toMatch(/golden-path-4-smoke\.sh:\d+/)
    expect(s1Line).toMatch(/L1|L2|L3/)
    expect(s1Line).toContain('L3')
  })

  it('抽样 S7：有真 API+DB 取证指针，实际等级 L2', () => {
    const content = readFileSync(RTM_PATH, 'utf-8')
    const s7Line = content.split('\n').find(l => l.includes('| **S7**'))
    expect(s7Line).toBeTruthy()
    expect(s7Line).toContain('L2')
    expect(s7Line).toMatch(/golden-path-4-smoke\.sh:\d+/)
    expect(s7Line).toContain('crm_customers')
  })

  it('抽样 S14：有取证指针 + 接缝步承诺 L3 + 差距说明', () => {
    const content = readFileSync(RTM_PATH, 'utf-8')
    const s14Line = content.split('\n').find(l => l.includes('| **S14**'))
    expect(s14Line).toBeTruthy()
    expect(s14Line).toContain('L3')
    expect(s14Line).toMatch(/golden-path-4-smoke\.sh:\d+/)
    expect(s14Line).toContain('auto_sent')
  })

  it('接缝步 S1/S6/S14/S16 均含 L3 承诺', () => {
    const content = readFileSync(RTM_PATH, 'utf-8')
    for (const step of ['S1', 'S6', 'S14', 'S16']) {
      const line = content.split('\n').find(l => l.includes(`| **${step}**`))
      expect(line, `${step} 行应含 L3 承诺`).toContain('L3')
    }
  })

  it('RTM 文档取证来源标注 zenithjoy-workspace', () => {
    const content = readFileSync(RTM_PATH, 'utf-8')
    expect(content).toContain('zenithjoy-workspace')
    expect(content).toContain('golden-path-4-smoke.sh')
  })
})
