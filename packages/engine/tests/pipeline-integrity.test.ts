/**
 * Pipeline Integrity Gate — meta-test
 *
 * 验证 pipeline 自身的安全属性没有被削弱。
 * 这是测试的测试：检查 pipeline 安全不变量，不是业务功能。
 *
 * 分组：
 *   1. Fail-closed 属性（代码模式检查）
 *   2. 反模式扫描（N次后放行等危险模式）
 *   3. 必要文件完整性
 *   4. Seal 文件结构（devloop-check.sh 字段验证）
 *
 * Known-failing 测试在 ci/known-failures.json 中标记。
 */

import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// 仓库根目录（相对于 packages/engine/）
const ROOT = path.resolve(__dirname, '../../..')

function readFile(relPath: string): string {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8')
}

function fileExists(relPath: string): boolean {
  try {
    fs.accessSync(path.join(ROOT, relPath))
    return true
  } catch {
    return false
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// 1. Fail-closed 属性
// ──────────────────────────────────────────────────────────────────────────────

describe('Fail-closed 属性', () => {
  it('stop-dev.sh: 孤儿路径不含与 _ORPHAN_COUNT 相邻的 exit 0', () => {
    const content = readFile('packages/engine/hooks/stop-dev.sh')
    const lines = content.split('\n')

    // 找所有 exit 0 的行号
    const exit0Lines: number[] = []
    lines.forEach((line, i) => {
      if (/^\s*exit 0\s*(#.*)?$/.test(line)) {
        exit0Lines.push(i)
      }
    })

    // 对每个 exit 0，检查前后 5 行是否有 _ORPHAN_COUNT
    const badLines: number[] = []
    for (const lineIdx of exit0Lines) {
      const start = Math.max(0, lineIdx - 5)
      const end = Math.min(lines.length - 1, lineIdx + 5)
      const window = lines.slice(start, end + 1).join('\n')
      if (window.includes('_ORPHAN_COUNT')) {
        badLines.push(lineIdx + 1) // 转为 1-based 行号
      }
    }

    expect(badLines).toEqual([])
  })

  it('pr-review.yml: API 失败触发 exit 1（fail-closed）', () => {
    const content = readFile('.github/workflows/pr-review.yml')

    // 验证 fail-closed 关键词都存在
    expect(content).toContain('MAX_RETRY')
    expect(content).toContain('RETRY_COUNT')
    expect(content).toContain('API_ERROR')
    expect(content).toContain('exit 1')
  })

  /**
   * KNOWN-FAILING: pipeline-integrity-fallback-exit2
   *
   * stop-dev.sh 的 fallback 分支（devloop-check.sh 未加载时的内联逻辑）
   * 中包含 PR 查询和 exit 0 路径，尚未改为立即 exit 2（Agent 1 的 bug fix 待合并）。
   *
   * 预期行为（修复后）：fallback 分支不含任何内联 gh pr list 查询。
   */
  it('stop-dev.sh: fallback 分支必须 exit 2 而非继续执行', () => {
    const content = readFile('packages/engine/hooks/stop-dev.sh')

    // fallback 块：找到 "Fallback: devloop-check.sh 未加载" 注释的位置
    const fallbackStart = content.indexOf('# === Fallback: devloop-check.sh 未加载')
    expect(fallbackStart).toBeGreaterThan(-1)

    // 提取 fallback 块（从注释开始到文件末尾）
    const fallbackContent = content.slice(fallbackStart)

    // fallback 块内不应该有任何内联 PR 查询（gh pr list）
    // 因为 fallback 应该立刻 exit 2 而不是尝试完整查询
    // 当前代码包含内联 gh pr list → 这是已知 bug（known-failing）
    const hasInlinePrQuery = fallbackContent.includes('gh pr list')
    expect(hasInlinePrQuery).toBe(false)
  })

  /**
   * KNOWN-FAILING: pipeline-integrity-lockutils-flock
   *
   * lock-utils.sh 中 flock 不可用时（macOS 无 coreutils）静默 return 0，
   * 应该 return 1 表示锁获取失败（Agent 1 的 bug fix 待合并）。
   */
  it('lock-utils.sh: flock 不可用时返回失败而非静默成功', () => {
    const content = readFile('packages/engine/lib/lock-utils.sh')

    // 找到 flock 缺失检测块（跨行匹配）
    const flockMissingMatch = content.match(
      /if ! command -v flock[^fi]*?fi/s
    )
    expect(flockMissingMatch).not.toBeNull()

    // flock 不可用的分支不能有 return 0
    // 正确行为应该是 return 1（获取锁失败）
    const section = flockMissingMatch![0]
    expect(section).not.toContain('return 0')
  })
})

// ──────────────────────────────────────────────────────────────────────────────
// 2. 反模式扫描
// ──────────────────────────────────────────────────────────────────────────────

describe('反模式扫描', () => {
  const GATE_SCRIPTS = [
    'packages/engine/lib/devloop-check.sh',
    'packages/engine/hooks/stop-dev.sh',
    'packages/engine/hooks/branch-protect.sh',
    'packages/engine/hooks/verify-step.sh',
  ]

  it('gate 脚本中无 N-次-后-放行 模式（counter-based bypass）', () => {
    const violations: string[] = []

    for (const scriptPath of GATE_SCRIPTS) {
      const content = readFile(scriptPath)
      const lines = content.split('\n')

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]

        // 模式 1: _ORPHAN_COUNT -gt N 后接 exit 0（在接下来 5 行内）
        if (/_ORPHAN_COUNT\s+-gt\s+\d/.test(line)) {
          const window = lines.slice(i, Math.min(lines.length, i + 6)).join('\n')
          if (/^\s*exit 0\s*(#.*)?$/m.test(window)) {
            violations.push(`${scriptPath}:${i + 1}: _ORPHAN_COUNT -gt N 后接 exit 0`)
          }
        }

        // 模式 2: _RETRY_COUNT -ge N 后接 exit 0（在接下来 5 行内）
        if (/_RETRY_COUNT\s+-ge\s+\d/.test(line)) {
          const window = lines.slice(i, Math.min(lines.length, i + 6)).join('\n')
          if (/^\s*exit 0\s*(#.*)?$/m.test(window)) {
            violations.push(`${scriptPath}:${i + 1}: _RETRY_COUNT -ge N 后接 exit 0`)
          }
        }

        // 模式 3: RETRY_COUNT -ge N 后接 exit 0（避免误判 MAX_RETRY 比较）
        if (/\bRETRY_COUNT\s+-ge\s+\d/.test(line) && !line.includes('MAX_RETRY')) {
          const window = lines.slice(i, Math.min(lines.length, i + 6)).join('\n')
          if (/^\s*exit 0\s*(#.*)?$/m.test(window)) {
            violations.push(`${scriptPath}:${i + 1}: RETRY_COUNT -ge N 后接 exit 0`)
          }
        }
      }
    }

    expect(violations).toEqual([])
  })

  it('stop-dev.sh 孤儿路径（.dev-mode 缺失时）永远 exit 2', () => {
    const content = readFile('packages/engine/hooks/stop-dev.sh')

    // 孤儿路径：验证孤儿检测块以 exit 2 结束（fail-closed）
    expect(content).toContain('exit 2  # ← 永远阻止退出（fail-closed，无上限）')
  })

  it('stop-dev.sh 安全默认出口为 exit 2（兜底不能是 exit 0）', () => {
    const content = readFile('packages/engine/hooks/stop-dev.sh')

    // 验证安全默认注释存在（PR #550 修复验证）
    expect(content).toContain('安全默认：阻止退出（exit 2），不能静默放行')
  })
})

// ──────────────────────────────────────────────────────────────────────────────
// 3. 必要文件完整性
// ──────────────────────────────────────────────────────────────────────────────

describe('必要文件存在', () => {
  it('所有关键 pipeline 文件存在', () => {
    const required = [
      'packages/engine/hooks/stop-dev.sh',
      'packages/engine/hooks/branch-protect.sh',
      'packages/engine/hooks/verify-step.sh',
      'packages/engine/lib/devloop-check.sh',
      'packages/engine/lib/lock-utils.sh',
      'packages/engine/lib/ci-status.sh',
      '.github/workflows/pr-review.yml',
      'scripts/devgate/detect-review-issues.js',
    ]

    const missing: string[] = []
    for (const f of required) {
      if (!fileExists(f)) {
        missing.push(f)
      }
    }

    expect(missing).toEqual([])
  })

  it('L1-L4 workflow 文件存在', () => {
    const workflowDir = path.join(ROOT, '.github/workflows')
    const files = fs.readdirSync(workflowDir)

    // 验证至少有包含 L1、L2、L3、L4 的 workflow 文件
    const hasL1 = files.some(f => /l1/i.test(f))
    const hasL2 = files.some(f => /l2/i.test(f))
    const hasL3 = files.some(f => /l3/i.test(f))
    const hasL4 = files.some(f => /l4/i.test(f))

    expect(hasL1).toBe(true)
    expect(hasL2).toBe(true)
    expect(hasL3).toBe(true)
    expect(hasL4).toBe(true)
  })

  it('pr-review.yml 存在且非空', () => {
    const content = readFile('.github/workflows/pr-review.yml')
    expect(content.length).toBeGreaterThan(100)
    expect(content).toContain('on:')
    expect(content).toContain('jobs:')
  })
})

// ──────────────────────────────────────────────────────────────────────────────
// 4. Seal 文件验证逻辑
// ──────────────────────────────────────────────────────────────────────────────

describe('Seal 文件验证逻辑', () => {
  /**
   * KNOWN-FAILING: pipeline-integrity-devloop-verdict
   *
   * 验证 devloop-check.sh 中存在对 seal 文件 .verdict 字段的检查。
   * 当前代码中已有 jq -r '.verdict' 检查，此测试预期通过。
   * 若此测试失败，说明 devloop-check.sh 删除了 verdict 检查（安全退化）。
   */
  it('devloop-check.sh 验证 seal verdict 字段', () => {
    const content = readFile('packages/engine/lib/devloop-check.sh')

    // 必须包含对 .verdict 字段的检查（jq -r '.verdict' 或类似形式）
    const hasVerdictCheck =
      content.includes("jq -r '.verdict") ||
      content.includes('jq -r ".verdict')
    expect(hasVerdictCheck).toBe(true)
  })

  /**
   * KNOWN-FAILING: pipeline-integrity-devloop-divergence
   *
   * 验证 devloop-check.sh 中存在对 seal 文件 .divergence_count 字段的检查。
   * 当前代码中已有此检查，此测试预期通过。
   * 若此测试失败，说明发生了安全退化。
   */
  it('devloop-check.sh 验证 seal divergence_count 字段', () => {
    const content = readFile('packages/engine/lib/devloop-check.sh')

    // 必须包含对 .divergence_count 字段的存在性验证
    const hasDivergenceCheck = content.includes('.divergence_count')
    expect(hasDivergenceCheck).toBe(true)
  })

  it('stop-dev.sh 安全出口不依赖文件读取失败静默通过（PR #550 修复保留）', () => {
    const content = readFile('packages/engine/hooks/stop-dev.sh')

    // 验证关键安全注释：PR #550 修复
    // 之前 exit 0 导致状态文件写坏时 Stop Hook 完全失效
    expect(content).toContain('PR #550 修复')
  })
})
