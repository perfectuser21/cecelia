import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

/**
 * Single-Exit Refactor Artifact Test
 *
 * stop-dev.sh 必须只有 1 个 `exit 0`（在文件末尾），所有早退路径通过 set 决策变量
 * 而非分散 exit 实现。这是 v22 历史教训：8 个分散 exit 让加日志/清理/观测都要追
 * 8 条路径。
 */
describe('stop-dev.sh — 单一出口纪律', () => {
  const HOOK_PATH = resolve(__dirname, '../../hooks/stop-dev.sh')
  const content = readFileSync(HOOK_PATH, 'utf8')

  it('exit 0 出现次数 = 1（含注释剔除）', () => {
    // 剔除注释行后再 grep，避免文档里 "exit 0" 字样误中
    const codeOnly = content
      .split('\n')
      .map(line => line.replace(/#.*$/, ''))  // 剔除行尾注释
      .join('\n')

    const matches = codeOnly.match(/\bexit\s+0\b/g) || []
    expect(matches.length).toBe(1)
  })

  it('唯一的 exit 0 在文件末尾（最后 5 行内）', () => {
    const lines = content.split('\n')
    const lastFiveLines = lines.slice(-5).join('\n')
    expect(lastFiveLines).toMatch(/^\s*exit\s+0\s*$/m)
  })

  it('没有 && exit 0 / || exit 0（单行复合早退）', () => {
    const codeOnly = content
      .split('\n')
      .map(line => line.replace(/#.*$/, ''))
      .join('\n')
    expect(codeOnly).not.toMatch(/&&\s*exit\s+0\b/)
    expect(codeOnly).not.toMatch(/\|\|\s*exit\s+0\b/)
  })
})
