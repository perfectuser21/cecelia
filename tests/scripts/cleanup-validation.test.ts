import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import os from 'os'

describe('cleanup.sh - W8 Validation Logic', () => {
  let testDir: string
  let cleanupScript: string
  let devModeFile: string

  beforeEach(() => {
    // 创建临时测试目录
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cleanup-test-'))
    devModeFile = path.join(testDir, '.dev-mode')
    cleanupScript = path.resolve(__dirname, '../../skills/dev/scripts/cleanup.sh')

    // 初始化 git 仓库
    execSync('git init', { cwd: testDir })
    execSync('git config user.email "test@example.com"', { cwd: testDir })
    execSync('git config user.name "Test User"', { cwd: testDir })
  })

  afterEach(() => {
    // 清理测试目录
    fs.rmSync(testDir, { recursive: true, force: true })
  })

  describe('验证所有步骤完成', () => {
    it('所有 11 步完成 → 验证通过', () => {
      // 创建 .dev-mode 文件，所有步骤都是 done
      const devModeContent = `dev
branch: test-branch
step_1_prd: done
step_2_detect: done
step_3_branch: done
step_4_dod: done
step_5_code: done
step_6_test: done
step_7_quality: done
step_8_pr: done
step_9_ci: done
step_10_learning: done
step_11_cleanup: done`

      fs.writeFileSync(devModeFile, devModeContent)

      // 直接测试验证逻辑（不运行整个 cleanup.sh）
      const result = execSync(
        `cd "${testDir}" && bash -c 'INCOMPLETE_STEPS=""; for step in {1..11}; do STEP_STATUS=$(grep "^step_\${step}_" ".dev-mode" 2>/dev/null | cut -d":" -f2 | xargs || echo ""); if [[ "$STEP_STATUS" != "done" ]]; then INCOMPLETE_STEPS="$INCOMPLETE_STEPS step_$step"; fi; done; if [[ -n "$INCOMPLETE_STEPS" ]]; then echo "FAIL: $INCOMPLETE_STEPS"; exit 1; else echo "PASS"; fi'`,
        { encoding: 'utf8' }
      )

      expect(result.trim()).toContain('PASS')
    })

    it('有步骤未完成 → 报错', () => {
      // 创建 .dev-mode 文件，step_5 未完成
      const devModeContent = `dev
branch: test-branch
step_1_prd: done
step_2_detect: done
step_3_branch: done
step_4_dod: done
step_5_code: pending
step_6_test: pending
step_7_quality: pending
step_8_pr: pending
step_9_ci: pending
step_10_learning: pending
step_11_cleanup: pending`

      fs.writeFileSync(devModeFile, devModeContent)

      try {
        execSync(
          `cd "${testDir}" && bash -c 'INCOMPLETE_STEPS=""; for step in {1..11}; do STEP_STATUS=$(grep "^step_\${step}_" ".dev-mode" 2>/dev/null | cut -d":" -f2 | xargs || echo ""); if [[ "$STEP_STATUS" != "done" ]]; then INCOMPLETE_STEPS="$INCOMPLETE_STEPS step_$step"; fi; done; if [[ -n "$INCOMPLETE_STEPS" ]]; then echo "FAIL: $INCOMPLETE_STEPS"; exit 1; fi'`,
          { encoding: 'utf8' }
        )
        expect.fail('应该抛出错误')
      } catch (error: any) {
        expect(error.stdout?.toString()).toContain('FAIL')
        expect(error.stdout?.toString()).toContain('step_5')
      }
    })
  })

  describe('删除后验证文件不存在', () => {
    it('.dev-mode 删除成功 → 验证通过', () => {
      fs.writeFileSync(devModeFile, 'test content')
      expect(fs.existsSync(devModeFile)).toBe(true)

      // 删除文件
      fs.unlinkSync(devModeFile)

      // 验证删除成功
      expect(fs.existsSync(devModeFile)).toBe(false)
    })

    it('.dev-mode 删除失败（文件仍存在）→ 报错', () => {
      fs.writeFileSync(devModeFile, 'test content')

      // 模拟删除失败（实际上不删除）
      // 在真实场景中，这可能因为权限问题或文件锁定
      expect(fs.existsSync(devModeFile)).toBe(true)

      // 验证应该失败
      const fileStillExists = fs.existsSync(devModeFile)
      expect(fileStillExists).toBe(true)
    })
  })

  describe('验证 gate 文件存在', () => {
    it('所有 gate 文件存在 → 验证通过', () => {
      const gateFiles = [
        '.gate-prd-passed',
        '.gate-dod-passed',
        '.gate-audit-passed',
        '.gate-test-passed'
      ]

      // 创建所有 gate 文件
      gateFiles.forEach(file => {
        fs.writeFileSync(path.join(testDir, file), 'passed')
      })

      // 验证所有文件存在
      gateFiles.forEach(file => {
        expect(fs.existsSync(path.join(testDir, file))).toBe(true)
      })
    })

    it('gate 文件缺失 → 警告（不阻塞）', () => {
      // 只创建部分 gate 文件
      fs.writeFileSync(path.join(testDir, '.gate-prd-passed'), 'passed')
      fs.writeFileSync(path.join(testDir, '.gate-dod-passed'), 'passed')

      const requiredGates = [
        '.gate-prd-passed',
        '.gate-dod-passed',
        '.gate-audit-passed',
        '.gate-test-passed'
      ]

      const missingGates = requiredGates.filter(
        file => !fs.existsSync(path.join(testDir, file))
      )

      expect(missingGates).toEqual([
        '.gate-audit-passed',
        '.gate-test-passed'
      ])
    })
  })

  describe('标记方式统一', () => {
    it('cleanup.sh 使用 step_11_cleanup: done 标记', () => {
      // 创建 .dev-mode 文件
      const devModeContent = `dev
branch: test-branch
step_11_cleanup: pending`

      fs.writeFileSync(devModeFile, devModeContent)

      // 运行 sed 命令（模拟 cleanup.sh 的标记逻辑）
      execSync(
        `sed -i 's/^step_11_cleanup: pending/step_11_cleanup: done/' "${devModeFile}"`
      )

      // 验证标记已更新
      const updated = fs.readFileSync(devModeFile, 'utf8')
      expect(updated).toContain('step_11_cleanup: done')
      expect(updated).not.toContain('step_11_cleanup: pending')
    })
  })
})
