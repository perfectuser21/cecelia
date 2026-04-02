import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execSync } from 'child_process'
import { mkdirSync, rmSync, writeFileSync, existsSync } from 'fs'
import { resolve } from 'path'
import os from 'os'

// v16.0.0: sentinel清理逻辑已删除（Engine重构）
describe.skip('Stop Hook - Sentinel 文件清理（修复 .git 保护）', () => {
  let testDir: string
  const stopHookScript = resolve(__dirname, '../../hooks/stop-dev.sh')

  beforeEach(() => {
    // 创建测试目录（使用唯一的临时目录，避免 process.chdir）
    testDir = `${os.tmpdir()}/test-stop-sentinel-${Date.now()}-${Math.random().toString(36).slice(2)}`
    mkdirSync(testDir, { recursive: true })

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

  it('sentinel 文件应该使用 per-branch 格式（.dev-sentinel.<branch>）', () => {
    // v14.0.0: 删除了旧格式，全部改为 per-branch 格式
    const { execSync: execSyncLocal } = require('child_process')
    const hookContent = execSyncLocal(`cat "${stopHookScript}"`, { encoding: 'utf-8' })
    // per-branch 格式：.dev-sentinel.${branch}
    expect(hookContent).toContain('.dev-sentinel.')
    // 旧格式已删除
    expect(hookContent).not.toContain('.git/hooks/cecelia-dev.sentinel')
  })

  it('cleanup_done 场景：Stop Hook 应该成功删除 .dev-sentinel.test-branch', () => {
    // 创建 per-branch 格式的双钥匙 + sentinel
    writeFileSync(resolve(testDir, '.dev-lock.test-branch'),
      'branch: test-branch\nsession_id: test-session\n')
    writeFileSync(resolve(testDir, '.dev-sentinel.test-branch'), 'dev_workflow_active\n')
    writeFileSync(
      resolve(testDir, '.dev-mode.test-branch'),
      'dev\nbranch: test-branch\ncleanup_done: true\n'
    )

    // 运行 Stop Hook（用 CLAUDE_SESSION_ID 匹配）
    let exitCode = 0
    try {
      execSync(`bash "${stopHookScript}"`, {
        cwd: testDir,
        encoding: 'utf-8',
        stdio: 'pipe',
        input: '',
        env: { ...process.env, CLAUDE_SESSION_ID: 'test-session' },
      })
    } catch (error: any) {
      exitCode = error.status || 1
    }

    // 验证：exit 0 且文件被删除
    expect(exitCode).toBe(0)
    expect(existsSync(resolve(testDir, '.dev-mode.test-branch'))).toBe(false)
    expect(existsSync(resolve(testDir, '.dev-lock.test-branch'))).toBe(false)
    expect(existsSync(resolve(testDir, '.dev-sentinel.test-branch'))).toBe(false)
  })

  it('分支不匹配场景：Stop Hook 应该 exit 0（无关会话）', () => {
    // 创建 per-branch 格式（分支为 other-branch，当前分支是 test-branch）
    writeFileSync(resolve(testDir, '.dev-lock.other-branch'),
      'branch: other-branch\nsession_id: other-session\n')
    writeFileSync(resolve(testDir, '.dev-sentinel.other-branch'), 'dev_workflow_active\n')
    writeFileSync(
      resolve(testDir, '.dev-mode.other-branch'),
      'dev\nbranch: other-branch\nprd: .prd.md\n'
    )

    // 运行 Stop Hook（当前会话 session_id 不匹配 other-session）
    let exitCode = 0
    try {
      execSync(`bash "${stopHookScript}"`, {
        cwd: testDir,
        encoding: 'utf-8',
        stdio: 'pipe',
        input: '',
        env: { ...process.env, CLAUDE_SESSION_ID: 'current-session' },
      })
    } catch (error: any) {
      exitCode = error.status || 1
    }

    // 不匹配的会话 → exit 0（无关会话允许结束）
    expect(exitCode).toBe(0)
  })

  it('高重试次数场景：Stop Hook 不再强制退出，继续 exit 2（v15.4.0 pipeline_rescue）', () => {
    // 创建 per-branch 格式 + 高重试次数
    writeFileSync(resolve(testDir, '.dev-lock.test-branch'),
      'branch: test-branch\nsession_id: test-session\n')
    writeFileSync(resolve(testDir, '.dev-sentinel.test-branch'), 'dev_workflow_active\n')
    writeFileSync(
      resolve(testDir, '.dev-mode.test-branch'),
      'dev\nbranch: test-branch\nretry_count: 30\n'
    )

    // 运行 Stop Hook（用 CLAUDE_SESSION_ID 匹配）
    let exitCode = 0
    try {
      execSync(`bash "${stopHookScript}"`, {
        cwd: testDir,
        encoding: 'utf-8',
        stdio: 'pipe',
        input: '',
        env: { ...process.env, CLAUDE_SESSION_ID: 'test-session' },
      })
    } catch (error: any) {
      exitCode = error.status || 1
    }

    // v15.4.0: 不再强制退出，exit 2 继续等待（pipeline_rescue 接管）
    expect(exitCode).toBe(2)
  })

  it('正常工作流：.dev-lock 存在但 .dev-mode 不存在时阻止退出（最多 5 次）', () => {
    // 只创建 .dev-lock，不创建 .dev-mode（模拟状态丢失）
    writeFileSync(resolve(testDir, '.dev-lock.test-branch'),
      'branch: test-branch\nsession_id: test-session\n')

    // 运行 Stop Hook
    let exitCode = 0
    try {
      execSync(`bash "${stopHookScript}"`, {
        cwd: testDir,
        encoding: 'utf-8',
        stdio: 'pipe',
        input: '',
        env: { ...process.env, CLAUDE_SESSION_ID: 'test-session' },
      })
    } catch (error: any) {
      exitCode = error.status || 1
    }

    // .dev-lock 存在但 .dev-mode 不存在 → exit 2（阻止退出，等待状态恢复）
    expect(exitCode).toBe(2)
  })
})
