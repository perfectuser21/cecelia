import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

describe('Generator subagent Stage 2 spec', () => {
  const skillFile = join(__dirname, '../skills/dev/steps/02-code.md')

  it('02-code.md 版本为 v6.0.0', () => {
    const content = readFileSync(skillFile, 'utf8')
    expect(content).toContain('version: 6.0.0')
  })

  it('02-code.md 包含 Generator subagent 派发节', () => {
    const content = readFileSync(skillFile, 'utf8')
    expect(content).toContain('## 2.2 Generator subagent 派发')
  })

  it('02-code.md 包含 Generator 内部执行节（原 2.2 重命名为 2.2.5）', () => {
    const content = readFileSync(skillFile, 'utf8')
    expect(content).toContain('## 2.2.5 Generator 内部执行')
  })

  it('Generator subagent 隔离约束在文件中明确声明', () => {
    const content = readFileSync(skillFile, 'utf8')
    expect(content).toContain('禁止调用 localhost:5221')
  })

  it('02-code.md 保留 2.3 自验证节（防回归）', () => {
    const content = readFileSync(skillFile, 'utf8')
    expect(content).toContain('## 2.3 自验证')
  })

  it('02-code.md 保留 2.4 code_review_gate 节（防回归）', () => {
    const content = readFileSync(skillFile, 'utf8')
    expect(content).toContain('## 2.4 执行 code_review_gate')
  })
})
