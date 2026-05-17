import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execSync } from 'child_process'
import { readFileSync, existsSync, unlinkSync, mkdirSync, readdirSync, rmdirSync } from 'fs'
import { join } from 'path'

const PROJECT_ROOT = join(__dirname, '..')
const GATEWAY_SCRIPT = join(PROJECT_ROOT, 'gateway', 'gateway.sh')
const WORKER_SCRIPT = join(PROJECT_ROOT, 'worker', 'worker.sh')
const HEARTBEAT_SCRIPT = join(PROJECT_ROOT, 'heartbeat', 'heartbeat.sh')
const QUEUE_FILE = join(PROJECT_ROOT, 'queue', 'queue.jsonl')
const STATE_FILE = join(PROJECT_ROOT, 'state', 'state.json')
const RUNS_DIR = join(PROJECT_ROOT, 'runs')

describe('E2E: Gateway System', () => {
  beforeEach(() => {
    // Clean up
    if (existsSync(QUEUE_FILE)) unlinkSync(QUEUE_FILE)
    if (existsSync(STATE_FILE)) unlinkSync(STATE_FILE)
    if (existsSync(RUNS_DIR)) {
      const runs = readdirSync(RUNS_DIR)
      runs.forEach(run => {
        const runDir = join(RUNS_DIR, run)
        if (existsSync(runDir)) {
          const files = readdirSync(runDir)
          files.forEach(file => unlinkSync(join(runDir, file)))
          rmdirSync(runDir)
        }
      })
    }

    mkdirSync(join(PROJECT_ROOT, 'queue'), { recursive: true })
    mkdirSync(join(PROJECT_ROOT, 'state'), { recursive: true })
  })

  afterEach(() => {
    if (existsSync(QUEUE_FILE)) unlinkSync(QUEUE_FILE)
    if (existsSync(STATE_FILE)) unlinkSync(STATE_FILE)
  })

  it('端到端：CloudCode 输入 → Gateway → Queue → Worker → Evidence', () => {
    // Step 1: CloudCode enqueues task via Gateway
    const enqueueResult = execSync(
      `bash ${GATEWAY_SCRIPT} add cloudcode runQA P0 '{"project":"cecelia-quality","branch":"develop"}'`,
      { encoding: 'utf-8' }
    )

    expect(enqueueResult).toContain('Task enqueued')

    // Step 2: Verify task in queue
    expect(existsSync(QUEUE_FILE)).toBe(true)
    const queueContent = readFileSync(QUEUE_FILE, 'utf-8')
    const task = JSON.parse(queueContent.trim())

    expect(task.source).toBe('cloudcode')
    expect(task.intent).toBe('runQA')
    expect(task.priority).toBe('P0')

    // Step 3: Worker processes task
    const workerResult = execSync(`bash ${WORKER_SCRIPT}`, { encoding: 'utf-8' })

    expect(workerResult).toContain('Task dequeued')
    expect(workerResult).toContain('Task completed')

    // Step 4: Verify evidence (run directory and result.json)
    const runs = readdirSync(RUNS_DIR)
    expect(runs.length).toBe(1)

    const runDir = join(RUNS_DIR, runs[0])
    expect(existsSync(join(runDir, 'task.json'))).toBe(true)
    expect(existsSync(join(runDir, 'result.json'))).toBe(true)

    const result = JSON.parse(readFileSync(join(runDir, 'result.json'), 'utf-8'))
    expect(result.status).toBe('completed')
    expect(result.intent).toBe('runQA')

    // Step 5: Verify state updated
    const state = JSON.parse(readFileSync(STATE_FILE, 'utf-8'))
    expect(state.lastRun).toBeTruthy()
    expect(state.queueLength).toBe(0)
  })

  it('端到端：n8n 输入 → Gateway → Queue → Worker', () => {
    // Simulate n8n webhook
    const taskJson = JSON.stringify({
      taskId: 'n8n-task-123',
      source: 'n8n',
      intent: 'fixBug',
      priority: 'P1',
      payload: {
        project: 'cecelia-workspace',
        branch: 'feature/bug-fix',
        issue: 'Fix login bug'
      }
    })

    execSync(`bash ${GATEWAY_SCRIPT} enqueue '${taskJson}'`)
    execSync(`bash ${WORKER_SCRIPT}`)

    const runs = readdirSync(RUNS_DIR)
    expect(runs.length).toBe(1)

    const taskFile = join(RUNS_DIR, runs[0], 'task.json')
    const task = JSON.parse(readFileSync(taskFile, 'utf-8'))

    expect(task.taskId).toBe('n8n-task-123')
    expect(task.source).toBe('n8n')
    expect(task.intent).toBe('fixBug')
  })

  it('端到端：Heartbeat 自动触发 → Worker 执行', () => {
    // Enqueue task
    execSync(`bash ${GATEWAY_SCRIPT} add webhook runQA P0 '{}'`)

    // Heartbeat should detect queue and trigger worker
    const heartbeatResult = execSync(`bash ${HEARTBEAT_SCRIPT}`, { encoding: 'utf-8' })

    expect(heartbeatResult).toContain('Queue has 1 tasks, triggering worker')
    expect(heartbeatResult).toContain('Task completed')

    // Queue should be empty
    const queueContent = readFileSync(QUEUE_FILE, 'utf-8').trim()
    expect(queueContent).toBe('')

    // Evidence should exist
    const runs = readdirSync(RUNS_DIR)
    expect(runs.length).toBe(1)
  })

  it('端到端：多任务处理（优先级排序）', () => {
    // Enqueue multiple tasks with different priorities
    execSync(`bash ${GATEWAY_SCRIPT} add cloudcode runQA P2 '{"id":"low"}'`)
    execSync(`bash ${GATEWAY_SCRIPT} add cloudcode runQA P0 '{"id":"critical"}'`)
    execSync(`bash ${GATEWAY_SCRIPT} add cloudcode runQA P1 '{"id":"high"}'`)

    // Process first task (should be P0)
    execSync(`bash ${WORKER_SCRIPT}`)

    let runs = readdirSync(RUNS_DIR)
    expect(runs.length).toBe(1)

    let task = JSON.parse(readFileSync(join(RUNS_DIR, runs[0], 'task.json'), 'utf-8'))
    expect(task.priority).toBe('P0')
    expect(task.payload.id).toBe('critical')

    // Process second task (should be P1)
    execSync(`bash ${WORKER_SCRIPT}`)

    runs = readdirSync(RUNS_DIR)
    expect(runs.length).toBe(2)

    const secondRun = runs[1]
    task = JSON.parse(readFileSync(join(RUNS_DIR, secondRun, 'task.json'), 'utf-8'))
    expect(task.priority).toBe('P1')
    expect(task.payload.id).toBe('high')

    // Process third task (should be P2)
    execSync(`bash ${WORKER_SCRIPT}`)

    runs = readdirSync(RUNS_DIR)
    expect(runs.length).toBe(3)

    const thirdRun = runs[2]
    task = JSON.parse(readFileSync(join(RUNS_DIR, thirdRun, 'task.json'), 'utf-8'))
    expect(task.priority).toBe('P2')
    expect(task.payload.id).toBe('low')
  })

  it('端到端：状态追踪全流程', () => {
    // Initial state
    expect(existsSync(STATE_FILE)).toBe(false)

    // Enqueue task
    execSync(`bash ${GATEWAY_SCRIPT} add cloudcode runQA P0 '{}'`)

    let state = JSON.parse(readFileSync(STATE_FILE, 'utf-8'))
    expect(state.queueLength).toBe(1)
    expect(state.lastRun).toBeNull()

    // Process task
    execSync(`bash ${WORKER_SCRIPT}`)

    state = JSON.parse(readFileSync(STATE_FILE, 'utf-8'))
    expect(state.queueLength).toBe(0)
    expect(state.lastRun).toBeTruthy()
    expect(state.lastRun.taskId).toBeTruthy()
    expect(state.lastRun.completedAt).toBeTruthy()

    // Heartbeat check
    execSync(`bash ${HEARTBEAT_SCRIPT}`)

    state = JSON.parse(readFileSync(STATE_FILE, 'utf-8'))
    expect(state.health).toBe('ok')
  })
})
