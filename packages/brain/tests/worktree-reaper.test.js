import { describe, it, expect, vi, beforeEach } from 'vitest'

import { runWorktreeReaper } from '../../../packages/brain/src/cron/worktree-reaper.js'

describe('worktree-reaper', () => {
  const WORKTREE_BASE = '/Users/administrator/perfect21/cecelia/.claude/worktrees/harness-v2'

  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Helper to build Dirent-like objects
  function makeEntry(name, isDirectory = true) {
    return { name, isDirectory: () => isDirectory }
  }

  it('[BEHAVIOR-5] 终态任务 updated_at 超 25h，目录被删除', async () => {
    const twentyFiveHoursAgo = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString()

    const readdirMock = vi.fn().mockResolvedValue([makeEntry('task-abc12345')])
    const rmMock = vi.fn().mockResolvedValue(undefined)
    const dbMock = {
      query: vi.fn().mockResolvedValue({
        rows: [{ status: 'completed', updated_at: twentyFiveHoursAgo }]
      })
    }

    const result = await runWorktreeReaper({
      readdir: readdirMock,
      rm: rmMock,
      db: dbMock,
      base: WORKTREE_BASE,
      existsSync: () => true,
    })

    // 断言：fs.rm 被调用，路径匹配 task-abc12345
    expect(rmMock).toHaveBeenCalledWith(
      `${WORKTREE_BASE}/task-abc12345`,
      { recursive: true, force: true }
    )

    // 结果含 action=deleted
    expect(result.results).toHaveLength(1)
    expect(result.results[0].action).toBe('deleted')
    expect(result.results[0].status).toBe('completed')
  })

  it('[BEHAVIOR-6][回归] in_progress worktree 绝对不删（INV-01 防第 6 次误杀）', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    const readdirMock = vi.fn().mockResolvedValue([makeEntry('task-xyz99999')])
    const rmMock = vi.fn().mockResolvedValue(undefined)
    const dbMock = {
      query: vi.fn().mockResolvedValue({
        rows: [{ status: 'in_progress', updated_at: new Date(Date.now() - 30 * 60 * 60 * 1000).toISOString() }]
      })
    }

    await runWorktreeReaper({
      readdir: readdirMock,
      rm: rmMock,
      db: dbMock,
      base: WORKTREE_BASE,
      existsSync: () => true,
    })

    // 断言核心：fs.rm 完全未被调用（任何路径）
    expect(rmMock).not.toHaveBeenCalled()

    // 断言日志含 action=skipped
    const logCalls = consoleSpy.mock.calls.map(c => c[0])
    const skippedLog = logCalls.find(s => s && s.includes('action=skipped'))
    expect(skippedLog).toBeDefined()

    consoleSpy.mockRestore()
  })

  it('[BEHAVIOR-7] task 查不到记录，跳过不删（fail-open）', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    const readdirMock = vi.fn().mockResolvedValue([makeEntry('task-unknown0')])
    const rmMock = vi.fn().mockResolvedValue(undefined)
    const dbMock = {
      // 返回空数组 = 查不到记录
      query: vi.fn().mockResolvedValue({ rows: [] })
    }

    await runWorktreeReaper({
      readdir: readdirMock,
      rm: rmMock,
      db: dbMock,
      base: WORKTREE_BASE,
      existsSync: () => true,
    })

    // 断言：fs.rm 未被调用（fail-open）
    expect(rmMock).not.toHaveBeenCalled()

    // 断言日志含 status=unknown action=skipped
    const logCalls = consoleSpy.mock.calls.map(c => c[0])
    const unknownLog = logCalls.find(s => s && s.includes('status=unknown') && s.includes('action=skipped'))
    expect(unknownLog).toBeDefined()

    consoleSpy.mockRestore()
  })

  it('[BEHAVIOR-6-extra] pending 任务 worktree 也绝对不删', async () => {
    const readdirMock = vi.fn().mockResolvedValue([makeEntry('task-pend1234')])
    const rmMock = vi.fn().mockResolvedValue(undefined)
    const dbMock = {
      query: vi.fn().mockResolvedValue({
        rows: [{ status: 'pending', updated_at: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString() }]
      })
    }

    await runWorktreeReaper({
      readdir: readdirMock,
      rm: rmMock,
      db: dbMock,
      base: WORKTREE_BASE,
      existsSync: () => true,
    })

    expect(rmMock).not.toHaveBeenCalled()
  })

  it('[BEHAVIOR-5-boundary] 终态任务但 updated_at 仅 23h，不删', async () => {
    const twentyThreeHoursAgo = new Date(Date.now() - 23 * 60 * 60 * 1000).toISOString()

    const readdirMock = vi.fn().mockResolvedValue([makeEntry('task-recent1')])
    const rmMock = vi.fn().mockResolvedValue(undefined)
    const dbMock = {
      query: vi.fn().mockResolvedValue({
        rows: [{ status: 'completed', updated_at: twentyThreeHoursAgo }]
      })
    }

    await runWorktreeReaper({
      readdir: readdirMock,
      rm: rmMock,
      db: dbMock,
      base: WORKTREE_BASE,
      existsSync: () => true,
    })

    // 边界：completed 但未满 24h → 不删
    expect(rmMock).not.toHaveBeenCalled()
  })
})
