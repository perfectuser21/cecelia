/**
 * metrics.test.ts - DevGate Metrics 测试
 *
 * 测试:
 * - 快照 meta 解析
 * - 时间窗口过滤
 * - P0/P1 统计
 * - RCI 覆盖率计算
 * - JSON 输出格式
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execSync, spawnSync } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import { tmpdir } from 'os'

const ROOT = path.resolve(__dirname, '../..')
const METRICS_SCRIPT = path.join(ROOT, 'scripts/devgate/metrics.sh')
const METRICS_CJS = path.join(ROOT, 'scripts/devgate/metrics.cjs')
const SNAPSHOT_SCRIPT = path.join(ROOT, 'scripts/devgate/snapshot-prd-dod.sh')
const TEST_HISTORY_DIR = path.join(ROOT, '.test-metrics-history')

/**
 * 执行命令并返回 stdout，即使退出码非零也不抛错
 * (metrics.cjs 在 P0/P1 覆盖率 < 100% 时返回 exit 1)
 */
function runMetrics(args: string, cwd: string): string {
  const result = spawnSync('node', [METRICS_CJS, ...args.split(' ').filter(Boolean)], {
    cwd,
    encoding: 'utf-8',
  })
  // Log stderr for debugging if present (but don't fail)
  if (result.stderr && process.env.DEBUG) {
    console.log('metrics stderr:', result.stderr)
  }
  return result.stdout
}

describe('snapshot-prd-dod.sh meta 增强', () => {
  const testDir = path.join(tmpdir(), 'test-snapshot-meta')

  beforeAll(() => {
    execSync(`rm -rf ${testDir} && mkdir -p ${testDir}`)
    execSync(`cd ${testDir} && git init --quiet`)
    // 配置 git user（CI 环境需要）
    execSync(`cd ${testDir} && git config user.email "test@example.com" && git config user.name "Test"`)
    // 创建测试 PRD 和 DoD
    fs.writeFileSync(
      path.join(testDir, '.prd.md'),
      `---
id: test-prd
version: 1.0.0
---

# Test PRD

Priority: P1

## Background
Test
`
    )
    fs.writeFileSync(
      path.join(testDir, '.dod.md'),
      `---
id: test-dod
version: 1.0.0
---

# Test DoD

- [ ] Item 1
  Test: tests/foo.test.ts
- [ ] Item 2
  Test: manual:screenshot.png
`
    )
    // 提交文件
    execSync(`cd ${testDir} && git add -A && git commit -m "init" --quiet`)
  })

  afterAll(() => {
    execSync(`rm -rf ${testDir}`)
  })

  it('快照包含 pr 字段', () => {
    execSync(`cd ${testDir} && bash ${SNAPSHOT_SCRIPT} 123`, { stdio: 'pipe' })
    const files = fs.readdirSync(path.join(testDir, '.history'))
    const dodFile = files.find(f => f.endsWith('.dod.md'))
    expect(dodFile).toBeDefined()

    const content = fs.readFileSync(path.join(testDir, '.history', dodFile!), 'utf-8')
    expect(content).toMatch(/<!-- pr:123/)
  })

  it('快照包含 base 字段', () => {
    const files = fs.readdirSync(path.join(testDir, '.history'))
    const dodFile = files.find(f => f.endsWith('.dod.md'))
    const content = fs.readFileSync(path.join(testDir, '.history', dodFile!), 'utf-8')
    expect(content).toMatch(/base:\w+/)
  })

  it('快照包含 priority 字段（自动检测）', () => {
    const files = fs.readdirSync(path.join(testDir, '.history'))
    const dodFile = files.find(f => f.endsWith('.dod.md'))
    const content = fs.readFileSync(path.join(testDir, '.history', dodFile!), 'utf-8')
    // PRD 中有 Priority: P1，应该被检测到
    expect(content).toMatch(/priority:P1/)
  })

  it('快照包含 head SHA', () => {
    const files = fs.readdirSync(path.join(testDir, '.history'))
    const dodFile = files.find(f => f.endsWith('.dod.md'))
    const content = fs.readFileSync(path.join(testDir, '.history', dodFile!), 'utf-8')
    expect(content).toMatch(/head:[a-f0-9]+/)
  })

  it('快照包含 created ISO 时间戳', () => {
    const files = fs.readdirSync(path.join(testDir, '.history'))
    const dodFile = files.find(f => f.endsWith('.dod.md'))
    const content = fs.readFileSync(path.join(testDir, '.history', dodFile!), 'utf-8')
    expect(content).toMatch(/created:\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z/)
  })

  it('--priority 可以覆盖自动检测', () => {
    execSync(`cd ${testDir} && bash ${SNAPSHOT_SCRIPT} 456 --priority P0`, { stdio: 'pipe' })
    const files = fs.readdirSync(path.join(testDir, '.history'))
    const dodFile = files.find(f => f.includes('PR-456') && f.endsWith('.dod.md'))
    expect(dodFile).toBeDefined()

    const content = fs.readFileSync(path.join(testDir, '.history', dodFile!), 'utf-8')
    expect(content).toMatch(/priority:P0/)
  })

  it('--title 添加标题', () => {
    execSync(`cd ${testDir} && bash ${SNAPSHOT_SCRIPT} 789 --title "feat: test feature"`, {
      stdio: 'pipe',
    })
    const files = fs.readdirSync(path.join(testDir, '.history'))
    const dodFile = files.find(f => f.includes('PR-789') && f.endsWith('.dod.md'))
    expect(dodFile).toBeDefined()

    const content = fs.readFileSync(path.join(testDir, '.history', dodFile!), 'utf-8')
    expect(content).toMatch(/title:"feat: test feature"/)
  })
})

describe('metrics.sh 基础功能', () => {
  it('脚本存在且可执行', () => {
    expect(fs.existsSync(METRICS_SCRIPT)).toBe(true)
    const stat = fs.statSync(METRICS_SCRIPT)
    expect((stat.mode & 0o100) !== 0).toBe(true)
  })

  it('metrics.cjs 存在', () => {
    expect(fs.existsSync(METRICS_CJS)).toBe(true)
  })

  it('--help 显示帮助', () => {
    const output = execSync(`bash ${METRICS_SCRIPT} --help`, {
      encoding: 'utf-8',
      cwd: ROOT,
    })
    expect(output).toContain('DevGate Metrics')
    expect(output).toContain('--since')
    expect(output).toContain('--format')
  })

  it('默认输出当前月指标', () => {
    const output = execSync(`bash ${METRICS_SCRIPT}`, {
      encoding: 'utf-8',
      cwd: ROOT,
    })
    expect(output).toContain('DevGate Metrics')
    expect(output).toContain('PRs')
    expect(output).toContain('RCI Coverage')
  })

  it('--month 指定月份', () => {
    const output = execSync(`bash ${METRICS_SCRIPT} --month 2026-01`, {
      encoding: 'utf-8',
      cwd: ROOT,
    })
    expect(output).toContain('2026-01-01')
    expect(output).toContain('2026-02-01')
  })

  it('--format json 输出合法 JSON', () => {
    const output = execSync(`bash ${METRICS_SCRIPT} --format json --month 2026-01`, {
      encoding: 'utf-8',
      cwd: ROOT,
    })
    const json = JSON.parse(output)
    expect(json).toHaveProperty('window')
    expect(json).toHaveProperty('prs')
    expect(json).toHaveProperty('rci_coverage')
    expect(json).toHaveProperty('rci_growth')
    expect(json).toHaveProperty('dod')
  })

  it('JSON 包含 window.since 和 window.until', () => {
    const output = execSync(`bash ${METRICS_SCRIPT} --format json --month 2026-01`, {
      encoding: 'utf-8',
      cwd: ROOT,
    })
    const json = JSON.parse(output)
    expect(json.window.since).toBe('2026-01-01')
    expect(json.window.until).toBe('2026-02-01')
  })

  it('JSON 包含 prs 统计', () => {
    const output = execSync(`bash ${METRICS_SCRIPT} --format json`, {
      encoding: 'utf-8',
      cwd: ROOT,
    })
    const json = JSON.parse(output)
    expect(typeof json.prs.p0).toBe('number')
    expect(typeof json.prs.p1).toBe('number')
    expect(typeof json.prs.total_p0p1).toBe('number')
  })

  it('JSON 包含 rci_coverage', () => {
    const output = execSync(`bash ${METRICS_SCRIPT} --format json`, {
      encoding: 'utf-8',
      cwd: ROOT,
    })
    const json = JSON.parse(output)
    expect(typeof json.rci_coverage.updated).toBe('number')
    expect(typeof json.rci_coverage.total).toBe('number')
    expect(typeof json.rci_coverage.pct).toBe('number')
  })

  it('JSON 包含 rci_growth', () => {
    const output = execSync(`bash ${METRICS_SCRIPT} --format json`, {
      encoding: 'utf-8',
      cwd: ROOT,
    })
    const json = JSON.parse(output)
    expect(typeof json.rci_growth.new_ids_count).toBe('number')
    expect(Array.isArray(json.rci_growth.new_ids)).toBe(true)
  })

  it('JSON 包含 dod 统计', () => {
    const output = execSync(`bash ${METRICS_SCRIPT} --format json`, {
      encoding: 'utf-8',
      cwd: ROOT,
    })
    const json = JSON.parse(output)
    expect(typeof json.dod.items).toBe('number')
    expect(typeof json.dod.manual_tests).toBe('number')
    expect(typeof json.dod.p0_manual_tests).toBe('number')
  })

  it('JSON 包含 rci_coverage.offenders 数组', () => {
    const output = execSync(`bash ${METRICS_SCRIPT} --format json`, {
      encoding: 'utf-8',
      cwd: ROOT,
    })
    const json = JSON.parse(output)
    expect(Array.isArray(json.rci_coverage.offenders)).toBe(true)
  })

  it('JSON 包含 generated_at 时间戳', () => {
    const output = execSync(`bash ${METRICS_SCRIPT} --format json`, {
      encoding: 'utf-8',
      cwd: ROOT,
    })
    const json = JSON.parse(output)
    expect(json.generated_at).toBeDefined()
    // 验证是 ISO 时间格式
    expect(new Date(json.generated_at).toISOString()).toBe(json.generated_at)
  })
})

describe('metrics.sh 指标计算', () => {
  const testDir = path.join(tmpdir(), 'test-metrics-calc')

  beforeAll(() => {
    // 创建测试目录和 git repo
    execSync(`rm -rf ${testDir} && mkdir -p ${testDir}/.history`)
    execSync(`cd ${testDir} && git init --quiet`)
    // 配置 git user（CI 环境需要）
    execSync(`cd ${testDir} && git config user.email "test@example.com" && git config user.name "Test"`)

    // 创建模拟的快照文件（带 meta）
    const now = new Date()
    const isoTime = now.toISOString()

    // P0 PR
    fs.writeFileSync(
      path.join(testDir, '.history', 'PR-100-20260122-1000.dod.md'),
      `<!-- pr:100 base:develop priority:P0 head:abc1234 merged: created:${isoTime} -->

# DoD

- [ ] Item 1
  Test: tests/foo.test.ts
- [ ] Item 2
  Test: manual:evidence.png
`
    )

    // P1 PR
    fs.writeFileSync(
      path.join(testDir, '.history', 'PR-101-20260122-1100.dod.md'),
      `<!-- pr:101 base:develop priority:P1 head:def5678 merged: created:${isoTime} -->

# DoD

- [ ] Item 1
  Test: contract:H1-001
- [x] Item 2
  Test: tests/bar.test.ts
- [ ] Item 3
  Test: manual:screenshot.png
`
    )

    // NONE priority PR
    fs.writeFileSync(
      path.join(testDir, '.history', 'PR-102-20260122-1200.dod.md'),
      `<!-- pr:102 base:develop priority:NONE head:ghi9012 merged: created:${isoTime} -->

# DoD

- [ ] Minor fix
  Test: tests/minor.test.ts
`
    )
  })

  afterAll(() => {
    execSync(`rm -rf ${testDir}`)
  })

  it('正确统计 P0 PR 数', () => {
    const output = runMetrics('--format json', testDir)
    const json = JSON.parse(output)
    expect(json.prs.p0).toBe(1)
  })

  it('正确统计 P1 PR 数', () => {
    const output = runMetrics('--format json', testDir)
    const json = JSON.parse(output)
    expect(json.prs.p1).toBe(1)
  })

  it('正确统计 P0/P1 总数', () => {
    const output = runMetrics('--format json', testDir)
    const json = JSON.parse(output)
    expect(json.prs.total_p0p1).toBe(2)
  })

  it('正确统计总 PR 数', () => {
    const output = runMetrics('--format json', testDir)
    const json = JSON.parse(output)
    expect(json.prs.total).toBe(3)
  })

  it('正确统计 DoD 条目数', () => {
    const output = runMetrics('--format json', testDir)
    const json = JSON.parse(output)
    // PR-100: 2 items, PR-101: 3 items, PR-102: 1 item = 6 total
    expect(json.dod.items).toBe(6)
  })

  it('正确统计 manual test 数', () => {
    const output = runMetrics('--format json', testDir)
    const json = JSON.parse(output)
    // PR-100: 1 manual, PR-101: 1 manual = 2 total
    expect(json.dod.manual_tests).toBe(2)
  })

  it('正确统计 P0 manual test 数', () => {
    const output = runMetrics('--format json', testDir)
    const json = JSON.parse(output)
    // PR-100 (P0): 1 manual test
    expect(json.dod.p0_manual_tests).toBe(1)
  })

  it('JSON 包含 offenders 数组', () => {
    const output = runMetrics('--format json', testDir)
    const json = JSON.parse(output)
    expect(Array.isArray(json.rci_coverage.offenders)).toBe(true)
  })

  it('offenders 包含未更新 RCI 的 PR', () => {
    const output = runMetrics('--format json', testDir)
    const json = JSON.parse(output)
    // 测试目录中的 PR 没有真实的 git commit，所以都会被标记为未更新 RCI
    // offenders 应该包含 P0/P1 的 PR (100, 101)，不包含 NONE (102)
    const offenderPrs = json.rci_coverage.offenders.map((o: { pr: string }) => o.pr)
    expect(offenderPrs).toContain('100')
    expect(offenderPrs).toContain('101')
    expect(offenderPrs).not.toContain('102')
  })
})

describe('metrics.sh 时间窗口', () => {
  const testDir = path.join(tmpdir(), 'test-metrics-window')

  beforeAll(() => {
    execSync(`rm -rf ${testDir} && mkdir -p ${testDir}/.history`)
    execSync(`cd ${testDir} && git init --quiet`)
    // 配置 git user（CI 环境需要）
    execSync(`cd ${testDir} && git config user.email "test@example.com" && git config user.name "Test"`)

    // 本月的 PR
    const thisMonth = new Date()
    fs.writeFileSync(
      path.join(testDir, '.history', 'PR-200-20260122-1000.dod.md'),
      `<!-- pr:200 base:develop priority:P1 head:aaa1111 merged: created:${thisMonth.toISOString()} -->

# DoD
- [ ] This month item
  Test: tests/foo.test.ts
`
    )

    // 上个月的 PR
    const lastMonth = new Date()
    lastMonth.setMonth(lastMonth.getMonth() - 1)
    fs.writeFileSync(
      path.join(testDir, '.history', 'PR-199-20251222-1000.dod.md'),
      `<!-- pr:199 base:develop priority:P0 head:bbb2222 merged: created:${lastMonth.toISOString()} -->

# DoD
- [ ] Last month item
  Test: tests/bar.test.ts
`
    )
  })

  afterAll(() => {
    execSync(`rm -rf ${testDir}`)
  })

  it('默认只统计当前月', () => {
    const output = runMetrics('--format json', testDir)
    const json = JSON.parse(output)
    // 只有本月的 PR-200 (P1)
    expect(json.prs.p1).toBe(1)
    expect(json.prs.p0).toBe(0) // 上月的 P0 不计入
    expect(json.prs.total).toBe(1)
  })

  it('--month 可以指定其他月份', () => {
    const lastMonth = new Date()
    lastMonth.setMonth(lastMonth.getMonth() - 1)
    const monthStr = `${lastMonth.getFullYear()}-${String(lastMonth.getMonth() + 1).padStart(2, '0')}`

    const output = runMetrics(`--format json --month ${monthStr}`, testDir)
    const json = JSON.parse(output)
    // 上月的 PR-199 (P0)
    expect(json.prs.p0).toBe(1)
    expect(json.prs.p1).toBe(0)
    expect(json.prs.total).toBe(1)
  })
})

describe('bash -n 语法检查', () => {
  it('metrics.sh 语法正确', () => {
    const result = execSync(`bash -n ${METRICS_SCRIPT}`, {
      encoding: 'utf-8',
      cwd: ROOT,
    })
    expect(result).toBe('')
  })

  it('snapshot-prd-dod.sh 语法正确', () => {
    const result = execSync(`bash -n ${SNAPSHOT_SCRIPT}`, {
      encoding: 'utf-8',
      cwd: ROOT,
    })
    expect(result).toBe('')
  })
})
