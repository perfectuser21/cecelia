import { describe, it, expect, vi, beforeEach } from 'vitest'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  runDiskGuard,
  __resetDiskGuardForTest,
  DISK_GUARD_INTERVAL_MS
} from './disk-guard.js'

import { JOBS } from '../scheduler-jobs.js'

describe('disk-guard', () => {
  let callOrder

  beforeEach(() => {
    __resetDiskGuardForTest()
    vi.clearAllMocks()
    callOrder = []
  })

  it('[BEHAVIOR-1] df 87% 触发完整清理序列，序列按 INV-04 顺序（含kernel日志清理）', async () => {
    // INV-04 顺序：docker container prune → builder prune → worktree_reaper → npm/brew cache → kernel_log_cleanup

    const execMock = vi.fn().mockImplementation(async (cmd) => {
      if (cmd.includes('df ')) {
        const dfCalls = execMock.mock.calls.filter(c => c[0].includes('df ')).length
        if (dfCalls <= 1) {
          callOrder.push('df_initial')
          return { stdout: '87%\n', stderr: '' }
        } else {
          callOrder.push('df_retest')
          return { stdout: '70%\n', stderr: '' }
        }
      }
      if (cmd.includes('docker container prune')) {
        callOrder.push('docker_container_prune')
        return { stdout: '', stderr: '' }
      }
      if (cmd.includes('docker builder prune')) {
        callOrder.push('docker_builder_prune')
        return { stdout: '', stderr: '' }
      }
      if (cmd.includes('npm cache')) {
        callOrder.push('npm_cache')
        return { stdout: '', stderr: '' }
      }
      return { stdout: '', stderr: '' }
    })

    const worktreeReaperMock = vi.fn(async () => {
      callOrder.push('worktree_reaper')
      return { results: [] }
    })
    const cleanOldKernelLogsMock = vi.fn(async () => {
      callOrder.push('kernel_log_cleanup')
      return { scanned: 0, removed: 0 }
    })
    const raiseMock = vi.fn().mockResolvedValue(undefined)
    const barkMock = vi.fn().mockResolvedValue(undefined)

    const result = await runDiskGuard({
      execAsync: execMock,
      raise: raiseMock,
      sendBark: barkMock,
      runWorktreeReaper: worktreeReaperMock,
      cleanOldKernelLogs: cleanOldKernelLogsMock,
    })

    // [BEHAVIOR-1]: df 87% → action=clean (retest=70% → no bark)
    expect(result.used).toBe(87)
    expect(result.action).toBe('clean')

    // INV-04: 固定顺序断言（kernel_log_cleanup 追加在末尾，df_retest 之前）
    expect(callOrder).toEqual(['df_initial', 'docker_container_prune', 'docker_builder_prune', 'worktree_reaper', 'npm_cache', 'kernel_log_cleanup', 'df_retest'])

    // worktree reaper 与 kernel log cleanup 均被调用
    expect(worktreeReaperMock).toHaveBeenCalledOnce()
    expect(cleanOldKernelLogsMock).toHaveBeenCalledOnce()
    // kernel log cleanup 传入的目录路径精确等于按同款 4 级 ../../../.. 算出的 repo root/logs/kernel
    // （用跟生产代码同款方式独立计算预期值，而非模糊后缀正则——正则匹配不出层级数算错，见 review 复测）
    const expectedKernelLogDir = join(fileURLToPath(new URL('../../../..', import.meta.url)), 'logs', 'kernel')
    expect(cleanOldKernelLogsMock).toHaveBeenCalledWith(expectedKernelLogDir)
    // raise 被调用（清理后通知）
    expect(raiseMock).toHaveBeenCalled()
  })

  it('[BEHAVIOR-2] df 75% 不触发清理，打 action=none 日志', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const execMock = vi.fn().mockResolvedValueOnce({ stdout: '75%\n', stderr: '' })
    const raiseMock = vi.fn().mockResolvedValue(undefined)
    const barkMock = vi.fn().mockResolvedValue(undefined)

    const result = await runDiskGuard({
      execAsync: execMock,
      raise: raiseMock,
      sendBark: barkMock,
    })

    expect(result.used).toBe(75)
    expect(result.action).toBe('none')

    // 断言：无清理命令被调用（只有 df 这一次）
    expect(execMock).toHaveBeenCalledOnce()
    // 飞书/Bark 未被调用
    expect(raiseMock).not.toHaveBeenCalled()
    expect(barkMock).not.toHaveBeenCalled()

    // INV-03: [disk_check] 日志必出，含 action=none
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('[disk_check]'))
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('action=none'))

    consoleSpy.mockRestore()
  })

  it('[BEHAVIOR-3] df 82% 仅发飞书告警，不触发清理序列', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const execMock = vi.fn().mockResolvedValueOnce({ stdout: '82%\n', stderr: '' })
    const raiseMock = vi.fn().mockResolvedValue(undefined)
    const barkMock = vi.fn().mockResolvedValue(undefined)

    const result = await runDiskGuard({
      execAsync: execMock,
      raise: raiseMock,
      sendBark: barkMock,
    })

    expect(result.used).toBe(82)
    expect(result.action).toBe('warn')

    // 飞书告警被调用（raise），Bark 未调用
    expect(raiseMock).toHaveBeenCalledOnce()
    expect(barkMock).not.toHaveBeenCalled()

    // docker prune 未被调用（只有 df 一次）
    expect(execMock).toHaveBeenCalledOnce()
    expect(execMock).not.toHaveBeenCalledWith(expect.stringContaining('docker container prune'))
    expect(execMock).not.toHaveBeenCalledWith(expect.stringContaining('docker builder prune'))

    // 日志含 [disk_check] used=82% action=warn
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('[disk_check]'))
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('used=82%'))
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('action=warn'))

    consoleSpy.mockRestore()
  })

  it('[BEHAVIOR-4] 清后复测仍 ≥90% 发 Bark 推送', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const execMock = vi.fn().mockImplementation(async (cmd) => {
      if (cmd.includes('df ')) {
        const dfCalls = execMock.mock.calls.filter(c => c[0].includes('df ')).length
        if (dfCalls <= 1) return { stdout: '91%\n', stderr: '' } // 首次
        return { stdout: '90%\n', stderr: '' } // 复测仍 ≥90%
      }
      return { stdout: '', stderr: '' }
    })
    const raiseMock = vi.fn().mockResolvedValue(undefined)
    const barkMock = vi.fn().mockResolvedValue(undefined)
    const reaperMock = vi.fn().mockResolvedValue({ results: [] })

    const result = await runDiskGuard({
      execAsync: execMock,
      raise: raiseMock,
      sendBark: barkMock,
      runWorktreeReaper: reaperMock,
    })

    // 清后 ≥90% → action=bark
    expect(result.action).toBe('bark')

    // Bark 推送被调用
    expect(barkMock).toHaveBeenCalledOnce()
    expect(barkMock.mock.calls[0][0]).toContain('磁盘告急')

    // 日志含 action=bark
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('action=bark'))

    consoleSpy.mockRestore()
  })

  it('[BEHAVIOR-8] scheduler-jobs JOBS 含 disk-guard，参数规格正确', async () => {
    const diskGuardJob = JOBS.find(j => j.name === 'disk-guard')
    expect(diskGuardJob).toBeDefined()
    expect(diskGuardJob.timeoutMs).toBe(120_000)
    expect(diskGuardJob.needsPool).toBe(false)
    expect(typeof diskGuardJob.handler).toBe('function')
  })

  it('[BEHAVIOR-9] df 命令失败时 catch 并打 error 日志，不静默吞掉', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const execMock = vi.fn().mockRejectedValue(new Error('ssh: connect to host failed'))

    // runDiskGuard 不应该抛出
    const result = await runDiskGuard({ execAsync: execMock })
    expect(result).toHaveProperty('error')

    // 日志含 [disk_check] ... error=...
    const callArgs = consoleSpy.mock.calls.map(c => c[0])
    const errorLog = callArgs.find(s => s && s.includes('[disk_check]') && s.includes('error='))
    expect(errorLog).toBeDefined()

    consoleSpy.mockRestore()
  })

  it('[BEHAVIOR-10] 15min 内重复调用节流 gate，df 只执行一次', async () => {
    expect(DISK_GUARD_INTERVAL_MS).toBe(15 * 60 * 1000)

    const execMock = vi.fn().mockResolvedValue({ stdout: '75%\n', stderr: '' })

    // 第一次调用正常执行
    await runDiskGuard({ execAsync: execMock })
    // 立即第二次调用（lastRunAt 刚更新，< INTERVAL_MS）
    const result2 = await runDiskGuard({ execAsync: execMock })

    // df 命令只被执行 1 次
    expect(execMock).toHaveBeenCalledOnce()
    // 第二次返回 throttled
    expect(result2).toEqual({ skipped: true, reason: 'throttled' })
  })
})
