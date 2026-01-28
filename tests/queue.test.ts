import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execSync } from 'child_process'
import { readFileSync, existsSync, unlinkSync, mkdirSync } from 'fs'
import { join } from 'path'

const PROJECT_ROOT = join(__dirname, '..')
const GATEWAY_SCRIPT = join(PROJECT_ROOT, 'gateway', 'gateway.sh')
const QUEUE_FILE = join(PROJECT_ROOT, 'queue', 'queue.jsonl')

describe('Queue', () => {
  beforeEach(() => {
    if (existsSync(QUEUE_FILE)) {
      unlinkSync(QUEUE_FILE)
    }
    mkdirSync(join(PROJECT_ROOT, 'queue'), { recursive: true })
  })

  afterEach(() => {
    if (existsSync(QUEUE_FILE)) {
      unlinkSync(QUEUE_FILE)
    }
  })

  it('可以存储任务到 JSONL 文件', () => {
    execSync(`bash ${GATEWAY_SCRIPT} add cloudcode runQA P0 '{"project":"test"}'`)

    expect(existsSync(QUEUE_FILE)).toBe(true)

    const content = readFileSync(QUEUE_FILE, 'utf-8')
    const lines = content.trim().split('\n')

    expect(lines.length).toBe(1)

    const task = JSON.parse(lines[0])
    expect(task.source).toBe('cloudcode')
    expect(task.intent).toBe('runQA')
  })

  it('支持优先级排序（P0 > P1 > P2）', () => {
    // Enqueue in reverse priority order
    execSync(`bash ${GATEWAY_SCRIPT} add cloudcode runQA P2 '{"id":"task-p2"}'`)
    execSync(`bash ${GATEWAY_SCRIPT} add cloudcode runQA P0 '{"id":"task-p0"}'`)
    execSync(`bash ${GATEWAY_SCRIPT} add cloudcode runQA P1 '{"id":"task-p1"}'`)

    const content = readFileSync(QUEUE_FILE, 'utf-8')
    const tasks = content.trim().split('\n').map(line => JSON.parse(line))

    // Tasks should be stored in the order they were added
    expect(tasks.length).toBe(3)

    // Worker should read them in priority order (tested in worker.test.ts)
    const priorities = tasks.map(t => t.priority)
    expect(priorities).toEqual(['P2', 'P0', 'P1'])
  })

  it('可以读取多个任务', () => {
    execSync(`bash ${GATEWAY_SCRIPT} add cloudcode runQA P0 '{"id":"1"}'`)
    execSync(`bash ${GATEWAY_SCRIPT} add n8n fixBug P1 '{"id":"2"}'`)
    execSync(`bash ${GATEWAY_SCRIPT} add webhook refactor P2 '{"id":"3"}'`)

    const content = readFileSync(QUEUE_FILE, 'utf-8')
    const tasks = content.trim().split('\n').map(line => JSON.parse(line))

    expect(tasks.length).toBe(3)
    expect(tasks[0].payload.id).toBe('1')
    expect(tasks[1].payload.id).toBe('2')
    expect(tasks[2].payload.id).toBe('3')
  })

  it('空队列时 status 显示正确', () => {
    const result = execSync(`bash ${GATEWAY_SCRIPT} status`, { encoding: 'utf-8' })

    expect(result).toContain('Queue is empty')
  })

  it('队列文件不存在时自动创建', () => {
    if (existsSync(QUEUE_FILE)) {
      unlinkSync(QUEUE_FILE)
    }

    execSync(`bash ${GATEWAY_SCRIPT} add cloudcode runQA P0 '{}'`)

    expect(existsSync(QUEUE_FILE)).toBe(true)
  })
})
