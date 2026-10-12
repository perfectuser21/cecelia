import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

/**
 * 编码入口文档改投 coding_workflow（车道 A3）
 *
 * 背景：无头 harness_initiative 的 kernel 派发已关（A1 #6324，drain 标 failed=retired_harness_kernel），
 * 无头编码改由 coding_workflow runner 认领（A2 #6346），建单入口拒无头 harness_initiative（A4）。
 * 但 /dev 路径 C 与 line-strategist 路径C 仍教人 POST task_type=harness_initiative 点火，照做即 422 / 死单。
 * 本组钉住：两处点火都改建 coding_workflow 单，旧 harness-* skill 头部标注已废弃。
 */

const REPO = resolve(__dirname, '../../../..')
const read = (p: string) => readFileSync(resolve(REPO, p), 'utf8')

function section(text: string, start: string, end: RegExp): string {
  const i = text.indexOf(start)
  expect(i, `找不到段落：${start}`).toBeGreaterThanOrEqual(0)
  const rest = text.slice(i + start.length)
  const j = rest.search(end)
  return j === -1 ? rest : rest.slice(0, j)
}

describe('A3：编码点火文档改投 coding_workflow', () => {
  it('/dev 路径 C 建 coding_workflow 单（new-task.mjs 或 task_type=coding_workflow），不再教 harness_initiative', () => {
    const c = section(read('packages/engine/skills/dev/SKILL.md'), '### 路径 C：', /\n## /)
    expect(c).not.toMatch(/task_type\\?"?\s*:\s*\\?"harness_initiative/)
    expect(c).toContain('packages/brain/scripts/coding-workflow/new-task.mjs')
    expect(c).toMatch(/coding_workflow/)
    // 有头 /dev 自己记账的单必须带字符串 headed_manual
    expect(c).toMatch(/headed_manual\\?"?\s*:\s*\\?"true\\?"/)
  })

  it('line-strategist 路径C 建 coding_workflow 单，不再建 harness_initiative / skill-relay', () => {
    const c = section(read('packages/workflows/skills/line-strategist/SKILL.md'), '**路径C', /\n\*\*补货/)
    expect(c).not.toMatch(/"task_type"\s*:\s*"harness_initiative"/)
    expect(c).not.toContain('"orchestrator": "skill-relay"')
    expect(c).toMatch(/"task_type"\s*:\s*"coding_workflow"/)
    expect(c).toMatch(/"coding_workflow"\s*:\s*true/)
    expect(c).toMatch(/"acceptance"\s*:/)
  })

  it.each([
    'harness-planner',
    'harness-contract-proposer',
    'harness-contract-reviewer',
    'harness-generator',
    'harness-evaluator',
    'harness-report',
    'harness-controller',
  ])('%s SKILL 头部标注已废弃（description 首行 + frontmatter 后第一段）', (name) => {
    const text = read(`packages/workflows/skills/${name}/SKILL.md`)
    const m = text.match(/^---\n([\s\S]*?)\n---\n/)
    expect(m, 'frontmatter 必须保留').not.toBeNull()
    const desc = m![1].match(/description:\s*\|?\s*\n?\s*(.*)/)
    expect(desc?.[1]).toMatch(/^【已废弃/)
    const body = text.slice(m![0].length).trimStart()
    expect(body.startsWith('> **已废弃')).toBe(true)
    expect(body.split('\n')[0]).toContain('coding_workflow')
  })
})
