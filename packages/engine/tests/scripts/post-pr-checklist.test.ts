import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import os from 'os'

describe('post-pr-checklist.sh - queue mode', () => {
  let testDir: string
  let testScriptPath: string

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'checklist-test-'))

    // 初始化 git repo
    execSync('git init', { cwd: testDir })
    execSync('git config user.name "Test"', { cwd: testDir })
    execSync('git config user.email "test@test.com"', { cwd: testDir })

    // 创建目录结构
    fs.mkdirSync(path.join(testDir, 'scripts'), { recursive: true })
    fs.mkdirSync(path.join(testDir, 'docs'), { recursive: true })
    fs.mkdirSync(path.join(testDir, 'features'), { recursive: true })

    // 复制脚本（基于 __dirname 找到引擎根目录）
    const engineRoot = path.resolve(__dirname, '../..')
    const scriptPath = path.join(engineRoot, 'scripts/post-pr-checklist.sh')
    testScriptPath = path.join(testDir, 'scripts/post-pr-checklist.sh')
    fs.copyFileSync(scriptPath, testScriptPath)
    fs.chmodSync(testScriptPath, 0o755)

    // 创建 queue 文件
    const queueTemplate = fs.readFileSync(
      path.join(engineRoot, 'docs/SELF-EVOLUTION-QUEUE.md'),
      'utf-8'
    )
    fs.writeFileSync(path.join(testDir, 'docs/SELF-EVOLUTION-QUEUE.md'), queueTemplate)
  })

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true })
  })

  it('should record PRD/DoD residue to queue (not error)', () => {
    execSync('git checkout -b develop', { cwd: testDir })

    // 创建 PRD/DoD 并跟踪
    fs.writeFileSync(path.join(testDir, '.prd.md'), '# Test')
    fs.writeFileSync(path.join(testDir, '.dod.md'), '# Test')
    execSync('git add -f .prd.md .dod.md', { cwd: testDir })
    execSync('git commit -m "test"', { cwd: testDir })

    // 运行 checklist - 应该记录到队列而不是报错
    const result = execSync(`bash ${testScriptPath}`, { cwd: testDir }).toString()

    expect(result).toContain('已记录到队列')
    expect(result).toContain('PRD/DoD 残留')
    expect(result).not.toContain('错误')
  })

  it('should pass when no PRD/DoD on develop', () => {
    execSync('git checkout -b develop', { cwd: testDir })

    const result = execSync(`bash ${testScriptPath}`, { cwd: testDir }).toString()

    expect(result).toContain('develop/main 无 PRD/DoD 残留')
  })

  it('should skip PRD/DoD check on feature branch', () => {
    execSync('git checkout -b cp-test-feature', { cwd: testDir })

    fs.writeFileSync(path.join(testDir, '.prd.md'), '# Test')
    fs.writeFileSync(path.join(testDir, '.dod.md'), '# Test')
    execSync('git add -f .prd.md .dod.md', { cwd: testDir })
    execSync('git commit -m "test"', { cwd: testDir })

    const result = execSync(`bash ${testScriptPath}`, { cwd: testDir }).toString()

    expect(result).toContain('跳过，当前在功能分支')
  })

  it('should record version drift to queue', () => {
    execSync('git checkout -b develop', { cwd: testDir })

    // 创建版本不同步的文件
    fs.writeFileSync(path.join(testDir, 'features/feature-registry.yml'), 'version: "1.0.0"')
    fs.mkdirSync(path.join(testDir, 'docs/paths'), { recursive: true })
    fs.writeFileSync(path.join(testDir, 'docs/paths/OPTIMAL-PATHS.md'), '---\nversion: "0.9.0"\n---')

    execSync('git add -A', { cwd: testDir })
    execSync('git commit -m "test"', { cwd: testDir })

    const result = execSync(`bash ${testScriptPath}`, { cwd: testDir }).toString()

    expect(result).toContain('版本不匹配')
    expect(result).toContain('已记录到队列')
  })
})
