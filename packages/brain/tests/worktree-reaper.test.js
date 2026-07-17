import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as fs from 'fs/promises'

// 这些 import 会 fail（模块还不存在）— TDD Red 阶段
import { runWorktreeReaper } from '../../../packages/brain/src/cron/worktree-reaper.js'

// Mock fs 和 Brain DB 查询
vi.mock('fs/promises')

describe('worktree-reaper', () => {
  const WORKTREE_BASE = '/Users/administrator/perfect21/cecelia/.claude/worktrees/harness-v2'

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('[BEHAVIOR-5] 终态任务 updated_at 超 25h，目录被删除', async () => {
    // mock readdir 返回 ['task-abc12345']
    vi.mocked(fs.readdir).mockResolvedValueOnce(['task-abc12345'])

    // mock Brain DB 查询：status=completed，updated_at = 25h 前
    const twentyFiveHoursAgo = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString()
    // （实现中通过 fetch 或 pool 查询，这里通过 vi.mock 或依赖注入覆盖）

    // mock fs.rm 成功
    vi.mocked(fs.rm).mockResolvedValueOnce(undefined)

    // 注入 mock DB 查询（实现需支持注入，或通过 vi.mock 覆盖 db.js）
    // 此处假设实现导出 __setDbQueryForTest 或通过 vi.mock('../../../packages/brain/src/db.js')

    // 执行
    // await runWorktreeReaper()

    // 断言：fs.rm 被调用，路径匹配 task-abc12345
    // expect(fs.rm).toHaveBeenCalledWith(
    //   `${WORKTREE_BASE}/task-abc12345`,
    //   { recursive: true, force: true }
    // )

    // TDD Red：实现不存在，import 失败
    expect(true).toBe(false)
  })

  it('[BEHAVIOR-6][回归] in_progress worktree 绝对不删（INV-01 防第 6 次误杀）', async () => {
    // mock readdir 返回 ['task-xyz99999']
    vi.mocked(fs.readdir).mockResolvedValueOnce(['task-xyz99999'])

    // mock DB 查询：status=in_progress
    // （注入 mock，返回 { status: 'in_progress', updated_at: ... }）

    // 执行
    // await runWorktreeReaper()

    // 断言核心：fs.rm 完全未被调用（任何路径）
    // expect(fs.rm).not.toHaveBeenCalled()

    // 断言日志含 action=skipped
    // （通过 spy console.log 或捕获日志实现）

    // TDD Red
    expect(true).toBe(false)
  })

  it('[BEHAVIOR-7] task 查不到记录，跳过不删（fail-open）', async () => {
    // mock readdir 返回 ['task-unknown0']
    vi.mocked(fs.readdir).mockResolvedValueOnce(['task-unknown0'])

    // mock DB 查询：返回 404 / null / 空数组
    // （注入 mock，返回 null 或抛出 NotFound）

    // 执行
    // await runWorktreeReaper()

    // 断言：fs.rm 未被调用（fail-open）
    // expect(fs.rm).not.toHaveBeenCalled()

    // 断言日志含 status=unknown action=skipped
    // expect(consoleSpy).toHaveBeenCalledWith(
    //   expect.stringContaining('[worktree_reap] task=unknown0 status=unknown action=skipped')
    // )

    // TDD Red
    expect(true).toBe(false)
  })

  it('[BEHAVIOR-6-extra] pending 任务 worktree 也绝对不删', async () => {
    // 额外回归：pending 也属于活跃状态
    vi.mocked(fs.readdir).mockResolvedValueOnce(['task-pend1234'])

    // mock DB 查询：status=pending
    // await runWorktreeReaper()
    // expect(fs.rm).not.toHaveBeenCalled()

    expect(true).toBe(false) // TDD Red
  })

  it('[BEHAVIOR-5-boundary] 终态任务但 updated_at 仅 23h，不删', async () => {
    // 边界测试：completed 但时间不够 24h
    vi.mocked(fs.readdir).mockResolvedValueOnce(['task-recent1'])

    // mock DB 查询：status=completed，updated_at = 23h 前
    // await runWorktreeReaper()
    // expect(fs.rm).not.toHaveBeenCalled()

    expect(true).toBe(false) // TDD Red
  })
})
