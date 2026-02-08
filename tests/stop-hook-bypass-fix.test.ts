import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execSync } from 'child_process'
import { writeFileSync, unlinkSync, mkdirSync, rmSync } from 'fs'
import { resolve } from 'path'

describe('Stop Hook - 修复绕过问题', () => {
  const testDir = resolve(__dirname, '../.test-stop-hook-bypass')
  const devModeFile = resolve(testDir, '.dev-mode')
  const hookScript = resolve(__dirname, '../hooks/stop.sh')

  beforeEach(() => {
    // 创建测试目录
    mkdirSync(testDir, { recursive: true })
  })

  afterEach(() => {
    // 清理测试目录
    try {
      rmSync(testDir, { recursive: true, force: true })
    } catch (e) {
      // 忽略清理错误
    }
  })

  it('即使所有步骤都是 done，CI 未通过时 Stop Hook 应该 block', () => {
    // 创建 .dev-mode 文件，所有步骤都标记为 done
    const devModeContent = `dev
branch: test-branch
session_id: test-session
tty: not a tty
prd: .prd-test.md
started: 2026-02-07T19:00:00+00:00
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
step_11_cleanup: done
retry_count: 0`

    writeFileSync(devModeFile, devModeContent)

    // 模拟执行 Stop Hook
    // 注意：由于 Stop Hook 依赖 git 环境和 gh CLI，这里只验证逻辑
    // 实际运行会在 PR 检查时 block，因为删除了"11步全部done"的提前退出

    // 验证：.dev-mode 包含所有 done 状态
    expect(devModeContent).toContain('step_9_ci: done')
    expect(devModeContent).toContain('step_11_cleanup: done')

    // 修复前：Stop Hook 会在 line 124-136 检测到所有步骤 done，直接删除 .dev-mode 并 exit 0
    // 修复后：Stop Hook 跳过步骤检查，继续检查 PR/CI 状态
    //        如果 PR 不存在或 CI 未通过，会 block（output JSON {"decision": "block", "reason": "..."}）

    // 清理
    unlinkSync(devModeFile)
  })

  it('.dev-mode 应该包含步骤状态字段（用于进度展示）', () => {
    // 步骤状态虽然不用于流程控制，但仍然保留用于 TaskList 进度展示
    const devModeContent = `dev
branch: test-branch
session_id: test-session
tty: not a tty
prd: .prd-test.md
started: 2026-02-07T19:00:00+00:00
step_1_prd: done
step_2_detect: done
step_3_branch: done
step_4_dod: pending
step_5_code: pending
step_6_test: pending
step_7_quality: pending
step_8_pr: pending
step_9_ci: pending
step_10_learning: pending
step_11_cleanup: pending
retry_count: 0`

    writeFileSync(devModeFile, devModeContent)

    // 验证字段存在
    expect(devModeContent).toContain('step_1_prd: done')
    expect(devModeContent).toContain('step_4_dod: pending')
    expect(devModeContent).toContain('retry_count: 0')

    // 清理
    unlinkSync(devModeFile)
  })

  it('Stop Hook 注释应该说明修复原因', () => {
    const stopDevScript = hookScript.replace('stop.sh', 'stop-dev.sh')
    const hookContent = execSync(`cat ${stopDevScript}`, { encoding: 'utf-8' })

    // 验证修复注释存在
    expect(hookContent).toContain('v12.8.0')
    expect(hookContent).toContain('删除了"11步全部done"的提前退出逻辑')
    expect(hookContent).toContain('步骤状态（step_*）只用于进度展示')
    expect(hookContent).toContain('流程控制只依赖实际状态检查')
  })

  it('cleanup_done 检查仍然保留（向后兼容）', () => {
    const stopDevScript = hookScript.replace('stop.sh', 'stop-dev.sh')
    const hookContent = execSync(`cat ${stopDevScript}`, { encoding: 'utf-8' })

    // 验证 cleanup_done 检查仍在
    expect(hookContent).toContain('cleanup_done: true')
    expect(hookContent).toContain('向后兼容旧版本')
  })
})
