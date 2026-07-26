/**
 * preview-destroyer.js — 统一销毁器
 *
 * destroyPreview() 是本仓库三处销毁入口（POST /stop 路由、scripts/preview-cleanup.sh、
 * Final E2E 现存资源批量清扫）唯一应调用的实现，7 步流程 + per-PR advisory lock 去重 +
 * 幂等 + DB 名正则校验 + realpath 逃逸防护 + 终态复查。
 *
 * 7 步：状态置 cleaning → 杀进程/端口/PID 文件 → pg_terminate_backend 后 DROP DATABASE
 *      → git worktree remove（fallback rm -rf 前必须 realpath 校验）→ 清临时文件
 *      → 终态复查（库/目录/进程/临时文件四项全零）→ 置 inactive（或 cleanup_failed）
 *
 * 禁 mock 边（合同）：本文件 ↔ 真实 Postgres（DROP DATABASE/pg_terminate_backend/status 状态机/
 * per-PR advisory lock）、本文件 ↔ 文件系统 + git worktree（真实创建/删除，不 mock child_process/fs）。
 */

import { execFileSync } from 'child_process';
import { existsSync, lstatSync, readFileSync, realpathSync, rmSync } from 'fs';
import { join } from 'path';
import pool from './db.js';

const DB_NAME_RE = /^cecelia_preview_[0-9]+$/;
const ADVISORY_LOCK_NAMESPACE = 'preview_destroy';

function defaultPreviewBaseDir() {
  return process.env.PREVIEW_BASE_DIR || '/Users/administrator/worktrees/cecelia-previews';
}

function defaultRepoRoot() {
  return process.env.REPO_ROOT || '/Users/administrator/perfect21/cecelia';
}

function pathExists(p) {
  // existsSync 对悬挂符号链接返回 false；lstatSync 能探测到"路径本身存在（即使是断链 symlink）"
  try {
    lstatSync(p);
    return true;
  } catch {
    return false;
  }
}

function isProcessAlive(pid) {
  if (!Number.isInteger(pid)) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function dbExists(client, dbName) {
  const { rows } = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
  return rows.length > 0;
}

/**
 * @param {number} prNumber
 * @param {string} reason - 触发来源（webhook/reaper/final-e2e-sweep 等，写日志用）
 * @param {string} executionId - 调用方执行标识（写日志用，便于追溯并发调用）
 * @param {import('pg').Pool} dbPool
 * @param {{previewBaseDir?: string, repoRoot?: string}} [opts]
 * @returns {Promise<{destroyed:true,status:'inactive',idempotent?:true}|{destroyed:false,status:'cleanup_failed',cleanup_detail:object}>}
 */
export async function destroyPreview(prNumber, reason, executionId, dbPool = pool, opts = {}) {
  const previewBaseDir = opts.previewBaseDir || defaultPreviewBaseDir();
  const repoRoot = opts.repoRoot || defaultRepoRoot();

  const client = await dbPool.connect();
  let lockHeld = false;
  try {
    // per-PR session 级 advisory lock（非 xact 级——DROP DATABASE 不能跑在显式事务块内，
    // 必须能在持锁期间穿插自动提交的独立语句）。webhook + reaper 并发触发同一 PR 时，
    // 后到者阻塞等待直到前者 pg_advisory_unlock，保证同一 PR 只实际执行一次销毁。
    await client.query('SELECT pg_advisory_lock(hashtext($1), $2)', [ADVISORY_LOCK_NAMESPACE, prNumber]);
    lockHeld = true;

    // ORDER BY created_at DESC LIMIT 1：同一 pr_number 可能跨生命周期累积多行
    // （每次 admitPreview 全新准入都是 INSERT 新行，不复用旧 inactive 行），
    // 必须取最新一行操作，否则可能误判已 inactive 的历史行导致漏销毁当前活跃行
    // （同 preview-manager.js 的 getPreview() 惯例）。
    const { rows } = await client.query(
      'SELECT * FROM preview_environments WHERE pr_number = $1 ORDER BY created_at DESC LIMIT 1',
      [prNumber],
    );
    const row = rows[0];

    // 幂等短路：不存在记录或已 inactive（含并发去重：先到者已跑完把状态置 inactive）
    if (!row || row.status === 'inactive') {
      return { destroyed: true, status: 'inactive', idempotent: true };
    }

    await client.query(
      `UPDATE preview_environments SET status = 'cleaning', updated_at = NOW() WHERE id = $1`,
      [row.id],
    );

    const dbName = row.db_name;
    const workDir = join(previewBaseDir, `preview-${prNumber}`);
    const pidFile = `/tmp/preview-${prNumber}.pid`;
    const branchFile = `/tmp/preview-${prNumber}.branch`;
    const logFile = `/tmp/preview-${prNumber}.log`;

    const residual = [];
    let dbDropped = false;
    let worktreeRemoved = false;
    let processesKilled = false;
    let tempFilesCleared = false;
    let killedPid = null;

    // ── Step: 杀进程 + 清 PID 文件 ─────────────────────────────────────────
    try {
      if (existsSync(pidFile)) {
        const pidRaw = readFileSync(pidFile, 'utf8').trim();
        const pid = parseInt(pidRaw, 10);
        if (Number.isInteger(pid)) {
          killedPid = pid;
          try { process.kill(pid, 'SIGTERM'); } catch { /* 进程可能已不存在 */ }
          if (isProcessAlive(pid)) {
            try { process.kill(pid, 'SIGKILL'); } catch { /* best-effort */ }
          }
        }
        rmSync(pidFile, { force: true });
      }
      processesKilled = true;
    } catch (err) {
      residual.push(`process_kill_failed:${err.message}`);
    }

    // ── Step: DB 名正则校验 + pg_terminate_backend + DROP DATABASE ────────
    if (!DB_NAME_RE.test(dbName)) {
      residual.push('invalid_db_name');
    } else {
      try {
        await client.query(
          `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
          [dbName],
        );
        await client.query(`DROP DATABASE IF EXISTS "${dbName}"`);
        dbDropped = true;
      } catch (err) {
        residual.push(`dropdb_failed:${err.message}`);
      }
    }

    // ── Step: git worktree remove（fallback rm -rf 前必须 realpath 校验）──
    if (pathExists(workDir)) {
      let removedViaGit = false;
      try {
        execFileSync('git', ['-C', repoRoot, 'worktree', 'remove', '--force', workDir], { stdio: 'pipe' });
        removedViaGit = true;
      } catch {
        // 不是已注册 worktree（如符号链接伪装）——fallback rm -rf，但必须先 realpath 校验
        // 未逃逸 previewBaseDir，否则 abort 不删（防越权删除）
      }
      if (removedViaGit) {
        worktreeRemoved = true;
      } else {
        try {
          const realBase = realpathSync(previewBaseDir);
          let realTarget = null;
          try { realTarget = realpathSync(workDir); } catch { /* 断链 symlink 走 else 分支 */ }
          const withinBase = realTarget && (realTarget === realBase || realTarget.startsWith(realBase + '/'));
          if (withinBase) {
            rmSync(workDir, { recursive: true, force: true });
            worktreeRemoved = true;
          } else {
            residual.push('path_escape_detected');
          }
        } catch (err) {
          residual.push(`worktree_remove_failed:${err.message}`);
        }
      }
    } else {
      worktreeRemoved = true; // 无残留目录，视为已达成
    }

    // ── Step: 清临时文件（branch/log；pid 文件已在上面清）────────────────
    try {
      for (const f of [branchFile, logFile]) {
        if (existsSync(f)) rmSync(f, { force: true });
      }
      tempFilesCleared = true;
    } catch (err) {
      residual.push(`temp_cleanup_failed:${err.message}`);
    }

    // ── 终态复查（真实探测，不能"标了 inactive 就当真删了"）─────────────
    if (await dbExists(client, dbName)) residual.push('db_still_exists');
    if (pathExists(workDir)) residual.push('worktree_still_exists');
    if (killedPid && isProcessAlive(killedPid)) residual.push('process_still_alive');
    if (existsSync(pidFile) || existsSync(branchFile) || existsSync(logFile)) residual.push('temp_files_still_exist');

    if (residual.length > 0) {
      const cleanupDetail = {
        db_dropped: dbDropped,
        worktree_removed: worktreeRemoved,
        processes_killed: processesKilled,
        temp_files_cleared: tempFilesCleared,
        residual,
      };
      await client.query(
        `UPDATE preview_environments SET status = 'cleanup_failed', updated_at = NOW(), cleanup_detail = $2 WHERE id = $1`,
        [row.id, JSON.stringify(cleanupDetail)],
      );
      return { destroyed: false, status: 'cleanup_failed', cleanup_detail: cleanupDetail };
    }

    await client.query(
      `UPDATE preview_environments SET status = 'inactive', updated_at = NOW(), cleanup_detail = NULL WHERE id = $1`,
      [row.id],
    );
    return { destroyed: true, status: 'inactive' };
  } finally {
    if (lockHeld) {
      try {
        await client.query('SELECT pg_advisory_unlock(hashtext($1), $2)', [ADVISORY_LOCK_NAMESPACE, prNumber]);
      } catch { /* connection may already be broken, best-effort */ }
    }
    client.release();
  }
}
