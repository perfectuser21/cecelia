/**
 * install-hooks.test.ts - Tests for hook-core installation
 *
 * DoD H3-001 验收测试
 *
 * Tests:
 * - hook-core/VERSION 格式正确
 * - hook-core/hooks/ 包含核心 hooks
 * - hook-core/scripts/devgate/ 包含 DevGate 脚本
 * - scripts/install-hooks.sh 正确安装
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execSync } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import { tmpdir } from 'os'

const ROOT = path.resolve(__dirname, '../..')
const HOOK_CORE_DIR = path.join(ROOT, 'hook-core')
const INSTALL_SCRIPT = path.join(ROOT, 'scripts/install-hooks.sh')
const TEST_DIR = path.join(tmpdir(), 'test-hook-core-install-vitest')

/** Type for hook configuration object */
interface HookConfig {
  matcher: string;
  hooks: Array<{ type: string; command: string }>;
}

describe('hook-core 目录结构', () => {
  describe('VERSION 文件', () => {
    it('VERSION 文件存在', () => {
      const versionFile = path.join(HOOK_CORE_DIR, 'VERSION')
      expect(fs.existsSync(versionFile)).toBe(true)
    })

    it('VERSION 格式正确 (semver)', () => {
      const versionFile = path.join(HOOK_CORE_DIR, 'VERSION')
      const version = fs.readFileSync(versionFile, 'utf-8').trim()
      // semver 格式: MAJOR.MINOR.PATCH
      expect(version).toMatch(/^\d+\.\d+\.\d+$/)
    })

    it('VERSION 不为空', () => {
      const versionFile = path.join(HOOK_CORE_DIR, 'VERSION')
      const version = fs.readFileSync(versionFile, 'utf-8').trim()
      expect(version.length).toBeGreaterThan(0)
    })
  })

  describe('hooks 目录', () => {
    it('hooks 目录存在', () => {
      const hooksDir = path.join(HOOK_CORE_DIR, 'hooks')
      expect(fs.existsSync(hooksDir)).toBe(true)
      expect(fs.statSync(hooksDir).isDirectory()).toBe(true)
    })

    it('包含 branch-protect.sh', () => {
      const hookFile = path.join(HOOK_CORE_DIR, 'hooks/branch-protect.sh')
      expect(fs.existsSync(hookFile)).toBe(true)
    })

    it('包含 pr-gate-v2.sh', () => {
      const hookFile = path.join(HOOK_CORE_DIR, 'hooks/pr-gate-v2.sh')
      expect(fs.existsSync(hookFile)).toBe(true)
    })

    it('hooks 是有效文件或符号链接', () => {
      const hooksDir = path.join(HOOK_CORE_DIR, 'hooks')
      const files = fs.readdirSync(hooksDir)
      expect(files.length).toBeGreaterThan(0)

      for (const file of files) {
        const filePath = path.join(hooksDir, file)
        const stat = fs.lstatSync(filePath)
        // 要么是普通文件，要么是符号链接
        expect(stat.isFile() || stat.isSymbolicLink()).toBe(true)

        // 如果是符号链接，验证目标存在
        if (stat.isSymbolicLink()) {
          const realPath = fs.realpathSync(filePath)
          expect(fs.existsSync(realPath)).toBe(true)
        }
      }
    })
  })

  describe('scripts/devgate 目录', () => {
    it('devgate 目录存在', () => {
      const devgateDir = path.join(HOOK_CORE_DIR, 'scripts/devgate')
      expect(fs.existsSync(devgateDir)).toBe(true)
      expect(fs.statSync(devgateDir).isDirectory()).toBe(true)
    })

    it('包含 check-dod-mapping.cjs', () => {
      const scriptFile = path.join(HOOK_CORE_DIR, 'scripts/devgate/check-dod-mapping.cjs')
      expect(fs.existsSync(scriptFile)).toBe(true)
    })

    it('包含 detect-priority.cjs', () => {
      const scriptFile = path.join(HOOK_CORE_DIR, 'scripts/devgate/detect-priority.cjs')
      expect(fs.existsSync(scriptFile)).toBe(true)
    })

    it('包含 snapshot 相关脚本', () => {
      const snapshotScript = path.join(HOOK_CORE_DIR, 'scripts/devgate/snapshot-prd-dod.sh')
      const listScript = path.join(HOOK_CORE_DIR, 'scripts/devgate/list-snapshots.sh')
      const viewScript = path.join(HOOK_CORE_DIR, 'scripts/devgate/view-snapshot.sh')
      expect(fs.existsSync(snapshotScript)).toBe(true)
      expect(fs.existsSync(listScript)).toBe(true)
      expect(fs.existsSync(viewScript)).toBe(true)
    })

    it('devgate 脚本是有效文件或符号链接', () => {
      const devgateDir = path.join(HOOK_CORE_DIR, 'scripts/devgate')
      const files = fs.readdirSync(devgateDir)
      expect(files.length).toBeGreaterThan(0)

      for (const file of files) {
        const filePath = path.join(devgateDir, file)
        const stat = fs.lstatSync(filePath)
        expect(stat.isFile() || stat.isSymbolicLink()).toBe(true)

        if (stat.isSymbolicLink()) {
          const realPath = fs.realpathSync(filePath)
          expect(fs.existsSync(realPath)).toBe(true)
        }
      }
    })
  })
})

describe('install-hooks.sh 安装脚本', () => {
  describe('脚本基础功能', () => {
    it('脚本存在且可执行', () => {
      expect(fs.existsSync(INSTALL_SCRIPT)).toBe(true)
      const stat = fs.statSync(INSTALL_SCRIPT)
      // 检查是否有执行权限 (owner execute bit)
      expect((stat.mode & 0o100) !== 0).toBe(true)
    })

    it('--version 显示版本信息', () => {
      const output = execSync(`bash ${INSTALL_SCRIPT} --version`, {
        encoding: 'utf-8',
        cwd: ROOT,
      })
      expect(output).toContain('hook-core version:')
      expect(output).toMatch(/\d+\.\d+\.\d+/)
    })

    it('--help 显示帮助信息', () => {
      const output = execSync(`bash ${INSTALL_SCRIPT} --help`, {
        encoding: 'utf-8',
        cwd: ROOT,
      })
      expect(output).toContain('Usage:')
      expect(output).toContain('--dry-run')
      expect(output).toContain('--force')
    })

    it('bash -n 语法检查通过', () => {
      // bash -n 只做语法检查，不执行
      const result = execSync(`bash -n ${INSTALL_SCRIPT}`, {
        encoding: 'utf-8',
        cwd: ROOT,
      })
      // 没有输出 = 语法正确
      expect(result).toBe('')
    })
  })

  describe('安装功能', () => {
    beforeAll(() => {
      // 创建测试目录并初始化 git
      execSync(`rm -rf ${TEST_DIR} && mkdir -p ${TEST_DIR}`)
      execSync(`cd ${TEST_DIR} && git init --quiet`)
    })

    afterAll(() => {
      // 清理测试目录
      execSync(`rm -rf ${TEST_DIR}`)
    })

    it('--dry-run 不创建文件', () => {
      execSync(`bash ${INSTALL_SCRIPT} --dry-run ${TEST_DIR}`, {
        encoding: 'utf-8',
        cwd: ROOT,
      })
      // dry-run 不应该创建 hooks 目录
      expect(fs.existsSync(path.join(TEST_DIR, 'hooks'))).toBe(false)
    })

    it('安装创建所有必要文件', () => {
      execSync(`bash ${INSTALL_SCRIPT} ${TEST_DIR}`, {
        encoding: 'utf-8',
        cwd: ROOT,
      })

      // 验证 hooks 目录
      expect(fs.existsSync(path.join(TEST_DIR, 'hooks/branch-protect.sh'))).toBe(true)
      expect(fs.existsSync(path.join(TEST_DIR, 'hooks/pr-gate-v2.sh'))).toBe(true)

      // 验证 skills 目录
      expect(fs.existsSync(path.join(TEST_DIR, 'skills/dev/SKILL.md'))).toBe(true)
      expect(fs.existsSync(path.join(TEST_DIR, 'skills/audit/SKILL.md'))).toBe(true)
      expect(fs.existsSync(path.join(TEST_DIR, 'skills/qa/SKILL.md'))).toBe(true)

      // 验证 .claude/settings.json
      expect(fs.existsSync(path.join(TEST_DIR, '.claude/settings.json'))).toBe(true)

      // 验证版本标记
      expect(fs.existsSync(path.join(TEST_DIR, '.hook-core-version'))).toBe(true)
    })

    it('安装的文件是真实文件（非符号链接）', () => {
      const hookFile = path.join(TEST_DIR, 'hooks/branch-protect.sh')
      const stat = fs.lstatSync(hookFile)
      expect(stat.isSymbolicLink()).toBe(false)
      expect(stat.isFile()).toBe(true)
    })

    it('settings.json 配置正确', () => {
      const settingsPath = path.join(TEST_DIR, '.claude/settings.json')
      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'))

      expect(settings.hooks).toBeDefined()
      expect(settings.hooks.PreToolUse).toBeDefined()
      expect(Array.isArray(settings.hooks.PreToolUse)).toBe(true)

      // 检查 Write|Edit matcher
      const writeEditHook = (settings.hooks.PreToolUse as HookConfig[]).find(
        (h) => h.matcher === 'Write|Edit|NotebookEdit'
      )
      expect(writeEditHook).toBeDefined()
      expect(writeEditHook!.hooks[0].command).toContain('branch-protect.sh')

      // 检查 Bash matcher
      const bashHook = (settings.hooks.PreToolUse as HookConfig[]).find(
        (h) => h.matcher === 'Bash'
      )
      expect(bashHook).toBeDefined()
      expect(bashHook!.hooks[0].command).toContain('pr-gate-v2.sh')
    })

    it('版本标记与 VERSION 文件一致', () => {
      const versionMarker = fs.readFileSync(path.join(TEST_DIR, '.hook-core-version'), 'utf-8').trim()
      const versionFile = fs.readFileSync(path.join(HOOK_CORE_DIR, 'VERSION'), 'utf-8').trim()
      expect(versionMarker).toBe(versionFile)
    })

    it('--force 可以覆盖已存在的文件', () => {
      // 先修改一个文件
      const hookFile = path.join(TEST_DIR, 'hooks/branch-protect.sh')
      fs.writeFileSync(hookFile, '# modified')

      // 强制安装
      execSync(`bash ${INSTALL_SCRIPT} --force ${TEST_DIR}`, {
        encoding: 'utf-8',
        cwd: ROOT,
      })

      // 验证文件被覆盖
      const content = fs.readFileSync(hookFile, 'utf-8')
      expect(content).not.toBe('# modified')
      // 原始文件是完整的 hook 脚本，应该以 shebang 开头且有一定长度
      expect(content).toContain('#!/usr/bin/env bash')
      expect(content.length).toBeGreaterThan(1000)
    })
  })

  describe('错误处理', () => {
    it('目标目录不存在时报错', () => {
      expect(() => {
        execSync(`bash ${INSTALL_SCRIPT} /nonexistent/directory`, {
          encoding: 'utf-8',
          cwd: ROOT,
          stdio: 'pipe',
        })
      }).toThrow()
    })
  })
})
