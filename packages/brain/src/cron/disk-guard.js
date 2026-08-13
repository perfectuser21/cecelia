/**
 * disk-guard.js — 磁盘哨兵（任务 ba6fe51c）
 * 每 15min 检测 /System/Volumes/Data 使用率，三级响应，每轮必出 [disk_check] 日志
 */
import { exec } from 'child_process'
import { promisify } from 'util'
import { existsSync } from 'fs'
import { homedir } from 'os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { raise } from '../alerting.js'
import { sendBark } from '../notifier.js'
import { cleanOldKernelLogs as cleanOldKernelLogsDefault } from './kernel-log-cleanup.js'

const execAsync = promisify(exec)

export const DISK_GUARD_INTERVAL_MS = parseInt(
  process.env.DISK_GUARD_INTERVAL_MS || String(15 * 60 * 1000), 10
)

let lastRunAt = 0
export function __resetDiskGuardForTest() { lastRunAt = 0 }

function discoverSshKey(keyExistsFn = existsSync) {
  const dir = `${homedir()}/.ssh`
  for (const name of ['id_ed25519', 'id_rsa']) {
    const candidate = `${dir}/${name}`
    if (keyExistsFn(candidate)) return candidate
  }
  return `${dir}/id_ed25519`
}

function buildHostCmd(cmd, inContainer, keyExistsFn) {
  if (!inContainer) return cmd
  const target = process.env.CECELIA_HOST_EXEC_SSH || 'administrator@host.docker.internal'
  const key = discoverSshKey(keyExistsFn)
  const quoted = `'${cmd.replace(/'/g, `'\\''`)}'`
  return `ssh -i ${key} -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o BatchMode=yes -o ConnectTimeout=10 ${target} ${quoted}`
}

// 解析 df 输出，支持 macOS 和 Linux 格式
function parseDfPercent(stdout) {
  const match = stdout.match(/(\d+)%/)
  if (!match) throw new Error(`df 输出无法解析: ${stdout.slice(0, 100)}`)
  return parseInt(match[1], 10)
}

export async function runDiskGuard(deps = {}) {
  const now = Date.now()
  if (now - lastRunAt < DISK_GUARD_INTERVAL_MS) return { skipped: true, reason: 'throttled' }
  lastRunAt = now

  const _exec = deps.execAsync || execAsync
  const _raise = deps.raise || raise
  const _sendBark = deps.sendBark || sendBark
  const _runWorktreeReaper = deps.runWorktreeReaper || null
  const _cleanOldKernelLogs = deps.cleanOldKernelLogs || cleanOldKernelLogsDefault

  let used = -1
  let action = 'none'

  try {
    const inContainer = !!process.env.CECELIA_IN_CONTAINER || existsSync('/.dockerenv')
    const dfCmd = 'df /System/Volumes/Data'
    const hostCmd = buildHostCmd(dfCmd, inContainer)
    const { stdout } = await _exec(hostCmd)
    used = parseDfPercent(stdout)

    if (used >= 85) {
      action = 'clean'
      // INV-04: 固定顺序
      await _exec(buildHostCmd('docker container prune -f --filter until=24h', inContainer)).catch(e => console.warn('[disk_check] docker container prune failed:', e.message))
      await _exec(buildHostCmd('docker builder prune -f', inContainer)).catch(e => console.warn('[disk_check] docker builder prune failed:', e.message))
      if (_runWorktreeReaper) {
        await _runWorktreeReaper().catch(e => console.warn('[disk_check] worktree reaper failed:', e.message))
      } else {
        // 动态 import 避免循环依赖
        const { runWorktreeReaper } = await import('./worktree-reaper.js')
        await runWorktreeReaper().catch(e => console.warn('[disk_check] worktree reaper failed:', e.message))
      }
      await _exec(buildHostCmd('npm cache clean --force 2>/dev/null; brew cleanup 2>/dev/null; true', inContainer)).catch(e => console.warn('[disk_check] npm/brew cache clean failed:', e.message))

      const kernelLogDir = join(process.env.REPO_ROOT || fileURLToPath(new URL('../../../..', import.meta.url)), 'logs', 'kernel')
      try {
        await _cleanOldKernelLogs(kernelLogDir)
      } catch (e) {
        console.warn('[disk_check] kernel log cleanup failed:', e.message)
      }

      // 复测
      const { stdout: stdout2 } = await _exec(hostCmd)
      const usedAfter = parseDfPercent(stdout2)
      if (usedAfter >= 90) {
        action = 'bark'
        await _sendBark(`磁盘告急 ${usedAfter}%，清理后仍高，需人工干预`, { title: '磁盘哨兵 P1' }).catch(e => console.warn('[disk_check] Bark failed:', e.message))
      }
      await _raise('P2', 'disk_guard_cleaned', `磁盘已清理，当前 ${usedAfter ?? used}%`).catch(() => {})
    } else if (used >= 80) {
      action = 'warn'
      await _raise('P2', 'disk_guard_warn', `磁盘警戒 ${used}%，接近清理阈值`).catch(() => {})
    }
  } catch (e) {
    console.log(`[disk_check] used=${used >= 0 ? used + '%' : 'unknown'} action=error error=${e.message}`)
    return { error: e.message }
  }

  // INV-03: 每轮必出
  console.log(`[disk_check] used=${used}% action=${action}`)
  return { used, action }
}
