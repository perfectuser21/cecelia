/**
 * PR Callback Handler - GitHub PR 合并自动任务状态更新
 *
 * 功能：
 *   - 接收 GitHub Webhook 的 pull_request 合并事件
 *   - 根据 branch name 匹配对应任务（in_progress 优先，其次 completed）
 *   - 更新任务 pr_merged_at 和（in_progress 时）status
 *   - 触发 KR 进度重新计算（仅 in_progress 路径）
 *
 * 安全：
 *   - HMAC SHA-256 验证 Webhook secret
 *   - 幂等处理（pr_merged_at 已设置时跳过）
 */

import crypto from 'crypto';
import { updateKrProgress } from './kr-progress.js';

/**
 * 验证 GitHub Webhook 签名（HMAC SHA-256）。
 *
 * @param {string} secret - Webhook secret
 * @param {string} signature - X-Hub-Signature-256 header 值（格式: "sha256=<hex>"）
 * @param {Buffer|string} body - 原始请求体
 * @returns {boolean}
 */
export function verifyWebhookSignature(secret, signature, body) {
  if (!secret || !signature || !body) return false;

  if (!signature.startsWith('sha256=')) return false;

  const expectedSig = `sha256=${crypto
    .createHmac('sha256', secret)
    .update(body)
    .digest('hex')}`;

  // 使用 timingSafeEqual 防止时序攻击
  try {
    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSig)
    );
  } catch {
    return false;
  }
}

/**
 * 根据分支名匹配任务（优先 in_progress，其次 completed）。
 *
 * 查询逻辑（两步）：
 *   1. 优先查 in_progress 任务（by branch 名）
 *   2. 若无，查 completed 且 pr_merged_at IS NULL 的任务
 *      （by pr_url LIKE '%branchName%' 或 metadata/payload 中的 branch 名）
 *
 * @param {import('pg').Pool} pool - PostgreSQL 连接池
 * @param {string} branchName - 分支名（如 cp-xxx 或 feature/xxx）
 * @returns {Promise<object|null>} 匹配的任务行，或 null
 */
export async function matchTaskByBranchOrUrl(pool, branchName) {
  if (!branchName) return null;

  // 1. 优先匹配 in_progress 任务（by branch 名）
  const inProgressResult = await pool.query(`
    SELECT
      id, title, status, project_id, goal_id,
      metadata, payload, task_type
    FROM tasks
    WHERE status = 'in_progress'
      AND (
        metadata->>'branch' = $1
        OR payload->>'pr_branch' = $1
      )
    ORDER BY updated_at DESC
    LIMIT 1
  `, [branchName]);

  if (inProgressResult.rows.length > 0) {
    return inProgressResult.rows[0];
  }

  // 2. 匹配 completed 且 pr_merged_at IS NULL 的任务（by pr_url 含 branch 名）
  const completedResult = await pool.query(`
    SELECT
      id, title, status, project_id, goal_id,
      metadata, payload, task_type
    FROM tasks
    WHERE status = 'completed'
      AND pr_merged_at IS NULL
      AND (
        pr_url LIKE '%' || $1 || '%'
        OR metadata->>'branch' = $1
        OR payload->>'pr_branch' = $1
      )
    ORDER BY updated_at DESC
    LIMIT 1
  `, [branchName]);

  if (completedResult.rows.length === 0) {
    console.warn(`[pr-callback] 无匹配任务: branch=${branchName}（可能是手动创建的 PR）`);
    return null;
  }

  return completedResult.rows[0];
}

/**
 * 处理 GitHub PR 合并事件。
 *
 * 流程：
 *   1. 根据分支名查找 in_progress 任务
 *   2. 更新任务状态为 completed
 *   3. 记录 PR 信息到 metadata 和 payload
 *   4. 触发 KR 进度重新计算
 *
 * @param {import('pg').Pool} pool - PostgreSQL 连接池
 * @param {object} prInfo - PR 信息
 * @param {string} prInfo.repo - 仓库全名（如 owner/repo）
 * @param {number} prInfo.prNumber - PR 编号
 * @param {string} prInfo.branchName - 分支名
 * @param {string} prInfo.prUrl - PR HTML URL
 * @param {string} prInfo.mergedAt - 合并时间（ISO 字符串）
 * @param {string} prInfo.title - PR 标题
 * @returns {Promise<{
 *   matched: boolean,
 *   taskId: string|null,
 *   taskTitle: string|null,
 *   krProgressUpdated: boolean
 * }>}
 */
export async function handlePrMerged(pool, prInfo) {
  const { repo, prNumber, branchName, prUrl, mergedAt, title: prTitle } = prInfo;

  console.log(`[pr-callback] PR 合并事件: repo=${repo} pr=#${prNumber} branch=${branchName}`);

  // 1. 匹配任务（in_progress 优先，其次 completed）
  const task = await matchTaskByBranchOrUrl(pool, branchName);
  if (!task) {
    return { matched: false, taskId: null, taskTitle: null, krProgressUpdated: false };
  }

  const taskId = task.id;
  const taskTitle = task.title;
  console.log(`[pr-callback] 匹配到任务: id=${taskId} title="${taskTitle}" status=${task.status}`);

  // 2. 分支处理：已完成任务只更新 pr_merged_at，不改 status 也不触发 KR 进度
  if (task.status === 'completed') {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const updateResult = await client.query(`
        UPDATE tasks
        SET
          pr_url = COALESCE(pr_url, $2),
          pr_merged_at = $3,
          updated_at = NOW()
        WHERE id = $1
          AND status = 'completed'
          AND pr_merged_at IS NULL
        RETURNING id
      `, [taskId, prUrl, mergedAt]);

      if (updateResult.rowCount === 0) {
        // 幂等：pr_merged_at 已有值，不重复更新
        await client.query('ROLLBACK');
        console.log(`[pr-callback] 任务 ${taskId} pr_merged_at 已设置，跳过（幂等）`);
        return { matched: true, taskId, taskTitle, krProgressUpdated: false };
      }

      await client.query('COMMIT');
      console.log(`[pr-callback] 已完成任务 ${taskId} pr_merged_at 已更新（via PR #${prNumber}）`);
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch (_) { /* ignore */ }
      console.error(`[pr-callback] pr_merged_at 更新失败: ${err.message}`);
      throw err;
    } finally {
      client.release();
    }

    return { matched: true, taskId, taskTitle, krProgressUpdated: false };
  }

  // 3. in_progress 任务：原有完整路径（更新 status + pr_url + pr_merged_at + KR 进度）
  const client = await pool.connect();
  let krProgressUpdated = false;

  try {
    await client.query('BEGIN');

    // 构建更新的 metadata（追加 PR 信息）
    const prMeta = {
      pr_url: prUrl,
      pr_number: prNumber,
      pr_title: prTitle,
      repo,
      merged_at: mergedAt,
      completed_via: 'github_webhook'
    };

    // 构建更新的 payload（追加 pr_url）
    const payloadUpdate = {
      pr_url: prUrl,
      last_run_result: {
        pr_url: prUrl,
        completed_at: mergedAt,
        status: 'AI Done',
        result_summary: `PR #${prNumber} merged: ${prTitle}`
      }
    };

    const updateResult = await client.query(`
      UPDATE tasks
      SET
        status = 'completed',
        completed_at = $2,
        updated_at = NOW(),
        pr_url = $5,
        pr_merged_at = COALESCE($6::timestamp, NOW()),
        metadata = COALESCE(metadata, '{}'::jsonb) || $3::jsonb,
        payload = COALESCE(payload, '{}'::jsonb) || $4::jsonb
      WHERE id = $1
        AND status = 'in_progress'
      RETURNING id, goal_id, project_id, pr_url, pr_merged_at
    `, [
      taskId,
      mergedAt,
      JSON.stringify(prMeta),
      JSON.stringify(payloadUpdate),
      prUrl,
      mergedAt
    ]);

    if (updateResult.rowCount === 0) {
      // 幂等：任务不再是 in_progress（可能已 completed 或被其他事件更新）
      await client.query('ROLLBACK');
      console.warn(`[pr-callback] 任务 ${taskId} 状态已变更，跳过更新（幂等）`);
      return { matched: true, taskId, taskTitle, krProgressUpdated: false };
    }

    await client.query('COMMIT');
    console.log(`[pr-callback] 任务 ${taskId} 状态更新为 completed（via PR #${prNumber}）`);

    // 4. 触发 KR 进度更新（事务外，失败不影响任务更新）
    const updatedRow = updateResult.rows[0];
    const goalId = updatedRow.goal_id;

    if (goalId) {
      try {
        await updateKrProgress(pool, goalId);
        krProgressUpdated = true;
        console.log(`[pr-callback] KR 进度已更新: goal_id=${goalId}`);
      } catch (krErr) {
        console.error(`[pr-callback] KR 进度更新失败（非致命）: ${krErr.message}`);
      }
    } else {
      // 尝试通过 project_id 查找关联的 KR
      try {
        const krResult = await pool.query(`
          SELECT pkl.kr_id
          FROM project_kr_links pkl
          JOIN projects p ON p.id = pkl.project_id
          WHERE p.id = $1
            OR p.parent_id = $1
          LIMIT 1
        `, [updatedRow.project_id]);

        if (krResult.rows.length > 0) {
          await updateKrProgress(pool, krResult.rows[0].kr_id);
          krProgressUpdated = true;
          console.log(`[pr-callback] KR 进度已更新（via project）: kr_id=${krResult.rows[0].kr_id}`);
        }
      } catch (krErr) {
        console.error(`[pr-callback] KR 进度更新失败（via project，非致命）: ${krErr.message}`);
      }
    }

  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) { /* ignore */ }
    console.error(`[pr-callback] 任务更新失败: ${err.message}`);
    throw err;
  } finally {
    client.release();
  }

  return { matched: true, taskId, taskTitle, krProgressUpdated };
}

/**
 * 从 GitHub pull_request 事件 payload 中提取 PR 信息。
 *
 * @param {object} githubPayload - GitHub Webhook payload
 * @returns {object|null} PR 信息，或 null（非合并事件）
 */
export function extractPrInfo(githubPayload) {
  const { action, pull_request, repository } = githubPayload;

  // 只处理合并事件
  if (action !== 'closed' || !pull_request?.merged) {
    return null;
  }

  return {
    repo: repository?.full_name || '',
    prNumber: pull_request.number,
    branchName: pull_request.head?.ref || '',
    prUrl: pull_request.html_url,
    mergedAt: pull_request.merged_at,
    title: pull_request.title || ''
  };
}
