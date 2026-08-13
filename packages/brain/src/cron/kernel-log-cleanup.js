import { readdirSync, statSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'

export const KERNEL_LOG_TTL_MS = parseInt(
  process.env.CECELIA_KERNEL_LOG_TTL_MS || String(7 * 24 * 60 * 60 * 1000), 10
)

export function cleanOldKernelLogs(logDir, ttlMs = KERNEL_LOG_TTL_MS, nowMs = Date.now()) {
  let entries
  try {
    entries = readdirSync(logDir)
  } catch {
    return { scanned: 0, removed: 0 }
  }

  let removed = 0
  for (const name of entries) {
    const filePath = join(logDir, name)
    let stat
    try {
      stat = statSync(filePath)
    } catch {
      continue
    }
    if (!stat.isFile()) continue
    if (nowMs - stat.mtimeMs > ttlMs) {
      try {
        unlinkSync(filePath)
        removed += 1
      } catch {
        // best-effort，跟 disk-guard 现有清理动作一致，单个文件删不掉不阻断整体清理
      }
    }
  }
  return { scanned: entries.length, removed }
}
