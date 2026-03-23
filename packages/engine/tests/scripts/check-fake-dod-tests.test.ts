import { describe, it, expect } from 'vitest'
import { createRequire } from 'module'
import path from 'path'

const require = createRequire(import.meta.url)
const { scanViolations, FAKE_PATTERNS } = require(
  path.resolve(__dirname, '../../scripts/devgate/check-fake-dod-tests.cjs')
)

function makeCard(testLine: string): string {
  return `---\nid: test\n---\n## 验收条件\n\n- [ ] [BEHAVIOR] 功能正常\n  ${testLine}\n`
}

describe('check-fake-dod-tests.cjs', () => {
  describe('FAKE_PATTERNS 定义', () => {
    it('应包含 10 个模式', () => {
      expect(FAKE_PATTERNS).toHaveLength(10)
    })

    it('每个模式应有 pattern 和 desc 字段', () => {
      for (const p of FAKE_PATTERNS) {
        expect(p.pattern).toBeInstanceOf(RegExp)
        expect(typeof p.desc).toBe('string')
      }
    })
  })

  describe('scanViolations — 通过情形（合法测试）', () => {
    it('manual:node -e 真实断言应通过', () => {
      const card = makeCard("Test: manual:node -e \"const c=require('fs').readFileSync('f','utf8');if(!c.includes('X'))process.exit(1)\"")
      expect(scanViolations(card)).toHaveLength(0)
    })

    it('tests/ 路径应通过', () => {
      const card = makeCard('Test: tests/devgate/check-fake-dod-tests.test.ts')
      expect(scanViolations(card)).toHaveLength(0)
    })

    it('contract: 应通过', () => {
      const card = makeCard('Test: contract:my-behavior-id')
      expect(scanViolations(card)).toHaveLength(0)
    })

    it('bash -c 带 process.exit 应通过（不匹配任何 fake 模式）', () => {
      const card = makeCard('Test: manual:bash -c "node -e \'process.exit(1)\'"')
      expect(scanViolations(card)).toHaveLength(0)
    })

    it('grep -c（输出数字，无 | wc）应通过', () => {
      const card = makeCard('Test: manual:bash -c "grep -c pattern file"')
      expect(scanViolations(card)).toHaveLength(0)
    })
  })

  describe('scanViolations — 拦截情形（假测试）', () => {
    it('echo 应被拦截', () => {
      const violations = scanViolations(makeCard('Test: echo hello'))
      expect(violations).toHaveLength(1)
      expect(violations[0].desc).toContain('echo')
    })

    it('manual:echo 也应被拦截', () => {
      const violations = scanViolations(makeCard('Test: manual:echo hello'))
      expect(violations).toHaveLength(1)
    })

    it('printf 应被拦截', () => {
      const violations = scanViolations(makeCard('Test: printf "hello"'))
      expect(violations).toHaveLength(1)
      expect(violations[0].desc).toContain('printf')
    })

    it('ls 应被拦截', () => {
      const violations = scanViolations(makeCard('Test: ls packages/engine'))
      expect(violations).toHaveLength(1)
      expect(violations[0].desc).toContain('ls')
    })

    it('cat 应被拦截', () => {
      const violations = scanViolations(makeCard('Test: cat file.txt'))
      expect(violations).toHaveLength(1)
      expect(violations[0].desc).toContain('cat')
    })

    it('true 应被拦截', () => {
      const violations = scanViolations(makeCard('Test: true'))
      expect(violations).toHaveLength(1)
      expect(violations[0].desc).toContain('true')
    })

    it('exit 0 应被拦截', () => {
      const violations = scanViolations(makeCard('Test: exit 0'))
      expect(violations).toHaveLength(1)
      expect(violations[0].desc).toContain('exit 0')
    })

    it('test -f 应被拦截', () => {
      const violations = scanViolations(makeCard('Test: manual:test -f file.txt'))
      expect(violations).toHaveLength(1)
      expect(violations[0].desc).toContain('test -f')
    })

    it('grep | wc 应被拦截', () => {
      const violations = scanViolations(makeCard('Test: manual:grep pattern file | wc'))
      expect(violations).toHaveLength(1)
      expect(violations[0].desc).toContain('grep | wc')
    })

    it('| wc -l 应被拦截', () => {
      const violations = scanViolations(makeCard('Test: manual:bash -c "find . | wc -l"'))
      expect(violations).toHaveLength(1)
      expect(violations[0].desc).toContain('wc -l')
    })

    it('wc 单独使用应被拦截', () => {
      const violations = scanViolations(makeCard('Test: wc file.txt'))
      expect(violations).toHaveLength(1)
      expect(violations[0].desc).toContain('wc')
    })
  })

  describe('scanViolations — 多违规情形', () => {
    it('包含两个假测试的 card 应返回两条违规', () => {
      const card = `---\nid: test\n---\n## 验收条件\n\n- [ ] [BEHAVIOR] A\n  Test: echo hello\n- [ ] [BEHAVIOR] B\n  Test: ls packages/\n`
      const violations = scanViolations(card)
      expect(violations).toHaveLength(2)
    })
  })

  describe('scanViolations — 空内容', () => {
    it('空 card 应通过（无违规）', () => {
      expect(scanViolations('')).toHaveLength(0)
    })

    it('无 Test: 行的 card 应通过', () => {
      const card = `---\nid: test\n---\n## 验收条件\n\n- [ ] [BEHAVIOR] 功能正常（无测试行）\n`
      expect(scanViolations(card)).toHaveLength(0)
    })
  })
})
