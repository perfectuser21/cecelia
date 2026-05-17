import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execSync } from 'child_process'
import { readFileSync, existsSync, unlinkSync, mkdirSync } from 'fs'
import { join } from 'path'

const PROJECT_ROOT = join(__dirname, '..')
const GATEWAY_SCRIPT = join(PROJECT_ROOT, 'gateway', 'gateway.sh')
const WORKER_SCRIPT = join(PROJECT_ROOT, 'worker', 'worker.sh')
const STATE_FILE = join(PROJECT_ROOT, 'state', 'state.json')
const QUEUE_FILE = join(PROJECT_ROOT, 'queue', 'queue.jsonl')

describe('State', () => {
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

  it('state.json 自动初始化', () => {
    execSync(`bash ${GATEWAY_SCRIPT} add cloudcode runQA P0 '{}'`)

    expect(existsSync(STATE_FILE)).toBe(true)

    const state = JSON.parse(readFileSync(STATE_FILE, 'utf-8'))

    expect(state.lastRun).toBeDefined()
    expect(state.queueLength).toBeDefined()
    expect(state.health).toBeDefined()
  })

  it('追踪 queueLength 变化', () => {
    // Initially 0
    execSync(`bash ${GATEWAY_SCRIPT} add cloudcode runQA P0 '{}'`)
    let state = JSON.parse(readFileSync(STATE_FILE, 'utf-8'))
    expect(state.queueLength).toBe(1)

    // Add more
    execSync(`bash ${GATEWAY_SCRIPT} add cloudcode runQA P0 '{}'`)
    state = JSON.parse(readFileSync(STATE_FILE, 'utf-8'))
    expect(state.queueLength).toBe(2)

    // Worker processes one
    execSync(`bash ${WORKER_SCRIPT}`)
    state = JSON.parse(readFileSync(STATE_FILE, 'utf-8'))
    expect(state.queueLength).toBe(1)
  })

  it('记录 lastRun 信息', () => {
    execSync(`bash ${GATEWAY_SCRIPT} add cloudcode runQA P0 '{}'`)
    execSync(`bash ${WORKER_SCRIPT}`)

    const state = JSON.parse(readFileSync(STATE_FILE, 'utf-8'))

    expect(state.lastRun).toBeTruthy()
    expect(state.lastRun.taskId).toBeTruthy()
    expect(state.lastRun.completedAt).toBeTruthy()

    // Validate ISO 8601 format
    expect(new Date(state.lastRun.completedAt).toISOString()).toBe(state.lastRun.completedAt)
  })

  it('health 状态默认为 ok', () => {
    execSync(`bash ${GATEWAY_SCRIPT} add cloudcode runQA P0 '{}'`)

    const state = JSON.parse(readFileSync(STATE_FILE, 'utf-8'))

    expect(state.health).toBe('ok')
  })

  it('state.json 格式有效（可被 jq 解析）', () => {
    execSync(`bash ${GATEWAY_SCRIPT} add cloudcode runQA P0 '{}'`)

    // Use jq to validate
    const result = execSync(`jq empty ${STATE_FILE}`, { encoding: 'utf-8' })

    expect(result.trim()).toBe('')
  })

  it('多次运行后 lastRun 更新', () => {
    // First run
    execSync(`bash ${GATEWAY_SCRIPT} add cloudcode runQA P0 '{}'`)
    execSync(`bash ${WORKER_SCRIPT}`)

    let state = JSON.parse(readFileSync(STATE_FILE, 'utf-8'))
    const firstRunId = state.lastRun.taskId

    // Second run
    execSync(`bash ${GATEWAY_SCRIPT} add cloudcode runQA P0 '{}'`)
    execSync(`bash ${WORKER_SCRIPT}`)

    state = JSON.parse(readFileSync(STATE_FILE, 'utf-8'))
    const secondRunId = state.lastRun.taskId

    expect(firstRunId).not.toBe(secondRunId)
  })
})
