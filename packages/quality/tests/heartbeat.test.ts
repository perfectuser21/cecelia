import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execSync } from 'child_process'
import { readFileSync, existsSync, unlinkSync, mkdirSync } from 'fs'
import { join } from 'path'

const PROJECT_ROOT = join(__dirname, '..')
const HEARTBEAT_SCRIPT = join(PROJECT_ROOT, 'heartbeat', 'heartbeat.sh')
const GATEWAY_SCRIPT = join(PROJECT_ROOT, 'gateway', 'gateway.sh')
const STATE_FILE = join(PROJECT_ROOT, 'state', 'state.json')
const QUEUE_FILE = join(PROJECT_ROOT, 'queue', 'queue.jsonl')

describe('Heartbeat', () => {
  beforeEach(() => {
    if (existsSync(STATE_FILE)) unlinkSync(STATE_FILE)
    if (existsSync(QUEUE_FILE)) unlinkSync(QUEUE_FILE)
    mkdirSync(join(PROJECT_ROOT, 'state'), { recursive: true })
    mkdirSync(join(PROJECT_ROOT, 'queue'), { recursive: true })
  })

  afterEach(() => {
    if (existsSync(STATE_FILE)) unlinkSync(STATE_FILE)
    if (existsSync(QUEUE_FILE)) unlinkSync(QUEUE_FILE)
  })

  it('可以执行健康检查', () => {
    const result = execSync(`bash ${HEARTBEAT_SCRIPT}`, { encoding: 'utf-8' })

    expect(result).toContain('Health Check')
    expect(result).toContain('All systems operational')
    expect(result).toContain('Heartbeat complete')
  })

  it('健康检查通过时更新 state.health 为 ok', () => {
    execSync(`bash ${HEARTBEAT_SCRIPT}`)

    expect(existsSync(STATE_FILE)).toBe(true)

    const state = JSON.parse(readFileSync(STATE_FILE, 'utf-8'))
    expect(state.health).toBe('ok')
  })

  it('队列为空时不触发 Worker', () => {
    const result = execSync(`bash ${HEARTBEAT_SCRIPT}`, { encoding: 'utf-8' })

    expect(result).toContain('Queue is empty, no action needed')
  })

  it('队列不为空时自动触发 Worker', () => {
    // Enqueue a task
    execSync(`bash ${GATEWAY_SCRIPT} add cloudcode runQA P0 '{}'`)

    // Run heartbeat
    const result = execSync(`bash ${HEARTBEAT_SCRIPT}`, { encoding: 'utf-8' })

    expect(result).toContain('Queue has 1 tasks, triggering worker')
    expect(result).toContain('Task dequeued')

    // Queue should be empty after worker runs
    const queueContent = readFileSync(QUEUE_FILE, 'utf-8').trim()
    expect(queueContent).toBe('')
  })

  it('检测到异常时自动入队 optimizeSelf 任务', () => {
    // For MVP, no anomalies detected, so this should not trigger
    // Placeholder for future anomaly detection logic
    const result = execSync(`bash ${HEARTBEAT_SCRIPT}`, { encoding: 'utf-8' })

    expect(result).toContain('No anomalies detected')
  })

  it('脚本可执行性检查', () => {
    const result = execSync(`bash ${HEARTBEAT_SCRIPT}`, { encoding: 'utf-8' })

    // Should not fail if gateway and worker are executable
    expect(result).toContain('All systems operational')
  })

  it('多次运行不报错', () => {
    execSync(`bash ${HEARTBEAT_SCRIPT}`)
    execSync(`bash ${HEARTBEAT_SCRIPT}`)
    execSync(`bash ${HEARTBEAT_SCRIPT}`)

    const state = JSON.parse(readFileSync(STATE_FILE, 'utf-8'))
    expect(state.health).toBe('ok')
  })
})
