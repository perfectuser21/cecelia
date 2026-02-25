import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import os from 'os'

describe('track.sh', () => {
  let testDir: string
  let originalCwd: string
  let trackScript: string

  beforeEach(() => {
    // 创建临时测试目录
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'track-test-'))
    originalCwd = process.cwd()

    // 初始化 git repo
    execSync('git init', { cwd: testDir })
    execSync('git config user.name "Test"', { cwd: testDir })
    execSync('git config user.email "test@test.com"', { cwd: testDir })

    // 复制脚本到测试目录
    const scriptPath = path.join(originalCwd, 'skills/dev/scripts/track.sh')
    trackScript = path.join(testDir, 'track.sh')
    fs.copyFileSync(scriptPath, trackScript)
    fs.chmodSync(trackScript, 0o755)

    // 创建假的 cecelia-api（返回空响应）
    const fakeApi = path.join(testDir, 'bin', 'cecelia-api')
    fs.mkdirSync(path.join(testDir, 'bin'), { recursive: true })
    fs.writeFileSync(fakeApi, `#!/bin/bash
# 假的 cecelia-api 用于测试
case "$1" in
  create-run)
    echo '{"run_id": "test-run-123"}'
    ;;
  update-run|sync-to-notion|get-run)
    echo '{}'
    ;;
  *)
    echo '{}'
    ;;
esac
`)
    fs.chmodSync(fakeApi, 0o755)

    // 修改脚本中的 CECELIA_API 路径
    let content = fs.readFileSync(trackScript, 'utf-8')
    content = content.replace(
      'CECELIA_API="${HOME}/bin/cecelia-api"',
      `CECELIA_API="${fakeApi}"`
    )
    fs.writeFileSync(trackScript, content)

    process.chdir(testDir)
  })

  afterEach(() => {
    process.chdir(originalCwd)
    fs.rmSync(testDir, { recursive: true, force: true })
  })

  describe('分支级别文件隔离', () => {
    it('should use branch-specific track file', () => {
      // 创建初始提交
      fs.writeFileSync('README.md', '# Test')
      execSync('git add README.md')
      execSync('git commit -m "initial"')

      // 在 main 分支创建 run
      execSync('git checkout -b main', { stdio: 'pipe' })
      execSync(`bash ${trackScript} start test-project main .prd.md`, { stdio: 'pipe' })

      // 检查分支级别文件
      expect(fs.existsSync('.cecelia-run-id-main')).toBe(true)
    })

    it('should isolate run_id between branches', () => {
      // 创建初始提交
      fs.writeFileSync('README.md', '# Test')
      execSync('git add README.md')
      execSync('git commit -m "initial"')

      // 在 branch-a 创建 run
      execSync('git checkout -b branch-a', { stdio: 'pipe' })
      execSync(`bash ${trackScript} start project-a branch-a .prd.md`, { stdio: 'pipe' })
      const runIdA = fs.readFileSync('.cecelia-run-id-branch-a', 'utf-8').trim()

      // 切换到 branch-b
      execSync('git checkout -b branch-b', { stdio: 'pipe' })

      // branch-b 没有自己的 run
      const statusB = execSync(`bash ${trackScript} status`, { stdio: 'pipe' }).toString()
      expect(statusB).toContain('No active run')

      // branch-a 的 run 仍然存在
      execSync('git checkout branch-a', { stdio: 'pipe' })
      expect(fs.existsSync('.cecelia-run-id-branch-a')).toBe(true)
      expect(fs.readFileSync('.cecelia-run-id-branch-a', 'utf-8').trim()).toBe(runIdA)
    })
  })

  describe('status 命令', () => {
    it('should show "No active run" when no run exists', () => {
      fs.writeFileSync('README.md', '# Test')
      execSync('git add README.md')
      execSync('git commit -m "initial"')

      const output = execSync(`bash ${trackScript} status`).toString()
      expect(output).toContain('No active run')
    })

    it('should show run id when run exists', () => {
      fs.writeFileSync('README.md', '# Test')
      execSync('git add README.md')
      execSync('git commit -m "initial"')
      execSync('git checkout -b test-branch', { stdio: 'pipe' })

      // 创建 run
      execSync(`bash ${trackScript} start test-project test-branch .prd.md`, { stdio: 'pipe' })

      const output = execSync(`bash ${trackScript} status`).toString()
      expect(output).toContain('test-run-123')
    })
  })

  describe('done 命令', () => {
    it('should clear run_id after done', () => {
      fs.writeFileSync('README.md', '# Test')
      execSync('git add README.md')
      execSync('git commit -m "initial"')
      execSync('git checkout -b test-branch', { stdio: 'pipe' })

      // 创建 run
      execSync(`bash ${trackScript} start test-project test-branch .prd.md`, { stdio: 'pipe' })
      expect(fs.existsSync('.cecelia-run-id-test-branch')).toBe(true)

      // 完成 run
      execSync(`bash ${trackScript} done https://github.com/test/pr/1`, { stdio: 'pipe' })

      // run_id 应该被清理
      expect(fs.existsSync('.cecelia-run-id-test-branch')).toBe(false)
    })
  })

  describe('fail 命令', () => {
    it('should keep run_id after fail for retry', () => {
      fs.writeFileSync('README.md', '# Test')
      execSync('git add README.md')
      execSync('git commit -m "initial"')
      execSync('git checkout -b test-branch', { stdio: 'pipe' })

      // 创建 run
      execSync(`bash ${trackScript} start test-project test-branch .prd.md`, { stdio: 'pipe' })
      expect(fs.existsSync('.cecelia-run-id-test-branch')).toBe(true)

      // 失败
      execSync(`bash ${trackScript} fail "Test error"`, { stdio: 'pipe' })

      // run_id 应该保留（方便重试）
      expect(fs.existsSync('.cecelia-run-id-test-branch')).toBe(true)
    })
  })

  describe('向后兼容', () => {
    it('should read legacy .cecelia-run-id file', () => {
      fs.writeFileSync('README.md', '# Test')
      execSync('git add README.md')
      execSync('git commit -m "initial"')
      execSync('git checkout -b test-branch', { stdio: 'pipe' })

      // 创建旧格式文件
      fs.writeFileSync('.cecelia-run-id', 'legacy-run-id')

      const output = execSync(`bash ${trackScript} status`).toString()
      expect(output).toContain('legacy-run-id')
    })

    it('should prefer branch-specific file over legacy file', () => {
      fs.writeFileSync('README.md', '# Test')
      execSync('git add README.md')
      execSync('git commit -m "initial"')
      execSync('git checkout -b test-branch', { stdio: 'pipe' })

      // 创建两种格式的文件
      fs.writeFileSync('.cecelia-run-id', 'legacy-run-id')
      fs.writeFileSync('.cecelia-run-id-test-branch', 'branch-run-id')

      const output = execSync(`bash ${trackScript} status`).toString()
      expect(output).toContain('branch-run-id')
      expect(output).not.toContain('legacy-run-id')
    })
  })

  describe('无效命令', () => {
    it('should show usage for invalid command', () => {
      try {
        execSync(`bash ${trackScript} invalid-cmd`, { stdio: 'pipe' })
        expect.fail('Should have thrown')
      } catch (error: unknown) {
        const execError = error as { stdout: Buffer }
        const output = execError.stdout?.toString() || ''
        expect(output).toContain('Usage')
      }
    })
  })
})
