import { describe, it, expect } from 'vitest'
import { createRequire } from 'module'
import path from 'path'

const require = createRequire(import.meta.url)
const { scanManualViolations, extractManualCommand, ALLOWED_COMMANDS } = require(
  path.resolve(__dirname, '../../scripts/devgate/check-manual-cmd-whitelist.cjs')
)

function makeCard(testLine: string): string {
  return `---\nid: test\n---\n## 验收条件\n\n- [ ] [BEHAVIOR] 功能正常\n  ${testLine}\n`
}

describe('check-manual-cmd-whitelist.cjs', () => {
  describe('ALLOWED_COMMANDS 定义', () => {
    it('应包含 node/npm/npx/curl/bash/psql', () => {
      expect(ALLOWED_COMMANDS.has('node')).toBe(true)
      expect(ALLOWED_COMMANDS.has('npm')).toBe(true)
      expect(ALLOWED_COMMANDS.has('npx')).toBe(true)
      expect(ALLOWED_COMMANDS.has('curl')).toBe(true)
      expect(ALLOWED_COMMANDS.has('bash')).toBe(true)
      expect(ALLOWED_COMMANDS.has('psql')).toBe(true)
    })

    it('不应包含 grep/ls/cat/find/sed/awk', () => {
      expect(ALLOWED_COMMANDS.has('grep')).toBe(false)
      expect(ALLOWED_COMMANDS.has('ls')).toBe(false)
      expect(ALLOWED_COMMANDS.has('cat')).toBe(false)
      expect(ALLOWED_COMMANDS.has('find')).toBe(false)
      expect(ALLOWED_COMMANDS.has('sed')).toBe(false)
      expect(ALLOWED_COMMANDS.has('awk')).toBe(false)
    })
  })

  describe('extractManualCommand', () => {
    it('提取 manual: 后的命令名', () => {
      expect(extractManualCommand('  Test: manual:node -e "..."')).toBe('node')
      expect(extractManualCommand('  Test: manual:npm run test')).toBe('npm')
      expect(extractManualCommand('  Test: manual:grep pattern file')).toBe('grep')
    })

    it('非 manual: 行返回 null', () => {
      expect(extractManualCommand('  Test: tests/my.test.ts')).toBeNull()
      expect(extractManualCommand('  Test: contract:behavior')).toBeNull()
      expect(extractManualCommand('- [ ] [BEHAVIOR] 某功能')).toBeNull()
    })

    it('大写命令名转小写', () => {
      expect(extractManualCommand('  Test: manual:NODE -e "..."')).toBe('node')
    })
  })

  describe('scanManualViolations — 通过情形（白名单命令）', () => {
    it('manual:node -e 应通过', () => {
      const card = makeCard("Test: manual:node -e \"const c=require('fs').readFileSync('f','utf8');if(!c.includes('X'))process.exit(1)\"")
      expect(scanManualViolations(card)).toHaveLength(0)
    })

    it('manual:npm run test 应通过', () => {
      const card = makeCard('Test: manual:npm run test:unit')
      expect(scanManualViolations(card)).toHaveLength(0)
    })

    it('manual:npx vitest 应通过', () => {
      const card = makeCard('Test: manual:npx vitest run --reporter=verbose')
      expect(scanManualViolations(card)).toHaveLength(0)
    })

    it('manual:curl 应通过', () => {
      const card = makeCard('Test: manual:curl -sf http://localhost:5221/api/health')
      expect(scanManualViolations(card)).toHaveLength(0)
    })

    it('manual:bash -c 应通过', () => {
      const card = makeCard('Test: manual:bash -c "node -e \'process.exit(0)\'"')
      expect(scanManualViolations(card)).toHaveLength(0)
    })

    it('manual:psql 应通过', () => {
      const card = makeCard("Test: manual:psql -c 'SELECT 1'")
      expect(scanManualViolations(card)).toHaveLength(0)
    })

    it('非 manual: 行（tests/）应通过', () => {
      const card = makeCard('Test: tests/devgate/check-manual-cmd-whitelist.test.ts')
      expect(scanManualViolations(card)).toHaveLength(0)
    })

    it('非 manual: 行（contract:）应通过', () => {
      const card = makeCard('Test: contract:my-behavior-id')
      expect(scanManualViolations(card)).toHaveLength(0)
    })
  })

  describe('scanManualViolations — 拦截情形（非白名单命令）', () => {
    it('manual:grep 应被拦截', () => {
      const violations = scanManualViolations(makeCard('Test: manual:grep pattern file'))
      expect(violations).toHaveLength(1)
      expect(violations[0].cmd).toBe('grep')
    })

    it('manual:ls 应被拦截', () => {
      const violations = scanManualViolations(makeCard('Test: manual:ls packages/engine'))
      expect(violations).toHaveLength(1)
      expect(violations[0].cmd).toBe('ls')
    })

    it('manual:cat 应被拦截', () => {
      const violations = scanManualViolations(makeCard('Test: manual:cat file.txt'))
      expect(violations).toHaveLength(1)
      expect(violations[0].cmd).toBe('cat')
    })

    it('manual:find 应被拦截', () => {
      const violations = scanManualViolations(makeCard('Test: manual:find . -name "*.ts"'))
      expect(violations).toHaveLength(1)
      expect(violations[0].cmd).toBe('find')
    })

    it('manual:sed 应被拦截', () => {
      const violations = scanManualViolations(makeCard("Test: manual:sed 's/foo/bar/' file"))
      expect(violations).toHaveLength(1)
      expect(violations[0].cmd).toBe('sed')
    })

    it('manual:awk 应被拦截', () => {
      const violations = scanManualViolations(makeCard("Test: manual:awk '{print $1}' file"))
      expect(violations).toHaveLength(1)
      expect(violations[0].cmd).toBe('awk')
    })

    it('manual:python 应被拦截（不在白名单）', () => {
      const violations = scanManualViolations(makeCard('Test: manual:python script.py'))
      expect(violations).toHaveLength(1)
      expect(violations[0].cmd).toBe('python')
    })
  })

  describe('scanManualViolations — 多违规', () => {
    it('两条非白名单命令应返回两条违规', () => {
      const card = `---\nid: test\n---\n## 验收条件\n\n- [ ] [BEHAVIOR] A\n  Test: manual:grep pattern f\n- [ ] [BEHAVIOR] B\n  Test: manual:cat file.txt\n`
      expect(scanManualViolations(card)).toHaveLength(2)
    })
  })

  describe('scanManualViolations — 边界情形', () => {
    it('空内容应通过', () => {
      expect(scanManualViolations('')).toHaveLength(0)
    })

    it('无 Test: 行应通过', () => {
      const card = `---\nid: test\n---\n## 验收条件\n\n- [ ] [BEHAVIOR] 功能（无测试行）\n`
      expect(scanManualViolations(card)).toHaveLength(0)
    })
  })
})
