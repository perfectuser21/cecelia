import { describe, it, expect } from 'vitest'
import { execSync } from 'child_process'

describe('generate-gate-file.sh', () => {
  it('应该接受所有 6 种 gate 类型', () => {
    const validTypes = ['prd', 'dod', 'test', 'audit', 'qa', 'learning']

    validTypes.forEach(type => {
      // 使用 --help 模式测试，不实际执行生成
      const result = execSync(
        `bash scripts/gate/generate-gate-file.sh ${type} --dry-run 2>&1 || true`,
        { encoding: 'utf-8' }
      )

      // 不应该包含"无效的 gate 类型"错误
      expect(result).not.toContain('无效的 gate 类型')
    })
  })

  it('应该拒绝无效的 gate 类型', () => {
    const invalidTypes = ['invalid', 'unknown', 'xxx']

    invalidTypes.forEach(type => {
      const result = execSync(
        `bash scripts/gate/generate-gate-file.sh ${type} 2>&1 || true`,
        { encoding: 'utf-8' }
      )

      // 应该包含"无效的 gate 类型"错误
      expect(result).toContain('无效的 gate 类型')
    })
  })

  it('应该在帮助信息中列出所有 6 种 gate 类型', () => {
    const result = execSync(
      'bash scripts/gate/generate-gate-file.sh 2>&1 || true',
      { encoding: 'utf-8' }
    )

    // 应该列出所有有效类型
    expect(result).toContain('prd')
    expect(result).toContain('dod')
    expect(result).toContain('test')
    expect(result).toContain('audit')
    expect(result).toContain('qa')
    expect(result).toContain('learning')
  })
})
