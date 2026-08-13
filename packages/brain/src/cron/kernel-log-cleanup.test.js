import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, utimesSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { cleanOldKernelLogs, KERNEL_LOG_TTL_MS } from './kernel-log-cleanup.js'

describe('cleanOldKernelLogs', () => {
  let dir

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'kernel-log-cleanup-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('[BEHAVIOR-1] 超过 TTL 的日志文件被删除，未超的保留', () => {
    const oldFile = join(dir, 'kernel-old.log')
    const freshFile = join(dir, 'kernel-fresh.log')
    writeFileSync(oldFile, 'old')
    writeFileSync(freshFile, 'fresh')

    const now = Date.now()
    const ttlMs = 7 * 24 * 60 * 60 * 1000
    const oldMtime = new Date(now - ttlMs - 60_000)
    const freshMtime = new Date(now - 60_000)
    utimesSync(oldFile, oldMtime, oldMtime)
    utimesSync(freshFile, freshMtime, freshMtime)

    const result = cleanOldKernelLogs(dir, ttlMs, now)

    expect(existsSync(oldFile)).toBe(false)
    expect(existsSync(freshFile)).toBe(true)
    expect(result).toEqual({ scanned: 2, removed: 1 })
  })

  it('[BEHAVIOR-2] 目录不存在时静默返回 {scanned:0,removed:0}，不抛异常', () => {
    const result = cleanOldKernelLogs(join(dir, 'does-not-exist'))
    expect(result).toEqual({ scanned: 0, removed: 0 })
  })

  it('[BEHAVIOR-3] 默认 TTL 是 7 天', () => {
    expect(KERNEL_LOG_TTL_MS).toBe(7 * 24 * 60 * 60 * 1000)
  })
})
