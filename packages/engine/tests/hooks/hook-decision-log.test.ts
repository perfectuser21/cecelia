// packages/engine/tests/hooks/hook-decision-log.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execSync } from 'child_process'
import { readFileSync, existsSync, mkdtempSync, rmSync } from 'fs'
import { resolve, join } from 'path'
import { tmpdir } from 'os'

describe('log_hook_decision (devloop-check.sh)', () => {
  const lib = resolve(__dirname, '../../lib/devloop-check.sh')
  let testHome: string

  beforeEach(() => {
    testHome = mkdtempSync(join(tmpdir(), 'hooklog-test-'))
  })

  afterEach(() => {
    rmSync(testHome, { recursive: true, force: true })
  })

  it('合法字段 → 追加 JSON 一行', () => {
    const cmd = `HOME=${testHome} bash -c '
      source ${lib}
      log_hook_decision "abc12345" "block" "lights_alive" 3 "cp-test"
    '`
    execSync(cmd, { encoding: 'utf8' })

    const logFile = join(testHome, '.claude/hook-logs/stop-dev.jsonl')
    expect(existsSync(logFile)).toBe(true)

    const lastLine = readFileSync(logFile, 'utf8').trim().split('\n').pop()!
    const parsed = JSON.parse(lastLine)
    expect(parsed.session_id_short).toBe('abc12345')
    expect(parsed.decision).toBe('block')
    expect(parsed.reason_code).toBe('lights_alive')
    expect(parsed.lights_count).toBe(3)
    expect(parsed.branch).toBe('cp-test')
    expect(parsed.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('日志目录不存在时自动 mkdir -p', () => {
    const cmd = `HOME=${testHome} bash -c '
      source ${lib}
      log_hook_decision "x" "release" "all_dark" 0 ""
    '`
    execSync(cmd, { encoding: 'utf8' })
    expect(existsSync(join(testHome, '.claude/hook-logs/stop-dev.jsonl'))).toBe(true)
  })

  it('字段缺失时仍输出 JSON（默认值兜底）', () => {
    const cmd = `HOME=${testHome} bash -c '
      source ${lib}
      log_hook_decision "" "" "" "" ""
    '`
    execSync(cmd, { encoding: 'utf8' })
    const logFile = join(testHome, '.claude/hook-logs/stop-dev.jsonl')
    const lastLine = readFileSync(logFile, 'utf8').trim().split('\n').pop()!
    const parsed = JSON.parse(lastLine)  // 必须仍是合法 JSON
    expect(typeof parsed).toBe('object')
  })
})
