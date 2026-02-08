import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execSync } from 'child_process'
import { mkdirSync, rmSync, writeFileSync, existsSync } from 'fs'
import { resolve } from 'path'

describe('Stop Hook - Sentinel 文件清理（修复 .git 保护）', () => {
  const testDir = resolve(__dirname, '../.test-stop-sentinel')
  const stopHookScript = resolve(__dirname, '../../hooks/stop-dev.sh')

  beforeEach(() => {
    // 创建测试目录
    mkdirSync(testDir, { recursive: true })
    process.chdir(testDir)

    // 初始化 git repo
    execSync('git init -q', { cwd: testDir })
    execSync('git config user.email "test@test.com"', { cwd: testDir })
    execSync('git config user.name "Test"', { cwd: testDir })
    writeFileSync(resolve(testDir, 'README.md'), 'test')
    execSync('git add . && git commit -m "init" -q', { cwd: testDir })
    execSync('git checkout -b test-branch -q', { cwd: testDir })
  })

  afterEach(() => {
    // 清理测试目录
    try {
      rmSync(testDir, { recursive: true, force: true })
    } catch (e) {
      // 忽略清理错误
    }
  })

  it('sentinel 文件应该在项目根目录（不在 .git/hooks/）', () => {
    // 验证 Stop Hook 使用的是根目录路径
    const hookContent = execSync(`cat "${stopHookScript}"`, { encoding: 'utf-8' })
    expect(hookContent).toContain('SENTINEL_FILE="$PROJECT_ROOT/.dev-sentinel"')
    expect(hookContent).not.toContain('.git/hooks/cecelia-dev.sentinel')
  })

  it('cleanup_done 场景：Stop Hook 应该成功删除 .dev-sentinel', () => {
    // 创建完整的双钥匙 + sentinel
    writeFileSync(resolve(testDir, '.dev-lock'), 'dev_workflow_active\n')
    writeFileSync(resolve(testDir, '.dev-sentinel'), 'dev_workflow_active\n')
    writeFileSync(
      resolve(testDir, '.dev-mode'),
      'dev\nbranch: test-branch\ncleanup_done: true\n'
    )

    // 运行 Stop Hook
    let exitCode = 0
    try {
      execSync(`bash "${stopHookScript}"`, {
        cwd: testDir,
        encoding: 'utf-8',
        stdio: 'pipe',
        input: '',
      })
    } catch (error: any) {
      exitCode = error.status || 1
    }

    // 验证：exit 0 且文件被删除
    expect(exitCode).toBe(0)
    expect(existsSync(resolve(testDir, '.dev-mode'))).toBe(false)
    expect(existsSync(resolve(testDir, '.dev-lock'))).toBe(false)
    expect(existsSync(resolve(testDir, '.dev-sentinel'))).toBe(false)
  })

  it('分支不匹配场景：Stop Hook 应该成功删除 .dev-sentinel', () => {
    // 创建双钥匙 + sentinel（分支不匹配）
    writeFileSync(resolve(testDir, '.dev-lock'), 'dev_workflow_active\n')
    writeFileSync(resolve(testDir, '.dev-sentinel'), 'dev_workflow_active\n')
    writeFileSync(
      resolve(testDir, '.dev-mode'),
      'dev\nbranch: other-branch\nprd: .prd.md\n'
    )

    // 运行 Stop Hook
    let exitCode = 0
    try {
      execSync(`bash "${stopHookScript}"`, {
        cwd: testDir,
        encoding: 'utf-8',
        stdio: 'pipe',
        input: '',
      })
    } catch (error: any) {
      exitCode = error.status || 1
    }

    // 验证：exit 0 且文件被删除
    expect(exitCode).toBe(0)
    expect(existsSync(resolve(testDir, '.dev-mode'))).toBe(false)
    expect(existsSync(resolve(testDir, '.dev-lock'))).toBe(false)
    expect(existsSync(resolve(testDir, '.dev-sentinel'))).toBe(false)
  })

  it('重试超限场景：Stop Hook 应该成功删除 .dev-sentinel', () => {
    // 创建双钥匙 + sentinel（重试超限）
    writeFileSync(resolve(testDir, '.dev-lock'), 'dev_workflow_active\n')
    writeFileSync(resolve(testDir, '.dev-sentinel'), 'dev_workflow_active\n')
    writeFileSync(
      resolve(testDir, '.dev-mode'),
      'dev\nbranch: test-branch\nretry_count: 15\n'
    )

    // 运行 Stop Hook
    let exitCode = 0
    try {
      execSync(`bash "${stopHookScript}"`, {
        cwd: testDir,
        encoding: 'utf-8',
        stdio: 'pipe',
        input: '',
      })
    } catch (error: any) {
      exitCode = error.status || 1
    }

    // 验证：exit 0 且文件被删除
    expect(exitCode).toBe(0)
    expect(existsSync(resolve(testDir, '.dev-mode'))).toBe(false)
    expect(existsSync(resolve(testDir, '.dev-lock'))).toBe(false)
    expect(existsSync(resolve(testDir, '.dev-sentinel'))).toBe(false)
  })

  it('三重保险机制：sentinel 存在但 .dev-lock 缺失时阻止退出', () => {
    // 只创建 sentinel，.dev-lock 不存在（状态丢失）
    writeFileSync(resolve(testDir, '.dev-sentinel'), 'dev_workflow_active\n')

    // 运行 Stop Hook
    let exitCode = 0
    try {
      execSync(`bash "${stopHookScript}"`, {
        cwd: testDir,
        encoding: 'utf-8',
        stdio: 'pipe',
        input: '',
      })
    } catch (error: any) {
      exitCode = error.status || 1
    }

    // 验证：exit 2（阻止退出）
    expect(exitCode).toBe(2)
  })
})
