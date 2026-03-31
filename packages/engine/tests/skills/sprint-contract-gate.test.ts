/**
 * sprint-contract-gate.test.ts
 *
 * 验证 Sprint Contract Gate 和 Evaluator Calibration 功能：
 *   1. code-review-gate SKILL.md 包含 Evaluator Calibration 章节（少样本锚定）
 *   2. spec-review SKILL.md 包含双向协商机制（Sprint Contract）
 *   3. spec-review SKILL.md 输出字段包含 independent_test_plans + negotiation_result
 *   4. 01-spec.md Sprint Contract Gate 硬门禁机制存在
 *
 * 对应 PR: feat(engine): Sprint Contract Gate — /dev 双向协商 DoD + Evaluator Calibration
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const ENGINE_DIR = resolve(__dirname, '../..')
const WORKFLOWS_DIR = resolve(__dirname, '../../../workflows')

function readWorkflowSkill(skill: string): string {
  return readFileSync(resolve(WORKFLOWS_DIR, `skills/${skill}/SKILL.md`), 'utf-8')
}

function readEngineStep(step: string): string {
  return readFileSync(resolve(ENGINE_DIR, `skills/dev/steps/${step}`), 'utf-8')
}

// ============================================================================
// code-review-gate: Evaluator Calibration
// ============================================================================

describe('code-review-gate — Evaluator Calibration 章节', () => {
  it('SKILL.md 包含 Evaluator Calibration 章节', () => {
    const content = readWorkflowSkill('code-review-gate')
    expect(content).toContain('Evaluator Calibration')
  })

  it('包含明确 FAIL 锚定示例', () => {
    const content = readWorkflowSkill('code-review-gate')
    expect(content).toContain('明确 FAIL')
  })

  it('包含明确 PASS 锚定示例', () => {
    const content = readWorkflowSkill('code-review-gate')
    expect(content).toContain('明确 PASS')
  })

  it('包含边界案例锚定示例', () => {
    const content = readWorkflowSkill('code-review-gate')
    expect(content).toContain('边界案例')
  })

  it('裁决规则包含全通过制说明', () => {
    const content = readWorkflowSkill('code-review-gate')
    expect(content).toContain('全通过制')
  })

  it('全通过制规则明确指出 blocker 导致整体 FAIL', () => {
    const content = readWorkflowSkill('code-review-gate')
    // 全通过制核心语义：任何 blocker = 整体 FAIL
    expect(content).toMatch(/blocker.*FAIL|FAIL.*blocker/s)
  })

  it('SQL 注入示例作为 FAIL 案例存在', () => {
    const content = readWorkflowSkill('code-review-gate')
    // 示例 1 — FAIL 场景包含 SQL 注入漏洞
    expect(content).toContain('SQL 注入')
  })
})

// ============================================================================
// spec-review: Sprint Contract 双向协商机制
// ============================================================================

describe('spec-review — Sprint Contract 双向协商机制', () => {
  it('SKILL.md 包含 Sprint Contract 章节', () => {
    const content = readWorkflowSkill('spec-review')
    expect(content).toContain('Sprint Contract')
  })

  it('包含双向协商机制描述', () => {
    const content = readWorkflowSkill('spec-review')
    expect(content).toContain('双向协商')
  })

  it('输出 JSON 必须包含 independent_test_plans 字段', () => {
    const content = readWorkflowSkill('spec-review')
    expect(content).toContain('independent_test_plans')
  })

  it('输出 JSON 必须包含 negotiation_result 字段', () => {
    const content = readWorkflowSkill('spec-review')
    expect(content).toContain('negotiation_result')
  })

  it('严重分歧应导致 FAIL', () => {
    const content = readWorkflowSkill('spec-review')
    // Sprint Contract 核心：主 agent 测试方案无法验证 DoD 时 = FAIL
    expect(content).toMatch(/严重分歧.*FAIL|Sprint Contract.*FAIL/s)
  })

  it('independent_test_plans 字段包含 dod_item + my_test + agent_test 子字段', () => {
    const content = readWorkflowSkill('spec-review')
    expect(content).toContain('dod_item')
    expect(content).toContain('my_test')
    expect(content).toContain('agent_test')
  })

  it('negotiation_result 字段存在一致性标记', () => {
    const content = readWorkflowSkill('spec-review')
    expect(content).toContain('consistent')
  })
})

// ============================================================================
// 01-spec.md: Sprint Contract Gate 硬门禁
// ============================================================================

describe('01-spec.md — Sprint Contract Gate 硬门禁', () => {
  it('01-spec.md 包含 Sprint Contract Gate', () => {
    const content = readEngineStep('01-spec.md')
    expect(content).toContain('Sprint Contract Gate')
  })

  it('Sprint Contract Gate 包含 exit 1 或 exit 2 硬门禁（失败时阻断流程）', () => {
    const content = readEngineStep('01-spec.md')
    // 硬门禁必须有 exit 非 0
    expect(content).toMatch(/exit\s+[12]/)
  })

  it('seal 文件必须包含 independent_test_plans', () => {
    const content = readEngineStep('01-spec.md')
    expect(content).toContain('independent_test_plans')
  })

  it('Stage 1 末尾流程说明 Sprint Contract Gate 是必须通过的关卡', () => {
    const content = readEngineStep('01-spec.md')
    // Gate 必须明确描述为必须通过（非可选）
    expect(content).toMatch(/Sprint Contract Gate.*(硬门禁|must|必须|FAIL|exit)/s)
  })
})
