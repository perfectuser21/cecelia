import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import os from 'os'

/**
 * 测试 safe_rm_rf 函数的安全验证逻辑
 * safe_rm_rf 在以下脚本中实现：
 * - worktree-manage.sh
 * - cleanup.sh
 * - deploy.sh
 *
 * 验证逻辑：
 * 1. 路径非空检查
 * 2. 路径存在检查
 * 3. 路径在允许的父目录内
 * 4. 禁止删除系统关键目录
 */
describe('safe_rm_rf', () => {
  let testDir: string
  let originalCwd: string

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'safe-rm-test-'))
    originalCwd = process.cwd()
    process.chdir(testDir)
  })

  afterEach(() => {
    process.chdir(originalCwd)
    fs.rmSync(testDir, { recursive: true, force: true })
  })

  // 创建包含 safe_rm_rf 函数的测试脚本
  const createTestScript = (testCode: string) => {
    const script = `#!/usr/bin/env bash
set -euo pipefail

RED='\\033[0;31m'
YELLOW='\\033[1;33m'
NC='\\033[0m'

# safe_rm_rf 函数（从 worktree-manage.sh 复制）
safe_rm_rf() {
    local path="\$1"
    local allowed_parent="\$2"

    # 验证 1: 路径非空
    if [[ -z "\$path" ]]; then
        echo -e "\${RED}错误: rm -rf 路径为空，拒绝执行\${NC}" >&2
        return 1
    fi

    # 验证 2: 路径存在
    if [[ ! -e "\$path" ]]; then
        echo -e "\${YELLOW}警告: 路径不存在: \$path\${NC}" >&2
        return 0
    fi

    # 验证 3: 路径在允许的父目录内
    local real_path
    real_path=\$(realpath "\$path" 2>/dev/null) || real_path="\$path"
    local real_parent
    real_parent=\$(realpath "\$allowed_parent" 2>/dev/null) || real_parent="\$allowed_parent"

    if [[ "\$real_path" != "\$real_parent"* ]]; then
        echo -e "\${RED}错误: 路径 \$path 不在允许范围 \$allowed_parent 内，拒绝删除\${NC}" >&2
        return 1
    fi

    # 验证 4: 禁止删除根目录或 home 目录
    if [[ "\$real_path" == "/" || "\$real_path" == "\$HOME" || "\$real_path" == "/home" ]]; then
        echo -e "\${RED}错误: 禁止删除系统关键目录: \$real_path\${NC}" >&2
        return 1
    fi

    # 安全删除
    rm -rf "\$path"
}

${testCode}
`
    const scriptPath = path.join(testDir, 'test-script.sh')
    fs.writeFileSync(scriptPath, script)
    fs.chmodSync(scriptPath, 0o755)
    return scriptPath
  }

  describe('路径非空验证', () => {
    it('should reject empty path', () => {
      const script = createTestScript(`
        safe_rm_rf "" "${testDir}"
        echo "RESULT: $?"
      `)

      try {
        execSync(`bash ${script}`, { stdio: 'pipe' })
        expect.fail('Should have returned non-zero exit code')
      } catch (error: unknown) {
        const execError = error as { stderr: Buffer }
        const stderr = execError.stderr?.toString() || ''
        expect(stderr).toContain('路径为空')
      }
    })
  })

  describe('路径存在验证', () => {
    it('should succeed silently for non-existent path', () => {
      const script = createTestScript(`
        safe_rm_rf "${testDir}/nonexistent" "${testDir}"
        echo "EXIT_CODE: $?"
      `)

      const output = execSync(`bash ${script}`).toString()
      expect(output).toContain('EXIT_CODE: 0')
    })
  })

  describe('允许范围验证', () => {
    it('should delete file within allowed parent', () => {
      // 创建要删除的目录
      const targetDir = path.join(testDir, 'to-delete')
      fs.mkdirSync(targetDir)
      fs.writeFileSync(path.join(targetDir, 'file.txt'), 'content')

      const script = createTestScript(`
        safe_rm_rf "${targetDir}" "${testDir}"
        echo "EXIT_CODE: $?"
      `)

      const output = execSync(`bash ${script}`).toString()
      expect(output).toContain('EXIT_CODE: 0')
      expect(fs.existsSync(targetDir)).toBe(false)
    })

    it('should reject path outside allowed parent', () => {
      // 创建两个独立的目录
      const allowedDir = path.join(testDir, 'allowed')
      const outsideDir = path.join(testDir, 'outside')
      fs.mkdirSync(allowedDir)
      fs.mkdirSync(outsideDir)

      const script = createTestScript(`
        safe_rm_rf "${outsideDir}" "${allowedDir}"
        echo "EXIT_CODE: $?"
      `)

      try {
        execSync(`bash ${script}`, { stdio: 'pipe' })
        expect.fail('Should have returned non-zero exit code')
      } catch (error: unknown) {
        const execError = error as { stderr: Buffer }
        const stderr = execError.stderr?.toString() || ''
        expect(stderr).toContain('不在允许范围')
      }

      // 目录应该仍然存在
      expect(fs.existsSync(outsideDir)).toBe(true)
    })

    it('should reject path traversal attack', () => {
      // 创建目录结构
      const allowedDir = path.join(testDir, 'allowed')
      const targetDir = path.join(testDir, 'target')
      fs.mkdirSync(allowedDir)
      fs.mkdirSync(targetDir)

      // 尝试使用 ../ 跳出允许范围
      const script = createTestScript(`
        safe_rm_rf "${allowedDir}/../target" "${allowedDir}"
        echo "EXIT_CODE: $?"
      `)

      try {
        execSync(`bash ${script}`, { stdio: 'pipe' })
        expect.fail('Should have returned non-zero exit code')
      } catch (error: unknown) {
        const execError = error as { stderr: Buffer }
        const stderr = execError.stderr?.toString() || ''
        expect(stderr).toContain('不在允许范围')
      }

      // target 目录应该仍然存在
      expect(fs.existsSync(targetDir)).toBe(true)
    })
  })

  describe('系统关键目录保护', () => {
    it('should reject root directory', () => {
      const script = createTestScript(`
        safe_rm_rf "/" "/"
        echo "EXIT_CODE: $?"
      `)

      try {
        execSync(`bash ${script}`, { stdio: 'pipe' })
        expect.fail('Should have returned non-zero exit code')
      } catch (error: unknown) {
        const execError = error as { stderr: Buffer }
        const stderr = execError.stderr?.toString() || ''
        expect(stderr).toContain('禁止删除系统关键目录')
      }
    })

    it('should reject home directory', () => {
      const homeDir = os.homedir()
      const script = createTestScript(`
        safe_rm_rf "${homeDir}" "${homeDir}"
        echo "EXIT_CODE: $?"
      `)

      try {
        execSync(`bash ${script}`, { stdio: 'pipe' })
        expect.fail('Should have returned non-zero exit code')
      } catch (error: unknown) {
        const execError = error as { stderr: Buffer }
        const stderr = execError.stderr?.toString() || ''
        expect(stderr).toContain('禁止删除系统关键目录')
      }
    })

    it('should reject /home directory', () => {
      const script = createTestScript(`
        safe_rm_rf "/home" "/home"
        echo "EXIT_CODE: $?"
      `)

      try {
        execSync(`bash ${script}`, { stdio: 'pipe' })
        expect.fail('Should have returned non-zero exit code')
      } catch (error: unknown) {
        const execError = error as { stderr: Buffer }
        const stderr = execError.stderr?.toString() || ''
        expect(stderr).toContain('禁止删除系统关键目录')
      }
    })
  })

  describe('正常删除场景', () => {
    it('should delete nested directories', () => {
      // 创建嵌套目录结构
      const parentDir = path.join(testDir, 'parent')
      const childDir = path.join(parentDir, 'child')
      const grandchildDir = path.join(childDir, 'grandchild')
      fs.mkdirSync(grandchildDir, { recursive: true })
      fs.writeFileSync(path.join(grandchildDir, 'file.txt'), 'content')

      const script = createTestScript(`
        safe_rm_rf "${parentDir}" "${testDir}"
        echo "EXIT_CODE: $?"
      `)

      const output = execSync(`bash ${script}`).toString()
      expect(output).toContain('EXIT_CODE: 0')
      expect(fs.existsSync(parentDir)).toBe(false)
    })

    it('should delete single file', () => {
      const targetFile = path.join(testDir, 'single-file.txt')
      fs.writeFileSync(targetFile, 'content')

      const script = createTestScript(`
        safe_rm_rf "${targetFile}" "${testDir}"
        echo "EXIT_CODE: $?"
      `)

      const output = execSync(`bash ${script}`).toString()
      expect(output).toContain('EXIT_CODE: 0')
      expect(fs.existsSync(targetFile)).toBe(false)
    })
  })
})
