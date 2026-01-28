import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execSync } from 'child_process'
import { readFileSync, existsSync, unlinkSync, mkdirSync } from 'fs'
import { join } from 'path'

const PROJECT_ROOT = join(__dirname, '..')
const GATEWAY_SCRIPT = join(PROJECT_ROOT, 'gateway', 'gateway.sh')
const QUEUE_FILE = join(PROJECT_ROOT, 'queue', 'queue.jsonl')
const STATE_FILE = join(PROJECT_ROOT, 'state', 'state.json')

describe('Gateway', () => {
  beforeEach(() => {
    // Clean up queue and state before each test
    if (existsSync(QUEUE_FILE)) {
      unlinkSync(QUEUE_FILE)
    }
    if (existsSync(STATE_FILE)) {
      unlinkSync(STATE_FILE)
    }
    mkdirSync(join(PROJECT_ROOT, 'queue'), { recursive: true })
    mkdirSync(join(PROJECT_ROOT, 'state'), { recursive: true })
  })

  afterEach(() => {
    // Clean up after tests
    if (existsSync(QUEUE_FILE)) {
      unlinkSync(QUEUE_FILE)
    }
    if (existsSync(STATE_FILE)) {
      unlinkSync(STATE_FILE)
    }
  })

  it('可以通过 CLI 模式入队任务', () => {
    const result = execSync(
      `bash ${GATEWAY_SCRIPT} add cloudcode runQA P0 '{"project":"test"}'`,
      { encoding: 'utf-8' }
    )

    expect(result).toContain('Task enqueued')
    expect(existsSync(QUEUE_FILE)).toBe(true)

    const queueContent = readFileSync(QUEUE_FILE, 'utf-8')
    const task = JSON.parse(queueContent.trim())

    expect(task.source).toBe('cloudcode')
    expect(task.intent).toBe('runQA')
    expect(task.priority).toBe('P0')
    expect(task.payload.project).toBe('test')
    expect(task.taskId).toBeTruthy()
  })

  it('可以通过 JSON 模式入队任务', () => {
    const taskJson = JSON.stringify({
      taskId: '12345678-1234-1234-1234-123456789abc',
      source: 'n8n',
      intent: 'fixBug',
      priority: 'P1',
      payload: { branch: 'develop' }
    })

    const result = execSync(
      `bash ${GATEWAY_SCRIPT} enqueue '${taskJson}'`,
      { encoding: 'utf-8' }
    )

    expect(result).toContain('Task enqueued')
    expect(existsSync(QUEUE_FILE)).toBe(true)

    const queueContent = readFileSync(QUEUE_FILE, 'utf-8')
    const task = JSON.parse(queueContent.trim())

    expect(task.taskId).toBe('12345678-1234-1234-1234-123456789abc')
    expect(task.source).toBe('n8n')
    expect(task.intent).toBe('fixBug')
  })

  it('入队后更新状态文件', () => {
    execSync(
      `bash ${GATEWAY_SCRIPT} add cloudcode runQA P0 '{"project":"test"}'`,
      { encoding: 'utf-8' }
    )

    expect(existsSync(STATE_FILE)).toBe(true)

    const state = JSON.parse(readFileSync(STATE_FILE, 'utf-8'))
    expect(state.queueLength).toBe(1)
  })

  it('拒绝无效的 JSON 格式', () => {
    try {
      execSync(
        `bash ${GATEWAY_SCRIPT} enqueue 'invalid json'`,
        { encoding: 'utf-8' }
      )
      expect.fail('Should have thrown an error')
    } catch (error: any) {
      expect(error.stderr).toContain('Invalid JSON')
    }
  })

  it('拒绝缺少必填字段的任务', () => {
    const invalidTask = JSON.stringify({
      taskId: '12345678-1234-1234-1234-123456789abc',
      source: 'cloudcode'
      // Missing: intent, priority
    })

    try {
      execSync(
        `bash ${GATEWAY_SCRIPT} enqueue '${invalidTask}'`,
        { encoding: 'utf-8' }
      )
      expect.fail('Should have thrown an error')
    } catch (error: any) {
      expect(error.stderr).toContain('Missing required fields')
    }
  })

  it('status 命令显示队列状态', () => {
    // Enqueue multiple tasks with different priorities
    execSync(`bash ${GATEWAY_SCRIPT} add cloudcode runQA P0 '{}'`)
    execSync(`bash ${GATEWAY_SCRIPT} add n8n fixBug P1 '{}'`)
    execSync(`bash ${GATEWAY_SCRIPT} add webhook refactor P2 '{}'`)

    const result = execSync(`bash ${GATEWAY_SCRIPT} status`, { encoding: 'utf-8' })

    expect(result).toContain('Total tasks: 3')
    expect(result).toContain('P0 (critical): 1')
    expect(result).toContain('P1 (high):     1')
    expect(result).toContain('P2 (normal):   1')
  })

  it('自动添加 createdAt 时间戳', () => {
    execSync(`bash ${GATEWAY_SCRIPT} add cloudcode runQA P0 '{}'`)

    const queueContent = readFileSync(QUEUE_FILE, 'utf-8')
    const task = JSON.parse(queueContent.trim())

    expect(task.createdAt).toBeTruthy()
    expect(new Date(task.createdAt).toISOString()).toBe(task.createdAt)
  })
})
