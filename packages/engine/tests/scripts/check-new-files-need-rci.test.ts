import { describe, it, expect } from 'vitest'
import { createRequire } from 'module'
import path from 'path'

const require = createRequire(import.meta.url)
const { scanMissingRci, extractRciFiles, toRelativePath, TARGET_DIRS } = require(
  path.resolve(__dirname, '../../scripts/devgate/check-new-files-need-rci.cjs')
)

/** 构造一段包含若干 file: 条目的 YAML 内容 */
function makeContract(...files: string[]): string {
  const entries = files
    .map((f) => `  - id: H99\n    description: test\n    file: "${f}"`)
    .join('\n')
  return `hooks:\n${entries}\n`
}

describe('check-new-files-need-rci.cjs', () => {
  describe('TARGET_DIRS 定义', () => {
    it('应包含 hooks/ 和 scripts/devgate/', () => {
      expect(TARGET_DIRS).toContain('packages/engine/hooks/')
      expect(TARGET_DIRS).toContain('packages/engine/scripts/devgate/')
    })
  })

  describe('toRelativePath', () => {
    it('去掉 packages/engine/ 前缀', () => {
      expect(toRelativePath('packages/engine/hooks/foo.sh')).toBe('hooks/foo.sh')
      expect(toRelativePath('packages/engine/scripts/devgate/bar.cjs')).toBe(
        'scripts/devgate/bar.cjs'
      )
    })

    it('非 packages/engine/ 路径返回 null', () => {
      expect(toRelativePath('packages/brain/src/server.js')).toBeNull()
      expect(toRelativePath('apps/dashboard/src/App.tsx')).toBeNull()
      expect(toRelativePath('README.md')).toBeNull()
    })
  })

  describe('extractRciFiles', () => {
    it('提取双引号包裹的 file: 值', () => {
      const yaml = `hooks:\n  - id: H1\n    file: "hooks/branch-protect.sh"\n`
      const files = extractRciFiles(yaml)
      expect(files.has('hooks/branch-protect.sh')).toBe(true)
    })

    it('提取无引号的 file: 值', () => {
      const yaml = `hooks:\n  - id: H1\n    file: hooks/branch-protect.sh\n`
      const files = extractRciFiles(yaml)
      expect(files.has('hooks/branch-protect.sh')).toBe(true)
    })

    it('提取多个 file: 条目', () => {
      const yaml = makeContract('hooks/a.sh', 'hooks/b.sh', 'scripts/devgate/c.cjs')
      const files = extractRciFiles(yaml)
      expect(files.has('hooks/a.sh')).toBe(true)
      expect(files.has('hooks/b.sh')).toBe(true)
      expect(files.has('scripts/devgate/c.cjs')).toBe(true)
    })

    it('空内容返回空 Set', () => {
      expect(extractRciFiles('').size).toBe(0)
    })

    it('无 file: 条目返回空 Set', () => {
      const yaml = `hooks:\n  - id: H1\n    description: test\n`
      expect(extractRciFiles(yaml).size).toBe(0)
    })
  })

  describe('scanMissingRci — 通过情形', () => {
    it('空文件列表返回空数组', () => {
      expect(scanMissingRci([], 'anything')).toHaveLength(0)
    })

    it('null 文件列表返回空数组', () => {
      expect(scanMissingRci(null as any, 'anything')).toHaveLength(0)
    })

    it('非目标路径文件直接跳过', () => {
      const added = [
        'packages/engine/src/index.ts',
        'packages/brain/src/server.js',
        'apps/dashboard/src/App.tsx',
      ]
      expect(scanMissingRci(added, '')).toHaveLength(0)
    })

    it('hooks/ 下有 RCI 的文件应通过', () => {
      const added = ['packages/engine/hooks/branch-protect.sh']
      const contract = makeContract('hooks/branch-protect.sh')
      expect(scanMissingRci(added, contract)).toHaveLength(0)
    })

    it('scripts/devgate/ 下有 RCI 的文件应通过', () => {
      const added = ['packages/engine/scripts/devgate/check-new-files-need-rci.cjs']
      const contract = makeContract('scripts/devgate/check-new-files-need-rci.cjs')
      expect(scanMissingRci(added, contract)).toHaveLength(0)
    })

    it('混合（目标+非目标）只检查目标路径', () => {
      const added = [
        'packages/engine/src/utils.ts',    // 非目标
        'packages/engine/hooks/new.sh',    // 目标，有 RCI
      ]
      const contract = makeContract('hooks/new.sh')
      expect(scanMissingRci(added, contract)).toHaveLength(0)
    })
  })

  describe('scanMissingRci — 拦截情形', () => {
    it('hooks/ 下无 RCI 的新文件被拦截', () => {
      const added = ['packages/engine/hooks/new-hook.sh']
      const contract = makeContract('hooks/other.sh')
      const violations = scanMissingRci(added, contract)
      expect(violations).toHaveLength(1)
      expect(violations[0].file).toBe('packages/engine/hooks/new-hook.sh')
      expect(violations[0].relativePath).toBe('hooks/new-hook.sh')
    })

    it('scripts/devgate/ 下无 RCI 的新文件被拦截', () => {
      const added = ['packages/engine/scripts/devgate/new-check.cjs']
      const contract = makeContract('scripts/devgate/other.cjs')
      const violations = scanMissingRci(added, contract)
      expect(violations).toHaveLength(1)
      expect(violations[0].relativePath).toBe('scripts/devgate/new-check.cjs')
    })

    it('合约内容为空时，目标路径文件被拦截', () => {
      const added = ['packages/engine/hooks/anything.sh']
      expect(scanMissingRci(added, '')).toHaveLength(1)
    })

    it('两个新增文件均缺少 RCI 时返回两条违规', () => {
      const added = [
        'packages/engine/hooks/hook-a.sh',
        'packages/engine/scripts/devgate/check-b.cjs',
      ]
      const contract = makeContract('hooks/other.sh')
      const violations = scanMissingRci(added, contract)
      expect(violations).toHaveLength(2)
    })

    it('部分有 RCI、部分无 RCI 时只报无 RCI 的', () => {
      const added = [
        'packages/engine/hooks/existing.sh',   // 有 RCI
        'packages/engine/hooks/missing.sh',    // 无 RCI
      ]
      const contract = makeContract('hooks/existing.sh')
      const violations = scanMissingRci(added, contract)
      expect(violations).toHaveLength(1)
      expect(violations[0].file).toBe('packages/engine/hooks/missing.sh')
    })
  })

  describe('scanMissingRci — 违规对象格式', () => {
    it('违规对象包含 file 和 relativePath 字段', () => {
      const added = ['packages/engine/hooks/new.sh']
      const contract = makeContract('hooks/other.sh')
      const violations = scanMissingRci(added, contract)
      expect(violations[0]).toHaveProperty('file')
      expect(violations[0]).toHaveProperty('relativePath')
    })
  })
})
