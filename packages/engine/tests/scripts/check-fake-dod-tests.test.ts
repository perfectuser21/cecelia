import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execSync, spawnSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import os from 'os'

const SCRIPT = path.resolve(__dirname, '../../scripts/devgate/check-fake-dod-tests.cjs')

function runCheck(taskCardContent: string): { code: number; stdout: string; stderr: string } {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-dod-test-'))
  const cardPath = path.join(tmpDir, '.task-test.md')
  fs.writeFileSync(cardPath, taskCardContent)

  const result = spawnSync('node', [SCRIPT, cardPath], {
    cwd: tmpDir,
    encoding: 'utf8',
  })

  fs.rmSync(tmpDir, { recursive: true, force: true })

  return {
    code: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  }
}

describe('check-fake-dod-tests.cjs', () => {
  describe('通过情形（合法测试）', () => {
    it('manual:node -e 真实断言应通过', () => {
      const card = `
## 验收条件

- [ ] [BEHAVIOR] 功能正常
  Test: manual:node -e "const c=require('fs').readFileSync('file','utf8');if(!c.includes('X'))process.exit(1)"
`
      const { code } = runCheck(card)
      expect(code).toBe(0)
    })

    it('tests/ 路径应通过', () => {
      const card = `
- [ ] [BEHAVIOR] 测试覆盖
  Test: tests/my.test.ts
`
      const { code } = runCheck(card)
      expect(code).toBe(0)
    })

    it('contract: 格式应通过', () => {
      const card = `
- [ ] [BEHAVIOR] 契约检查
  Test: contract:my-behavior-id
`
      const { code } = runCheck(card)
      expect(code).toBe(0)
    })

    it('manual:bash 真实命令应通过', () => {
      const card = `
- [ ] [BEHAVIOR] bash 检查
  Test: manual:bash -c "npm test 2>&1 | tail -5"
`
      const { code } = runCheck(card)
      expect(code).toBe(0)
    })
  })

  describe('拦截情形（假测试）', () => {
    it('echo 命令应被拦截', () => {
      const card = `
- [ ] [BEHAVIOR] 假测试
  Test: manual:echo "passed"
`
      const { code, stderr } = runCheck(card)
      expect(code).toBe(1)
      expect(stderr).toContain('echo')
    })

    it('ls 命令应被拦截', () => {
      const card = `
- [ ] [BEHAVIOR] 假测试
  Test: ls packages/
`
      const { code, stderr } = runCheck(card)
      expect(code).toBe(1)
      expect(stderr).toContain('ls')
    })

    it('cat 命令应被拦截', () => {
      const card = `
- [ ] [BEHAVIOR] 假测试
  Test: manual:cat file.txt
`
      const { code, stderr } = runCheck(card)
      expect(code).toBe(1)
      expect(stderr).toContain('cat')
    })

    it('grep | wc 组合应被拦截', () => {
      const card = `
- [ ] [BEHAVIOR] 假测试
  Test: manual:grep -c pattern file | wc -l
`
      const { code, stderr } = runCheck(card)
      expect(code).toBe(1)
      expect(stderr).toContain('wc')
    })

    it('| wc -l 应被拦截', () => {
      const card = `
- [ ] [BEHAVIOR] 假测试
  Test: manual:npm run something | wc -l
`
      const { code, stderr } = runCheck(card)
      expect(code).toBe(1)
      expect(stderr).toContain('wc')
    })

    it('true 命令应被拦截', () => {
      const card = `
- [ ] [BEHAVIOR] 假测试
  Test: true
`
      const { code, stderr } = runCheck(card)
      expect(code).toBe(1)
      expect(stderr).toContain('true')
    })

    it('exit 0 应被拦截', () => {
      const card = `
- [ ] [BEHAVIOR] 假测试
  Test: exit 0
`
      const { code, stderr } = runCheck(card)
      expect(code).toBe(1)
      expect(stderr).toContain('exit 0')
    })

    it('printf 应被拦截', () => {
      const card = `
- [ ] [BEHAVIOR] 假测试
  Test: manual:printf "ok\n"
`
      const { code, stderr } = runCheck(card)
      expect(code).toBe(1)
      expect(stderr).toContain('printf')
    })
  })

  describe('错误处理', () => {
    it('文件不存在时应 exit 1', () => {
      const result = spawnSync('node', [SCRIPT, '/nonexistent/path/.task.md'], {
        encoding: 'utf8',
      })
      expect(result.status).toBe(1)
    })

    it('无参数时应 exit 1', () => {
      const result = spawnSync('node', [SCRIPT], { encoding: 'utf8' })
      expect(result.status).toBe(1)
    })
  })
})
