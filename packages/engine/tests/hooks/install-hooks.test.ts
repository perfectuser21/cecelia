/**
 * install-hooks.test.ts - Tests for CI tools installation
 *
 * DoD H3-001 验收测试
 *
 * Tests:
 * - packages/engine/VERSION 格式正确（ci-tools/VERSION 已删除，统一使用 packages/engine/VERSION）
 * - scripts/devgate/ 包含 DevGate 脚本
 * - scripts/install-hooks.sh 正确安装
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execSync } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import { tmpdir } from 'os'

const ROOT = path.resolve(__dirname, '../..')
const DEVGATE_DIR = path.join(ROOT, 'scripts/devgate')
const INSTALL_SCRIPT = path.join(ROOT, 'scripts/install-hooks.sh')
const TEST_DIR = path.join(tmpdir(), 'test-ci-tools-install-vitest')

/** Type for hook configuration object */
interface HookConfig {
  matcher: string;
  hooks: Array<{ type: string; command: string }>;
}

describe('engine 版本文件结构', () => {
  // ci-tools/ 目录已删除（原为符号链接目录，冗余设计）
  // 统一使用 packages/engine/VERSION 作为版本来源

  describe('packages/engine/VERSION 文件', () => {
    it('VERSION 文件存在', () => {
      const versionFile = path.join(ROOT, 'VERSION')
      expect(fs.existsSync(versionFile)).toBe(true)
    })

    it('VERSION 格式正确 (semver)', () => {
      const versionFile = path.join(ROOT, 'VERSION')
      const version = fs.readFileSync(versionFile, 'utf-8').trim()
      // semver 格式: MAJOR.MINOR.PATCH
      expect(version).toMatch(/^\d+\.\d+\.\d+$/)
    })

    it('VERSION 不为空', () => {
      const versionFile = path.join(ROOT, 'VERSION')
      const version = fs.readFileSync(versionFile, 'utf-8').trim()
      expect(version.length).toBeGreaterThan(0)
    })
  })

  describe('scripts/devgate 目录', () => {
    it('devgate 目录存在', () => {
      expect(fs.existsSync(DEVGATE_DIR)).toBe(true)
      expect(fs.statSync(DEVGATE_DIR).isDirectory()).toBe(true)
    })

    it('包含 check-dod-mapping.cjs', () => {
      const scriptFile = path.join(DEVGATE_DIR, 'check-dod-mapping.cjs')
      expect(fs.existsSync(scriptFile)).toBe(true)
    })

    it('包含 detect-priority.cjs', () => {
      const scriptFile = path.join(DEVGATE_DIR, 'detect-priority.cjs')
      expect(fs.existsSync(scriptFile)).toBe(true)
    })

    it('包含 snapshot 相关脚本', () => {
      const snapshotScript = path.join(DEVGATE_DIR, 'snapshot-prd-dod.sh')
      expect(fs.existsSync(snapshotScript)).toBe(true)
    })

    it('devgate 脚本是有效的真实文件（非符号链接）', () => {
      const files = fs.readdirSync(DEVGATE_DIR)
      expect(files.length).toBeGreaterThan(0)

      for (const file of files) {
        const filePath = path.join(DEVGATE_DIR, file)
        const stat = fs.lstatSync(filePath)
        // ci-tools 删除后，scripts/devgate/ 应只含真实文件
        expect(stat.isFile()).toBe(true)
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
      expect(output).toContain('CI tools version:')
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

      // 验证 skills 目录
      expect(fs.existsSync(path.join(TEST_DIR, 'skills/dev/SKILL.md'))).toBe(true)

      // 验证 .claude/settings.json
      expect(fs.existsSync(path.join(TEST_DIR, '.claude/settings.json'))).toBe(true)

      // 验证版本标记
      expect(fs.existsSync(path.join(TEST_DIR, '.ci-tools-version'))).toBe(true)
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
        (h) => h.matcher === 'Write|Edit|NotebookEdit' || h.matcher === 'Write|Edit'
      )
      expect(writeEditHook).toBeDefined()
      expect(writeEditHook!.hooks[0].command).toContain('branch-protect.sh')
    })

    it('版本标记与 packages/engine/VERSION 文件一致', () => {
      const versionMarker = fs.readFileSync(path.join(TEST_DIR, '.ci-tools-version'), 'utf-8').trim()
      const versionFile = fs.readFileSync(path.join(ROOT, 'VERSION'), 'utf-8').trim()
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
