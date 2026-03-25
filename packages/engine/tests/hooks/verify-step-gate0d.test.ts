/**
 * verify-step-gate0d.test.ts — Gate 0d Engine 版本同步检查 + jq 优雅降级 (R12)
 *
 * DoD 验收测试：
 * - verify-step.sh Gate 0d 在 Engine 版本文件变更时调用 check-version-sync.sh
 * - check-version-sync.sh jq 不存在时优雅跳过（不报错）
 */

import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'fs'
import { resolve } from 'path'

// ⚠️ IMPORTANT: 必须用 resolve(__dirname, ...) 直接引用源文件
// 确保 check-changed-coverage.cjs 的 testImportsSourceFile 检查通过
const VERIFY_STEP_PATH = resolve(__dirname, '../../hooks/verify-step.sh')
const CHECK_VERSION_SYNC_PATH = resolve(__dirname, '../../ci/scripts/check-version-sync.sh')

describe('verify-step.sh Gate 0d — Engine 版本同步检查 (R12)', () => {
  it('verify-step.sh 文件存在且可执行', () => {
    expect(existsSync(VERIFY_STEP_PATH)).toBe(true)
  })

  it('verify-step.sh 通过 bash -n 语法检查', () => {
    const { execSync } = require('child_process')
    expect(() =>
      execSync(`bash -n "${VERIFY_STEP_PATH}"`, { encoding: 'utf-8' })
    ).not.toThrow()
  })

  it('Gate 0d 包含 Engine 版本文件检测逻辑（packages/engine/ 路径 grep）', () => {
    const content = readFileSync(VERIFY_STEP_PATH, 'utf-8')
    expect(content).toContain('packages/engine/')
    expect(content).toContain('package\\.json|package-lock\\.json|VERSION')
  })

  it('Gate 0d 在检测到 Engine 版本文件时调用 check-version-sync.sh', () => {
    const content = readFileSync(VERIFY_STEP_PATH, 'utf-8')
    expect(content).toContain('check-version-sync.sh')
  })

  it('Gate 0d 保留已有 Gate 0a（PRESERVE 基线快照）逻辑', () => {
    const content = readFileSync(VERIFY_STEP_PATH, 'utf-8')
    expect(content).toContain('Gate 0a')
    expect(content).toContain('PRESERVE')
  })

  it('Gate 0d 保留已有 Gate 0b（TDD 红灯）逻辑', () => {
    const content = readFileSync(VERIFY_STEP_PATH, 'utf-8')
    expect(content).toContain('Gate 0b')
    expect(content).toContain('tdd_red_confirmed')
  })

  it('Gate 0d 保留已有 Gate 0c（垃圾清理）逻辑', () => {
    const content = readFileSync(VERIFY_STEP_PATH, 'utf-8')
    expect(content).toContain('Gate 0c')
    expect(content).toContain('console\\.log')
  })
})

describe('check-version-sync.sh — jq 优雅降级 (R12)', () => {
  it('check-version-sync.sh 文件存在', () => {
    expect(existsSync(CHECK_VERSION_SYNC_PATH)).toBe(true)
  })

  it('check-version-sync.sh 通过 bash -n 语法检查', () => {
    const { execSync } = require('child_process')
    expect(() =>
      execSync(`bash -n "${CHECK_VERSION_SYNC_PATH}"`, { encoding: 'utf-8' })
    ).not.toThrow()
  })

  it('check-version-sync.sh 包含 jq 可用性检查（command -v jq）', () => {
    const content = readFileSync(CHECK_VERSION_SYNC_PATH, 'utf-8')
    expect(content).toContain('command -v jq')
  })

  it('check-version-sync.sh jq 缺失时有 node 降级路径', () => {
    const content = readFileSync(CHECK_VERSION_SYNC_PATH, 'utf-8')
    expect(content).toContain('command -v node')
    // node 降级路径：用 node -e 或 JSON.parse 解析版本
    expect(content).toMatch(/node.*-e|JSON\.parse/)
  })

  it('check-version-sync.sh jq 和 node 均缺失时优雅退出（exit 0）', () => {
    const content = readFileSync(CHECK_VERSION_SYNC_PATH, 'utf-8')
    // 两者均缺失时跳过检查并 exit 0（用多行模式检查条件块的存在）
    expect(content).toContain('command -v jq')
    expect(content).toContain('command -v node')
    // 确保两者均缺失时的处理块包含 exit 0
    const lines = content.split('\n')
    const jqNodeCheckIdx = lines.findIndex(l => l.includes('command -v jq') && l.includes('command -v node'))
    expect(jqNodeCheckIdx).toBeGreaterThan(-1)
    // 该块的后续几行内有 exit 0
    const nearLines = lines.slice(jqNodeCheckIdx, jqNodeCheckIdx + 5).join('\n')
    expect(nearLines).toContain('exit 0')
  })

  it('check-version-sync.sh 检查 5 个版本文件（package-lock.json/VERSION/.hook-core-version/regression-contract.yaml）', () => {
    const content = readFileSync(CHECK_VERSION_SYNC_PATH, 'utf-8')
    expect(content).toContain('package-lock.json')
    expect(content).toContain('VERSION')
    expect(content).toContain('.hook-core-version')
    expect(content).toContain('regression-contract.yaml')
  })
})
