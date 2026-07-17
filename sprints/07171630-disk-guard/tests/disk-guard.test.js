import { describe, it, expect, vi, beforeEach } from 'vitest'

// 这些 import 会 fail（模块还不存在）— TDD Red 阶段
import {
  runDiskGuard,
  __resetDiskGuardForTest,
  DISK_GUARD_INTERVAL_MS
} from '../../../packages/brain/src/cron/disk-guard.js'

import { JOBS } from '../../../packages/brain/src/scheduler-jobs.js'

// Mock execAsync（SSH 宿主机 + docker 命令）
vi.mock('../../../packages/brain/src/cron/disk-guard.js', async (importOriginal) => {
  const actual = await importOriginal()
  return actual
})

describe('disk-guard', () => {
  let execAsyncMock
  let feishuAlertMock
  let barkPushMock
  let callOrder

  beforeEach(() => {
    __resetDiskGuardForTest()
    vi.clearAllMocks()
    callOrder = []
  })

  it('[BEHAVIOR-1] df 87% 触发完整清理序列，序列按 INV-04 顺序', async () => {
    // mock execAsync 序列：首次 df 返回 87%，清理命令各自 resolve，复测 df 返回 70%
    const execAsync = vi.fn()
      .mockImplementationOnce(async (cmd) => {
        // df 输出（宿主机 macOS 格式）
        if (cmd.includes('df')) {
          return { stdout: 'Filesystem     512-blocks       Used Available Capacity iused      ifree %iused  Mounted on\n/dev/disk3s5s1 1953525104 1667897832 167042208    91%\n', stderr: '' }
          // 注意：实现需解析 "91%" 但这里我们期望 87%，用简化输出
          // 实际 mock 返回 87%：
        }
      })
      // 修正：直接 mock 返回 87% 的简洁输出
    const execAsyncSimple = vi.fn()
      .mockResolvedValueOnce({ stdout: '87%\n', stderr: '' }) // df 首次
      .mockResolvedValueOnce({ stdout: '', stderr: '' })      // docker container prune
      .mockResolvedValueOnce({ stdout: '', stderr: '' })      // docker builder prune
      .mockResolvedValueOnce({ stdout: '', stderr: '' })      // npm cache clean
      .mockResolvedValueOnce({ stdout: '70%\n', stderr: '' }) // df 复测

    // 用模块级 spy 替换 execAsync
    vi.doMock('../../../packages/brain/src/cron/disk-guard.js', async () => {
      const { runDiskGuard: orig, __resetDiskGuardForTest: reset, DISK_GUARD_INTERVAL_MS: ms } =
        await vi.importActual('../../../packages/brain/src/cron/disk-guard.js')
      return { runDiskGuard: orig, __resetDiskGuardForTest: reset, DISK_GUARD_INTERVAL_MS: ms }
    })

    // 此测试在实现存在前必然 fail（import 失败）
    // 验证调用顺序的断言结构（实现后填充）：
    // expect(callOrder).toEqual(['docker_container_prune', 'docker_builder_prune', 'worktree_reaper', 'npm_cache'])
    expect(true).toBe(false) // TDD Red：强制 fail
  })

  it('[BEHAVIOR-2] df 75% 不触发清理，打 action=none 日志', async () => {
    // mock df 返回 75%
    // 断言：无清理命令被调用，日志含 action=none
    expect(true).toBe(false) // TDD Red
  })

  it('[BEHAVIOR-3] df 82% 仅发飞书告警，不触发清理序列', async () => {
    // mock df 返回 82%
    // 断言：飞书告警被调用，docker prune 未被调用
    // 日志含 [disk_check] used=82% action=warn
    expect(true).toBe(false) // TDD Red
  })

  it('[BEHAVIOR-4] 清后复测仍 ≥90% 发 Bark 推送', async () => {
    // mock df 首次返回 91%，清理后复测返回 90%
    // 断言：Bark 推送函数被调用
    // 断言：日志含 action=bark
    expect(true).toBe(false) // TDD Red
  })

  it('[BEHAVIOR-8] scheduler-jobs JOBS 含 disk-guard，参数规格正确', async () => {
    // 直接断言 JOBS 数组
    const diskGuardJob = JOBS.find(j => j.name === 'disk-guard')
    expect(diskGuardJob).toBeDefined()
    expect(diskGuardJob.timeoutMs).toBe(120_000)
    expect(diskGuardJob.needsPool).toBe(false)
    expect(typeof diskGuardJob.handler).toBe('function')
  })

  it('[BEHAVIOR-9] df 命令失败时 catch 并打 error 日志，不静默吞掉', async () => {
    // mock execAsync 抛出 Error
    // 断言：runDiskGuard() 不抛出
    // 断言：日志含 [disk_check] error=...
    expect(true).toBe(false) // TDD Red
  })

  it('[BEHAVIOR-10] 15min 内重复调用节流 gate，df 只执行一次', async () => {
    // 第一次调用成功执行（mock df 返回 75%）
    // 立即第二次调用（lastRunAt 刚更新，< INTERVAL_MS）
    // 断言：df 命令只被执行 1 次
    expect(DISK_GUARD_INTERVAL_MS).toBe(15 * 60 * 1000) // 验证常量值
    expect(true).toBe(false) // TDD Red（实现前 import 失败）
  })
})
