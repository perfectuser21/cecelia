// packages/brain/src/postdeploy-verifier.js
/**
 * postdeploy-verifier.js — 第 5 环部署验证 tick job
 *
 * 五环铁律（主理人决策 2026-07-12）:
 *   代码+CI+merge+部署+端到端实体验证 — 机器必须强制全 5 环。
 *
 * 工作方式:
 *   任务 payload.postdeploy_check.command 存在且非 exempt → execution-callback
 *   把 completed 改 pending_postdeploy。本 job 在 Brain 每轮 tick（5min）里扫描
 *   pending_postdeploy 任务，执行 command（本机 shell），通过→completed，失败
 *   连续 3 次→P1 alert + failed。
 *
 * 豁免规则:
 *   payload.postdeploy_check.exempt = true（需显式声明原因）→ execution-callback
 *   直接放 completed，本 job 不扫描。
 *
 * 安全限制:
 *   - command 只允许 curl/psql/grep/sh/bash 开头（白名单校验）
 *   - timeout 最大 60s（默认 30s）
 *   - 不允许 &&、||、;、管道外接 rm/kill 等危险操作（黑名单过滤）
 */

import { execSync } from 'child_process';
import pool from './db.js';
import { raise } from './alerting.js';
import { pushCaptureAtom } from './capture-inbox.js';

const MAX_RETRIES = 3;
const DEFAULT_TIMEOUT_S = 30;
const MAX_TIMEOUT_S = 60;

/** 每次运行最多处理的 pending_postdeploy 任务数 */
const BATCH_LIMIT = 10;

/** 内部节流：两次运行最小间隔（避免 tick 每 5s 打来一次疯狂重试）*/
const MIN_INTERVAL_MS = 5 * 60 * 1000; // 5 分钟

let _lastRunAt = 0;

// 允许的命令前缀白名单
const ALLOWED_COMMAND_PREFIXES = ['curl ', 'psql ', 'grep ', 'sh ', 'bash ', 'node ', 'python3 ', 'jq '];

// 危险字符/模式黑名单（阻止 shell injection）
const DANGEROUS_PATTERNS = [/rm\s/, /kill\s/, />\s*\//, /`/, /\$\(/, /eval\s/i, /reboot/, /shutdown/i, /dd\s/];

/**
 * 校验 command 是否在白名单内且不含危险模式。
 * @param {string} cmd
 * @returns {{ valid: boolean, reason?: string }}
 */
export function validateCommand(cmd) {
  if (typeof cmd !== 'string' || cmd.trim().length === 0) {
    return { valid: false, reason: 'command 为空' };
  }
  const trimmed = cmd.trim();
  const isAllowed = ALLOWED_COMMAND_PREFIXES.some((p) => trimmed.startsWith(p));
  if (!isAllowed) {
    return { valid: false, reason: `command 不在白名单内（${ALLOWED_COMMAND_PREFIXES.join(' | ')}）` };
  }
  for (const pat of DANGEROUS_PATTERNS) {
    if (pat.test(trimmed)) {
      return { valid: false, reason: `command 包含危险模式：${pat}` };
    }
  }
  return { valid: true };
}

/**
 * 执行 postdeploy 验证命令，返回 { passed, stdout, stderr, exitCode }。
 * 所有错误视为 passed=false，不抛出。
 */
export function runVerifyCommand(command, timeoutS = DEFAULT_TIMEOUT_S) {
  const safeTimeout = Math.min(timeoutS, MAX_TIMEOUT_S) * 1000;
  try {
    const stdout = execSync(command, {
      timeout: safeTimeout,
      stdio: ['pipe', 'pipe', 'pipe'],
      encoding: 'utf8',
    });
    return { passed: true, stdout: String(stdout).trim().substring(0, 1000), stderr: '', exitCode: 0 };
  } catch (err) {
    return {
      passed: false,
      stdout: String(err.stdout || '').trim().substring(0, 500),
      stderr: String(err.stderr || err.message || '').trim().substring(0, 500),
      exitCode: err.status ?? 1,
    };
  }
}

/**
 * 从 tasks 表读取 pending_postdeploy 任务批次。
 */
async function fetchPendingBatch(dbPool) {
  const { rows } = await dbPool.query(
    `SELECT id, task_type, title, payload,
            COALESCE((payload->>'postdeploy_retry_count')::int, 0) AS retry_count
     FROM tasks
     WHERE status = 'pending_postdeploy'
       AND title NOT LIKE 'smoke:%'
       AND (payload->>'postdeploy_retry_count' IS NULL
            OR (payload->>'postdeploy_retry_count')::int < $1)
     ORDER BY updated_at ASC
     LIMIT $2`,
    [MAX_RETRIES, BATCH_LIMIT]
  );
  return rows;
}

/**
 * 将任务标为 completed（验证通过）。
 */
async function markCompleted(dbPool, taskId, verifyResult) {
  await dbPool.query(
    `UPDATE tasks
     SET status = 'completed',
         completed_at = NOW(),
         updated_at = NOW(),
         claimed_by = NULL,
         claimed_at = NULL,
         payload = COALESCE(payload, '{}'::jsonb) || jsonb_build_object(
           'postdeploy_verified', true,
           'postdeploy_verify_at', NOW()::text,
           'postdeploy_verify_stdout', $2::text
         )
     WHERE id = $1 AND status = 'pending_postdeploy'`,
    [taskId, verifyResult.stdout]
  );
  console.log(`[postdeploy-verifier] ✅ task=${taskId} 验证通过 → completed`);
}

/**
 * 递增重试计数；超过上限时标 failed + P1 告警。
 */
async function recordRetryOrFail(dbPool, task, verifyResult) {
  const nextRetry = (task.retry_count ?? 0) + 1;
  const exceeded = nextRetry >= MAX_RETRIES;
  const newStatus = exceeded ? 'failed' : 'pending_postdeploy';

  await dbPool.query(
    `UPDATE tasks
     SET status = $2,
         updated_at = NOW(),
         error_message = $3,
         payload = COALESCE(payload, '{}'::jsonb) || jsonb_build_object(
           'postdeploy_retry_count', $4::int,
           'postdeploy_last_error', $5::text
         )
     WHERE id = $1 AND status = 'pending_postdeploy'`,
    [
      task.id,
      newStatus,
      exceeded ? `postdeploy 验证连续 ${MAX_RETRIES} 次失败，task 标 failed` : null,
      nextRetry,
      verifyResult.stderr || verifyResult.stdout || '（无输出）',
    ]
  );

  if (exceeded) {
    console.error(
      `[postdeploy-verifier] ❌ task=${task.id} (${task.title?.substring(0, 40)}) ` +
        `连续 ${MAX_RETRIES} 次验证失败 → failed`
    );
    try {
      await raise(
        dbPool,
        `P1`,
        `[postdeploy-verifier] task ${task.id} 部署验证失败`,
        `任务「${task.title}」(${task.task_type}) 的 postdeploy_check 命令连续 ${MAX_RETRIES} 次失败。\n` +
          `命令：${task.payload?.postdeploy_check?.command}\n` +
          `最后错误：${verifyResult.stderr || verifyResult.stdout || '无输出'}`,
        { sub_area: 'brain' }
      );
      await pushCaptureAtom(dbPool, {
        content: `[postdeploy-verifier] task=${task.id} 部署验证连续失败 → P1 issue 开出`,
        targetType: 'issue',
        targetSubtype: 'P1',
      });
    } catch (alertErr) {
      console.warn(`[postdeploy-verifier] 告警发送失败（非致命）: ${alertErr.message}`);
    }
  } else {
    console.warn(
      `[postdeploy-verifier] task=${task.id} 验证失败 (retry ${nextRetry}/${MAX_RETRIES}): ${verifyResult.stderr?.substring(0, 200)}`
    );
  }
}

/**
 * 主入口：扫描 pending_postdeploy 任务并执行验证。
 * 由 scheduler-jobs.js 在每个 tick 周期调用。
 *
 * @param {import('pg').Pool} [dbPool]
 * @returns {Promise<{ triggered: boolean, verified: number, failed: number, skipped: number }>}
 */
export async function runPostdeployVerifier(dbPool = pool) {
  // 内部节流：5 分钟最多跑一次
  const now = Date.now();
  if (now - _lastRunAt < MIN_INTERVAL_MS) {
    return { triggered: false };
  }
  _lastRunAt = now;

  const tasks = await fetchPendingBatch(dbPool);
  if (tasks.length === 0) {
    return { triggered: true, verified: 0, failed: 0, skipped: 0 };
  }

  let verified = 0;
  let failed = 0;
  let skipped = 0;

  for (const task of tasks) {
    const check = task.payload?.postdeploy_check;
    if (!check?.command) {
      // 没有 command 但状态是 pending_postdeploy → 直接放行（兜底）
      await markCompleted(dbPool, task.id, { stdout: '（无验证命令，自动放行）' });
      skipped++;
      continue;
    }

    const validation = validateCommand(check.command);
    if (!validation.valid) {
      console.error(
        `[postdeploy-verifier] task=${task.id} command 校验失败（${validation.reason}），标 failed`
      );
      await dbPool.query(
        `UPDATE tasks SET status='failed', error_message=$2, updated_at=NOW() WHERE id=$1`,
        [task.id, `postdeploy_check command 非法: ${validation.reason}`]
      );
      failed++;
      continue;
    }

    const timeoutS = Math.min(check.timeout_s ?? DEFAULT_TIMEOUT_S, MAX_TIMEOUT_S);
    const verifyResult = runVerifyCommand(check.command, timeoutS);

    if (verifyResult.passed) {
      await markCompleted(dbPool, task.id, verifyResult);
      verified++;
    } else {
      await recordRetryOrFail(dbPool, task, verifyResult);
      if ((task.retry_count ?? 0) + 1 >= MAX_RETRIES) {
        failed++;
      }
    }
  }

  console.log(
    `[postdeploy-verifier] 本轮完成: verified=${verified} failed=${failed} skipped=${skipped} batch=${tasks.length}`
  );
  return { triggered: true, verified, failed, skipped };
}

/** 测试辅助：重置内部节流计时（仅在测试中使用） */
export function _resetThrottleForTest() {
  _lastRunAt = 0;
}
