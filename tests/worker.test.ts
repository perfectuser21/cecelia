import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execSync } from 'child_process'
import { readFileSync, existsSync, unlinkSync, mkdirSync, readdirSync } from 'fs'
import { join } from 'path'

const PROJECT_ROOT = join(__dirname, '..')
const GATEWAY_SCRIPT = join(PROJECT_ROOT, 'gateway', 'gateway.sh')
const WORKER_SCRIPT = join(PROJECT_ROOT, 'worker', 'worker.sh')
const QUEUE_FILE = join(PROJECT_ROOT, 'queue', 'queue.jsonl')
const STATE_FILE = join(PROJECT_ROOT, 'state', 'state.json')
const RUNS_DIR = join(PROJECT_ROOT, 'runs')

describe('Worker', () => {
  beforeEach(() => {
    // Clean up
    if (existsSync(QUEUE_FILE)) unlinkSync(QUEUE_FILE)
    if (existsSync(STATE_FILE)) unlinkSync(STATE_FILE)
    if (existsSync(RUNS_DIR)) {
      const runs = readdirSync(RUNS_DIR)
      runs.forEach(run => {
        const runDir = join(RUNS_DIR, run)
        const files = readdirSync(runDir)
        files.forEach(file => unlinkSync(join(runDir, file)))
        unlinkSync(runDir)
      })
    }

    mkdirSync(join(PROJECT_ROOT, 'queue'), { recursive: true })
    mkdirSync(join(PROJECT_ROOT, 'state'), { recursive: true })
  })

  afterEach(() => {
    // Clean up
    if (existsSync(QUEUE_FILE)) unlinkSync(QUEUE_FILE)
    if (existsSync(STATE_FILE)) unlinkSync(STATE_FILE)
  })

  it('可以从队列消费任务', () => {
    // Enqueue a task
    execSync(`bash ${GATEWAY_SCRIPT} add cloudcode runQA P0 '{"project":"test"}'`)

    // Worker should process it
    const result = execSync(`bash ${WORKER_SCRIPT}`, { encoding: 'utf-8' })

    expect(result).toContain('Task dequeued')
    expect(result).toContain('Executing task')
    expect(result).toContain('Task completed')

    // Queue should be empty after processing
    const queueContent = readFileSync(QUEUE_FILE, 'utf-8').trim()
    expect(queueContent).toBe('')
  })

  it('按优先级处理任务（P0 优先）', () => {
    // Enqueue tasks in reverse priority order
    execSync(`bash ${GATEWAY_SCRIPT} add cloudcode runQA P2 '{"id":"p2"}'`)
    execSync(`bash ${GATEWAY_SCRIPT} add cloudcode runQA P1 '{"id":"p1"}'`)
    execSync(`bash ${GATEWAY_SCRIPT} add cloudcode runQA P0 '{"id":"p0"}'`)

    // Worker should process P0 first
    const result = execSync(`bash ${WORKER_SCRIPT}`, { encoding: 'utf-8' })

    // Check runs directory for the processed task
    const runs = readdirSync(RUNS_DIR)
    expect(runs.length).toBe(1)

    const taskFile = join(RUNS_DIR, runs[0], 'task.json')
    const task = JSON.parse(readFileSync(taskFile, 'utf-8'))

    expect(task.priority).toBe('P0')
    expect(task.payload.id).toBe('p0')
  })

  it('执行后生成 run 目录和产物', () => {
    execSync(`bash ${GATEWAY_SCRIPT} add cloudcode runQA P0 '{"project":"test"}'`)
    execSync(`bash ${WORKER_SCRIPT}`, { encoding: 'utf-8' })

    const runs = readdirSync(RUNS_DIR)
    expect(runs.length).toBe(1)

    const runDir = join(RUNS_DIR, runs[0])
    expect(existsSync(join(runDir, 'task.json'))).toBe(true)
    expect(existsSync(join(runDir, 'result.json'))).toBe(true)
  })

  it('执行后更新 state.json 的 lastRun', () => {
    execSync(`bash ${GATEWAY_SCRIPT} add cloudcode runQA P0 '{"project":"test"}'`)
    execSync(`bash ${WORKER_SCRIPT}`, { encoding: 'utf-8' })

    const state = JSON.parse(readFileSync(STATE_FILE, 'utf-8'))

    expect(state.lastRun).toBeTruthy()
    expect(state.lastRun.taskId).toBeTruthy()
    expect(state.lastRun.completedAt).toBeTruthy()
  })

  it('队列为空时不报错', () => {
    const result = execSync(`bash ${WORKER_SCRIPT}`, { encoding: 'utf-8' })

    expect(result).toContain('No tasks in queue')
  })

  it('支持不同的 intent 路由', () => {
    // Enqueue tasks with different intents
    execSync(`bash ${GATEWAY_SCRIPT} add cloudcode runQA P0 '{}'`)

    const result = execSync(`bash ${WORKER_SCRIPT}`, { encoding: 'utf-8' })

    expect(result).toContain('Intent: runQA')
    expect(result).toContain('Running QA orchestrator')
  })

  it('未知 intent 返回错误', () => {
    // Manually create a task with unknown intent
    const task = {
      taskId: '12345678-1234-1234-1234-123456789abc',
      source: 'test',
      intent: 'unknownIntent',
      priority: 'P0',
      payload: {}
    }

    execSync(`bash ${GATEWAY_SCRIPT} enqueue '${JSON.stringify(task)}'`)

    const result = execSync(`bash ${WORKER_SCRIPT}`, { encoding: 'utf-8' })

    expect(result).toContain('Unknown intent')

    // Check result.json
    const runs = readdirSync(RUNS_DIR)
    const resultFile = join(RUNS_DIR, runs[0], 'result.json')
    const resultData = JSON.parse(readFileSync(resultFile, 'utf-8'))

    expect(resultData.status).toBe('error')
    expect(resultData.reason).toBe('unknown_intent')
  })
})
