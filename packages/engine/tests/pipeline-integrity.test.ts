/**
 * pipeline-integrity.test.ts
 *
 * CI pipeline 安全属性元检查
 *
 * 验证 /dev 工作流的 5 类安全不变量，防止已修复的 bug 回归：
 *   1. fail-closed    — API 错误时必须 exit 1，不能静默放行
 *   2. orphan（反模式）— stop hook 孤儿状态无上限阻止退出，不存在 N 次后放行
 *   3. gate 链完整性  — devloop-check.sh 包含 4 个必要 gate 条件
 *   4. 关键文件存在性  — pipeline 安全文件必须存在
 *   5. seal 格式校验  — divergence_count 门禁机制存在
 */

import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'fs'
import { resolve } from 'path'

const ROOT = resolve(__dirname, '../../..')

function read(relPath: string): string {
  return readFileSync(resolve(ROOT, relPath), 'utf-8')
}

// ============================================================================
// 1. fail-closed 属性
// ============================================================================

describe('fail-closed 属性', () => {
  it('pr-review.yml 在 API 调用全部失败时应 exit 1（阻止 PR 合并）', () => {
    const content = read('.github/workflows/pr-review.yml')
    // 所有重试耗尽后，必须有 exit 1（而不是 exit 0 或不处理）
    expect(content).toContain('exit 1')
  })

  it('pr-review.yml 应标记 API_ERROR=true 并拦截空内容', () => {
    const content = read('.github/workflows/pr-review.yml')
    // fail-closed 逻辑：空内容 → API_ERROR=true → exit 1
    expect(content).toContain('API_ERROR=true')
  })

  it('pr-review.yml 不应在 API 失败后 exit 0（禁止放行）', () => {
    const content = read('.github/workflows/pr-review.yml')
    const lines = content.split('\n')
    const apiErrorIdx = lines.findIndex(l => l.includes('API_ERROR=true'))
    expect(apiErrorIdx).toBeGreaterThan(-1)
    // API_ERROR 设置后的下一个 exit 命令必须是 exit 1
    const followingExit = lines.slice(apiErrorIdx, apiErrorIdx + 5).find(l => /exit\s+\d/.test(l))
    if (followingExit) {
      expect(followingExit).not.toMatch(/exit\s+0/)
    }
  })

  it('stop-dev.sh 安全默认：未匹配时应 exit 2（不能放行）', () => {
    const content = read('packages/engine/hooks/stop-dev.sh')
    // 安全默认注释 + exit 2
    expect(content).toContain('exit 2')
    // 明确记录"不能静默放行"或 fail-closed 的意图
    expect(content).toMatch(/fail.closed|不能静默放行|阻止退出/)
  })
})

// ============================================================================
// 2. 反模式扫描（N 次后放行）
// ============================================================================

describe('反模式：N 次后放行（已删除）', () => {
  it('stop-dev.sh 不应有孤儿计数超限后放行的逻辑（`_ORPHAN_COUNT -gt 5`）', () => {
    const content = read('packages/engine/hooks/stop-dev.sh')
    // 旧 bug：孤儿状态超过 5 次后 exit 0 放行
    // 修复后：永远 exit 2（无上限）
    expect(content).not.toContain('_ORPHAN_COUNT -gt 5')
  })

  it('stop-dev.sh 孤儿状态处理应无上限阻止退出', () => {
    const content = read('packages/engine/hooks/stop-dev.sh')
    // 明确记录孤儿状态无上限的意图
    expect(content).toContain('无上限')
  })

  // v16.0.0: divergence_count门禁已删除（Engine重构）
  it.skip('devloop-check.sh divergence_count=0 应被拦截（不能是橡皮图章）', () => {
    const content = read('packages/engine/lib/devloop-check.sh')
    // 必须检查 divergence_count
    expect(content).toContain('divergence_count')
    // 必须有 >= 1 的门禁逻辑（通过 check_divergence_count 函数实现）
    expect(content).toContain('check_divergence_count')
  })

  // v16.0.0: 自认证检测逻辑已删除（Engine重构）
  it.skip('devloop-check.sh 自认证检测：无 seal 但 .dev-mode 有 pass → 拦截', () => {
    const content = read('packages/engine/lib/devloop-check.sh')
    // 自认证检测文字
    expect(content).toContain('自认证')
  })
})

// ============================================================================
// 3. gate 链完整性
// ============================================================================

// v16.0.0: seal防伪机制及gate条件已删除（Engine重构）
describe.skip('gate 链完整性', () => {
  const GATES = [
    { key: 'dev-gate-spec', desc: '条件 1.5: spec_review seal 验证' },
    { key: 'dev-gate-planner', desc: '条件 1.6: planner seal 验证（Sprint Contract）' },
    { key: 'dev-gate-crg', desc: '条件 2.5: code_review_gate seal 验证' },
    { key: 'dev-gate-generator', desc: '条件 2.8: generator seal 验证' },
  ]

  for (const gate of GATES) {
    it(`devloop-check.sh 包含 ${gate.desc}（${gate.key}）`, () => {
      const content = read('packages/engine/lib/devloop-check.sh')
      expect(content).toContain(gate.key)
    })
  }

  it('devloop-check.sh gate 链顺序正确（spec → planner → crg → generator）', () => {
    const content = read('packages/engine/lib/devloop-check.sh')
    // 使用变量赋值位置（实现代码），避免注释中首次出现的顺序干扰
    const specIdx = content.indexOf('spec_seal_file=')
    const plannerIdx = content.indexOf('planner_seal_file=')
    const crgIdx = content.indexOf('crg_seal_file=')
    const generatorIdx = content.indexOf('generator_seal_file=')
    expect(specIdx).toBeGreaterThan(-1)
    expect(plannerIdx).toBeGreaterThan(-1)
    expect(crgIdx).toBeGreaterThan(-1)
    expect(generatorIdx).toBeGreaterThan(-1)
    // 顺序正确：spec(1.5) → planner(1.6) → crg(2.5) → generator(2.8)
    expect(specIdx).toBeLessThan(plannerIdx)
    expect(plannerIdx).toBeLessThan(crgIdx)
    expect(crgIdx).toBeLessThan(generatorIdx)
  })

  it('devloop-check.sh cleanup_done 作为最高优先级终止条件', () => {
    const content = read('packages/engine/lib/devloop-check.sh')
    expect(content).toContain('cleanup_done')
  })
})

// ============================================================================
// 4. 关键文件存在性
// ============================================================================

describe('关键文件存在性', () => {
  const CRITICAL_FILES = [
    'packages/engine/lib/devloop-check.sh',
    'packages/engine/hooks/stop-dev.sh',
    'packages/engine/hooks/branch-protect.sh',
    'packages/engine/hooks/verify-step.sh',
    'packages/engine/scripts/devgate/check-dod-mapping.cjs',
    'packages/engine/scripts/devgate/check-fake-dod-tests.cjs',
    '.github/workflows/pr-review.yml',
    '.github/workflows/ci-l1-process.yml',
  ]

  for (const file of CRITICAL_FILES) {
    it(`${file} 存在`, () => {
      expect(existsSync(resolve(ROOT, file))).toBe(true)
    })
  }
})

// ============================================================================
// 5. seal 格式校验
// ============================================================================

// v16.0.0: seal防伪机制及divergence_count门禁已删除（Engine重构）
describe.skip('seal 格式校验', () => {
  it('devloop-check.sh 验证 spec seal 文件的 verdict 字段', () => {
    const content = read('packages/engine/lib/devloop-check.sh')
    expect(content).toContain('spec_seal_verdict')
    expect(content).toContain('verdict')
  })

  it('devloop-check.sh spec seal FAIL → blocked（不能放行 FAIL verdict）', () => {
    const content = read('packages/engine/lib/devloop-check.sh')
    expect(content).toMatch(/spec_seal_verdict.*FAIL|FAIL.*spec_seal_verdict/)
  })

  it('devloop-check.sh code review gate seal 验证 verdict 字段', () => {
    const content = read('packages/engine/lib/devloop-check.sh')
    expect(content).toContain('crg_seal_verdict')
  })

  it('devloop-check.sh divergence_count 门禁：count=0 说明 Evaluator 是橡皮图章', () => {
    const content = read('packages/engine/lib/devloop-check.sh')
    expect(content).toContain('divergence_count')
    expect(content).toContain('check_divergence_count')
  })

  it('check_divergence_count 函数：count >= 1 才通过（-ge 1 断言）', () => {
    const content = read('packages/engine/lib/devloop-check.sh')
    expect(content).toContain('check_divergence_count()')
    expect(content).toContain('-ge 1')
  })
})
