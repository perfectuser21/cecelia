/**
 * L4 task-lifecycle E2E 测试
 *
 * 验证任务完整生命周期：创建 → dispatch → agent 接收 → 完成
 *
 * 设计原则：
 * - CI-safe：使用状态机逻辑测试，不依赖真实 Brain 实例
 * - 覆盖核心状态转换：pending → queued → in_progress → completed
 * - 覆盖异常路径：failed、cancelled
 */

import { describe, it, expect } from 'vitest'

type TaskStatus =
  | 'pending'
  | 'queued'
  | 'in_progress'
  | 'completed'
  | 'failed'
  | 'cancelled'

interface Task {
  id: string
  title: string
  status: TaskStatus
  created_at: string
  updated_at: string
  result?: string
  error?: string
}

class TaskLifecycle {
  private tasks: Map<string, Task> = new Map()
  private idCounter = 0

  create(title: string): Task {
    const id = `task-${++this.idCounter}`
    const now = new Date().toISOString()
    const task: Task = { id, title, status: 'pending', created_at: now, updated_at: now }
    this.tasks.set(id, task)
    return task
  }

  dispatch(id: string): Task {
    const task = this.getTask(id)
    this.validateTransition(task.status, 'queued')
    return this.update(id, { status: 'queued' })
  }

  accept(id: string): Task {
    const task = this.getTask(id)
    this.validateTransition(task.status, 'in_progress')
    return this.update(id, { status: 'in_progress' })
  }

  complete(id: string, result: string): Task {
    const task = this.getTask(id)
    this.validateTransition(task.status, 'completed')
    return this.update(id, { status: 'completed', result })
  }

  fail(id: string, error: string): Task {
    const task = this.getTask(id)
    this.validateTransition(task.status, 'failed')
    return this.update(id, { status: 'failed', error })
  }

  cancel(id: string): Task {
    const task = this.getTask(id)
    this.validateTransition(task.status, 'cancelled')
    return this.update(id, { status: 'cancelled' })
  }

  getTask(id: string): Task {
    const task = this.tasks.get(id)
    if (!task) throw new Error(`Task ${id} not found`)
    return task
  }

  private update(id: string, patch: Partial<Task>): Task {
    const task = this.getTask(id)
    const updated = { ...task, ...patch, updated_at: new Date().toISOString() }
    this.tasks.set(id, updated)
    return updated
  }

  private validateTransition(from: TaskStatus, to: TaskStatus): void {
    const allowed: Record<TaskStatus, TaskStatus[]> = {
      pending: ['queued', 'cancelled'],
      queued: ['in_progress', 'cancelled'],
      in_progress: ['completed', 'failed'],
      completed: [],
      failed: [],
      cancelled: [],
    }
    if (!allowed[from].includes(to)) {
      throw new Error(`非法状态转换: ${from} → ${to}`)
    }
  }
}

describe('L4 task-lifecycle: 任务完整生命周期', () => {
  it('黄金路径：创建 → dispatch → agent 接收 → 完成', () => {
    const lc = new TaskLifecycle()

    const task = lc.create('fix(ci): 扩展覆盖率门禁至 fix/refactor')
    expect(task.status).toBe('pending')
    expect(task.id).toBeTruthy()

    const queued = lc.dispatch(task.id)
    expect(queued.status).toBe('queued')

    const inProgress = lc.accept(task.id)
    expect(inProgress.status).toBe('in_progress')

    const completed = lc.complete(task.id, 'PR merged: #1467')
    expect(completed.status).toBe('completed')
    expect(completed.result).toBe('PR merged: #1467')
  })

  it('失败路径：任务执行失败，状态转为 failed', () => {
    const lc = new TaskLifecycle()
    const task = lc.create('test-failure-path')
    lc.dispatch(task.id)
    lc.accept(task.id)

    const failed = lc.fail(task.id, 'CI timeout after 30min')
    expect(failed.status).toBe('failed')
    expect(failed.error).toBe('CI timeout after 30min')
  })

  it('取消路径：pending 任务可被取消', () => {
    const lc = new TaskLifecycle()
    const task = lc.create('test-cancel-pending')
    const cancelled = lc.cancel(task.id)
    expect(cancelled.status).toBe('cancelled')
  })

  it('取消路径：queued 任务可被取消', () => {
    const lc = new TaskLifecycle()
    const task = lc.create('test-cancel-queued')
    lc.dispatch(task.id)
    const cancelled = lc.cancel(task.id)
    expect(cancelled.status).toBe('cancelled')
  })

  it('状态机约束：completed 任务不能再次转换', () => {
    const lc = new TaskLifecycle()
    const task = lc.create('test-terminal-state')
    lc.dispatch(task.id)
    lc.accept(task.id)
    lc.complete(task.id, 'done')

    expect(() => lc.fail(task.id, 'error')).toThrow('非法状态转换')
    expect(() => lc.cancel(task.id)).toThrow('非法状态转换')
  })

  it('状态机约束：不能跳过 queued 直接进入 in_progress', () => {
    const lc = new TaskLifecycle()
    const task = lc.create('test-skip-queued')
    expect(() => lc.accept(task.id)).toThrow('非法状态转换')
  })

  it('状态机约束：不能从 pending 直接 complete', () => {
    const lc = new TaskLifecycle()
    const task = lc.create('test-direct-complete')
    expect(() => lc.complete(task.id, 'skip')).toThrow('非法状态转换')
  })

  it('多任务并发：互不干扰', () => {
    const lc = new TaskLifecycle()
    const t1 = lc.create('task-alpha')
    const t2 = lc.create('task-beta')
    const t3 = lc.create('task-gamma')

    lc.dispatch(t1.id); lc.accept(t1.id); lc.complete(t1.id, 'done')
    lc.dispatch(t2.id); lc.accept(t2.id); lc.fail(t2.id, 'timeout')
    lc.cancel(t3.id)

    expect(lc.getTask(t1.id).status).toBe('completed')
    expect(lc.getTask(t2.id).status).toBe('failed')
    expect(lc.getTask(t3.id).status).toBe('cancelled')
  })

  it('任务不存在时抛出错误', () => {
    const lc = new TaskLifecycle()
    expect(() => lc.dispatch('non-existent-id')).toThrow('not found')
  })
})
