/**
 * worktree-reaper.js — 终态任务 worktree 收割（任务 ba6fe51c）
 * fail-open: 归属不明或活跃任务绝不删除（INV-01）
 */
import { readdir, rm } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import pool from '../db.js'

const WORKTREE_BASE = process.env.HARNESS_WORKTREE_BASE ||
  '/Users/administrator/perfect21/cecelia/.claude/worktrees/harness-v2'
const TERMINAL_STATUSES = ['completed', 'failed', 'archived']
const GRACE_MS = 24 * 60 * 60 * 1000 // 24h

export async function runWorktreeReaper(deps = {}) {
  const _readdir = deps.readdir || readdir
  const _rm = deps.rm || rm
  const _db = deps.db || pool
  const _existsSync = deps.existsSync || existsSync
  const base = deps.base || WORKTREE_BASE

  if (!_existsSync(base)) return { skipped: true, reason: 'base_not_found' }

  let entries
  try {
    entries = await _readdir(base, { withFileTypes: true })
  } catch (e) {
    console.warn('[worktree_reap] readdir failed:', e.message)
    return { error: e.message }
  }

  const results = []
  for (const entry of entries) {
    // support both Dirent objects and plain string entries
    const name = typeof entry === 'string' ? entry : entry.name
    const isDir = typeof entry === 'string' ? true : entry.isDirectory()
    if (!isDir || !name.startsWith('task-')) continue
    const shortId = name.replace(/^task-/, '')
    const wtPath = join(base, name)

    let status = 'unknown'
    let action = 'skipped'
    try {
      // 查 DB：模糊匹配 short id（前8位）
      const { rows } = await _db.query(
        `SELECT status, updated_at FROM tasks WHERE id::text LIKE $1 LIMIT 1`,
        [`${shortId}%`]
      )
      if (rows.length > 0) {
        status = rows[0].status
        const ageMs = Date.now() - new Date(rows[0].updated_at).getTime()
        if (TERMINAL_STATUSES.includes(status) && ageMs > GRACE_MS) {
          // INV-01: 只删终态超24h的
          await _rm(wtPath, { recursive: true, force: true })
          action = 'deleted'
        } else {
          // in_progress / pending / queued 或未到24h → 绝对跳过
          action = 'skipped'
        }
      }
      // 查不到记录 → fail-open，status=unknown，action=skipped
    } catch (e) {
      status = 'error'
      action = 'skipped'
      console.warn(`[worktree_reap] task=${shortId} error:`, e.message)
    }

    console.log(`[worktree_reap] task=${shortId} status=${status} action=${action}`)
    results.push({ task: shortId, status, action })
  }

  return { results }
}
