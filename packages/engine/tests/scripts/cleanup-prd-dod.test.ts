import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import os from 'os'

describe('cleanup-prd-dod.sh', () => {
  let testDir: string
  let testScriptPath: string

  beforeEach(() => {
    // 创建临时测试目录
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cleanup-test-'))

    // 初始化 git repo
    execSync('git init', { cwd: testDir })
    execSync('git config user.name "Test"', { cwd: testDir })
    execSync('git config user.email "test@test.com"', { cwd: testDir })

    // 复制脚本到测试目录（基于 __dirname 找到脚本路径）
    const engineRoot = path.resolve(__dirname, '../..')
    const scriptPath = path.join(engineRoot, 'scripts/cleanup-prd-dod.sh')
    testScriptPath = path.join(testDir, 'cleanup-prd-dod.sh')
    fs.copyFileSync(scriptPath, testScriptPath)
    fs.chmodSync(testScriptPath, 0o755)
  })

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true })
  })

  it('should skip cleanup on feature branch', () => {
    // 创建 feature 分支
    execSync('git checkout -b cp-test-feature', { cwd: testDir })

    // 创建 PRD/DoD
    fs.writeFileSync(path.join(testDir, '.prd.md'), '# Test PRD')
    fs.writeFileSync(path.join(testDir, '.dod.md'), '# Test DoD')

    // 运行 cleanup
    const output = execSync(`bash ${testScriptPath}`, { cwd: testDir }).toString()

    expect(output).toContain('跳过')
    expect(fs.existsSync(path.join(testDir, '.prd.md'))).toBe(true)
    expect(fs.existsSync(path.join(testDir, '.dod.md'))).toBe(true)
  })

  it('should cleanup PRD/DoD on develop branch', () => {
    // 创建初始提交（避免 detached HEAD）
    fs.writeFileSync(path.join(testDir, 'README.md'), '# Test')
    execSync('git add README.md', { cwd: testDir })
    execSync('git commit -m "initial"', { cwd: testDir })

    // 创建并切换到 develop 分支
    execSync('git checkout -b develop', { cwd: testDir })

    // 创建 PRD/DoD
    fs.writeFileSync(path.join(testDir, '.prd.md'), '# Test PRD')
    fs.writeFileSync(path.join(testDir, '.dod.md'), '# Test DoD')

    // 运行 cleanup
    const output = execSync(`bash ${testScriptPath}`, { cwd: testDir }).toString()

    expect(output).toContain('清理完成')
    expect(fs.existsSync(path.join(testDir, '.prd.md'))).toBe(false)
    expect(fs.existsSync(path.join(testDir, '.dod.md'))).toBe(false)
  })

  it('should cleanup PRD/DoD on main branch', () => {
    // 创建初始提交（避免 detached HEAD）
    fs.writeFileSync(path.join(testDir, 'README.md'), '# Test')
    execSync('git add README.md', { cwd: testDir })
    execSync('git commit -m "initial"', { cwd: testDir })

    // 切换到 main 分支（macOS git 默认已创建 main，Linux 可能是 master）
    const currentBranch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: testDir }).toString().trim()
    if (currentBranch !== 'main') {
      execSync('git checkout -b main', { cwd: testDir })
    }

    // 创建 PRD/DoD
    fs.writeFileSync(path.join(testDir, '.prd.md'), '# Test PRD')
    fs.writeFileSync(path.join(testDir, '.dod.md'), '# Test DoD')

    // 运行 cleanup
    const output = execSync(`bash ${testScriptPath}`, { cwd: testDir }).toString()

    expect(output).toContain('清理完成')
    expect(fs.existsSync(path.join(testDir, '.prd.md'))).toBe(false)
    expect(fs.existsSync(path.join(testDir, '.dod.md'))).toBe(false)
  })

  it('should report no cleanup needed when files not exist', () => {
    // 创建初始提交（避免 detached HEAD）
    fs.writeFileSync(path.join(testDir, 'README.md'), '# Test')
    execSync('git add README.md', { cwd: testDir })
    execSync('git commit -m "initial"', { cwd: testDir })

    // 创建并切换到 develop 分支
    execSync('git checkout -b develop', { cwd: testDir })

    // 不创建 PRD/DoD

    // 运行 cleanup
    const output = execSync(`bash ${testScriptPath}`, { cwd: testDir }).toString()

    expect(output).toContain('无需清理')
  })

  it('should only cleanup existing files', () => {
    // 创建初始提交（避免 detached HEAD）
    fs.writeFileSync(path.join(testDir, 'README.md'), '# Test')
    execSync('git add README.md', { cwd: testDir })
    execSync('git commit -m "initial"', { cwd: testDir })

    // 创建并切换到 develop 分支
    execSync('git checkout -b develop', { cwd: testDir })

    // 只创建 .prd.md
    fs.writeFileSync(path.join(testDir, '.prd.md'), '# Test PRD')

    const output = execSync(`bash ${testScriptPath}`, { cwd: testDir }).toString()

    expect(output).toContain('清理完成')
    expect(output).toContain('.prd.md')
    expect(output).not.toContain('.dod.md')
    expect(fs.existsSync(path.join(testDir, '.prd.md'))).toBe(false)
  })
})
