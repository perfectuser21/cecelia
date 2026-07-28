/**
 * 自动学习回路（Auto-Learning Loop）
 *
 * 任务完成/失败时自动产生 learning，让 Cecelia 从自己的行为中学习成长
 *
 * 成本控制：
 * - 只记录有价值的 task_type (dev, feature, research)
 * - 利用 content_hash 自动去重
 * - 每日上限 50 条
 */

import crypto from 'crypto';
import pool from './db.js';
import { generateL0Summary } from './memory-utils.js';
import { isNoiseLearningCategory } from './learning.js';
import { spawnHarnessReport } from './staging-promote.js';
import { sha256Canonical } from './lib/kernel-equivalence-receipts.js';

// ── 配置 ──────────────────────────────────────────────────
export const DAILY_AUTO_LEARNING_BUDGET = 50;
export const VALUABLE_TASK_TYPES = ['dev', 'feature', 'research']; // 排除 code_review 等高频低价值类型

const REPORT_LEARNING_SEAM_ID = 'kernel.closure.report_learning';
const REPORT_LEARNING_EFFECTS = Object.freeze({
  normal: Object.freeze({
    observed_outcome: 'confirmed',
    effect_code: 'report_learning_closure_confirmed',
  }),
  violation: Object.freeze({
    observed_outcome: 'denied',
    effect_code: 'stale_effect_closure_denied',
  }),
  recovery: Object.freeze({
    observed_outcome: 'recovered',
    effect_code: 'refreshed_effect_closure_confirmed',
  }),
});
const UUID_PATTERN =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const SHA_PATTERN = /^[a-f0-9]{40}$/;
const HASH_PATTERN = /^[a-f0-9]{64}$/;

// 运行时状态（进程内，午夜通过 hasBudget() 中日期对比自动重置）
let _autoLearningDailyCount = 0;
let _lastAutoLearningResetDate = new Date().toDateString();

// ── 测试辅助 ──────────────────────────────────────────────
export function _resetAutoLearningState() {
  _autoLearningDailyCount = 0;
  _lastAutoLearningResetDate = new Date().toDateString();
}

function reportLearningError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

function validEvidenceShape(evidence, grant, resource) {
  const reportArgs = evidence?.report_args;
  const learningInput = evidence?.learning_input;
  return (
    evidence
    && evidence.resource_id === resource.resource_id
    && evidence.resource_ref === resource.resource_ref
    && evidence.attempt_id === grant.attempt_id
    && UUID_PATTERN.test(evidence.effect_receipt_id)
    && HASH_PATTERN.test(evidence.effect_receipt_sha256)
    && SHA_PATTERN.test(evidence.artifact_sha)
    && evidence.artifact_sha === grant.artifact_sha
    && nonEmptyString(evidence.verified_at)
    && nonEmptyString(evidence.expires_at)
    && nonEmptyString(reportArgs?.initiativeId)
    && nonEmptyString(learningInput?.title)
    && nonEmptyString(learningInput?.category)
    && nonEmptyString(learningInput?.content)
    && nonEmptyString(learningInput?.triggerEvent)
    && (
      learningInput.metadata === undefined
      || (
        learningInput.metadata !== null
        && typeof learningInput.metadata === 'object'
        && !Array.isArray(learningInput.metadata)
      )
    )
  );
}

function freshEvidence(evidence, nowMs) {
  const verifiedAt = Date.parse(evidence.verified_at);
  const expiresAt = Date.parse(evidence.expires_at);
  return (
    Number.isFinite(nowMs)
    && Number.isFinite(verifiedAt)
    && Number.isFinite(expiresAt)
    && verifiedAt <= nowMs
    && nowMs < expiresAt
  );
}

function closureRecordMatches(record, evidence) {
  return (
    record
    && record.effect_receipt_id === evidence.effect_receipt_id
    && record.effect_receipt_sha256
      === evidence.effect_receipt_sha256
    && record.artifact_sha === evidence.artifact_sha
  );
}

/**
 * KERNEL-P1-11: exercise the real report-spawn and learning-insert paths
 * while keeping effect evidence, signing, and observations server-owned.
 */
export function createReportLearningEquivalenceSeam({
  reportDeps,
  learningPool,
  closureAuthority,
  effectSigner,
} = {}) {
  if (typeof effectSigner?.signEffectResult !== 'function') {
    throw reportLearningError('seam_effect_signer_unavailable');
  }
  if (
    closureAuthority?.owner_service !== REPORT_LEARNING_SEAM_ID
    || typeof closureAuthority?.now !== 'function'
    || typeof closureAuthority?.loadEvidence !== 'function'
    || typeof closureAuthority?.snapshot !== 'function'
    || typeof closureAuthority?.loadPredecessorEvidenceBinding
      !== 'function'
  ) {
    throw reportLearningError(
      'report_learning_authority_port_unavailable',
    );
  }
  if (
    typeof reportDeps?.dbQuery !== 'function'
    || typeof learningPool?.query !== 'function'
  ) {
    throw reportLearningError(
      'report_learning_closure_store_unavailable',
    );
  }

  return Object.freeze({
    owner_service: REPORT_LEARNING_SEAM_ID,

    async invoke({
      cell,
      grant,
      resource,
      predecessor = null,
      signal,
    }) {
      signal?.throwIfAborted();
      if (
        cell?.seam_id !== REPORT_LEARNING_SEAM_ID
        || resource?.resource_id !== grant?.resource_id
        || resource?.resource_ref !== grant?.resource_ref
      ) {
        throw reportLearningError(
          'report_learning_equivalence_resource_invalid',
        );
      }
      const effect = REPORT_LEARNING_EFFECTS[cell.scenario];
      if (!effect) {
        throw reportLearningError(
          'report_learning_equivalence_scenario_invalid',
        );
      }
      const authorityResource = Object.freeze({
        resource_id: resource.resource_id,
        resource_ref: resource.resource_ref,
      });
      const evidence = await closureAuthority.loadEvidence({
        cell,
        grant,
        resource: authorityResource,
        signal,
      });
      signal?.throwIfAborted();
      const nowValue = closureAuthority.now();
      const nowMs = nowValue instanceof Date
        ? nowValue.getTime()
        : new Date(nowValue).getTime();
      const validEvidence = validEvidenceShape(
        evidence,
        grant,
        authorityResource,
      );
      const isFresh = validEvidence && freshEvidence(evidence, nowMs);

      if (cell.scenario === 'violation') {
        if (isFresh) {
          throw reportLearningError(
            'report_learning_equivalence_scenario_invalid',
          );
        }
      } else if (!isFresh) {
        throw reportLearningError(
          'report_learning_effect_evidence_unavailable',
        );
      }

      if (cell.scenario === 'recovery') {
        const predecessorGrantId = predecessor?.grant?.grant_id;
        const predecessorReceiptId =
          predecessor?.receipt?.receipt_id;
        const binding =
          await closureAuthority.loadPredecessorEvidenceBinding({
            cell,
            grant,
            predecessor,
            signal,
          });
        signal?.throwIfAborted();
        if (
          !predecessorGrantId
          || !predecessorReceiptId
          || binding?.owner_service !== REPORT_LEARNING_SEAM_ID
          || binding?.predecessor_grant_id !== predecessorGrantId
          || binding?.predecessor_receipt_id
            !== predecessorReceiptId
          || binding?.denial_code
            !== 'stale_effect_closure_denied'
          || binding?.evidence_ref
            !== `db:kernel-equivalence-receipts/${predecessorReceiptId}`
          || !UUID_PATTERN.test(binding?.stale_effect_receipt_id)
          || binding.stale_effect_receipt_id
            === evidence.effect_receipt_id
          || binding?.refreshed_effect_receipt_id
            !== evidence.effect_receipt_id
        ) {
          throw reportLearningError(
            'report_learning_recovery_unproven',
          );
        }
      } else if (predecessor !== null) {
        throw reportLearningError(
          'report_learning_predecessor_invalid',
        );
      }

      const before = await closureAuthority.snapshot({
        phase: 'before',
        cell,
        grant,
        resource: authorityResource,
        evidence,
        signal,
      });
      signal?.throwIfAborted();

      if (cell.scenario !== 'violation') {
        const evidenceFields = Object.freeze({
          effectReceiptId: evidence.effect_receipt_id,
          effectReceiptSha256: evidence.effect_receipt_sha256,
          effectArtifactSha: evidence.artifact_sha,
          effectEvidenceVerifiedAt: evidence.verified_at,
        });
        const report = await spawnHarnessReport(reportDeps, {
          ...evidence.report_args,
          ...evidenceFields,
        });
        signal?.throwIfAborted();
        if (report?.spawned !== true) {
          throw reportLearningError(
            'report_learning_report_unconfirmed',
          );
        }
        const learning = await createAutoLearning({
          ...evidence.learning_input,
          metadata: {
            ...(evidence.learning_input.metadata ?? {}),
            effect_receipt_id: evidence.effect_receipt_id,
            effect_receipt_sha256:
              evidence.effect_receipt_sha256,
            effect_artifact_sha: evidence.artifact_sha,
            effect_evidence_verified_at: evidence.verified_at,
          },
        }, learningPool);
        signal?.throwIfAborted();
        if (!nonEmptyString(learning?.id)) {
          throw reportLearningError(
            'report_learning_closure_unconfirmed',
          );
        }
      }

      const after = await closureAuthority.snapshot({
        phase: 'after',
        cell,
        grant,
        resource: authorityResource,
        evidence,
        signal,
      });
      signal?.throwIfAborted();
      if (
        cell.scenario !== 'violation'
        && (
          !closureRecordMatches(after?.report, evidence)
          || !closureRecordMatches(after?.learning, evidence)
        )
      ) {
        throw reportLearningError(
          'report_learning_closure_unconfirmed',
        );
      }

      return effectSigner.signEffectResult({
        cell,
        grant,
        observation: {
          observed_outcome: effect.observed_outcome,
          effect_code: effect.effect_code,
          before_hash: sha256Canonical(before),
          after_hash: sha256Canonical(after),
        },
        predecessor,
      });
    },

    async cancel({ signal } = {}) {
      return { confirmed: signal?.aborted === true };
    },

    async cleanup() {
      return { confirmed: true };
    },
  });
}

/**
 * 检查是否有自动学习预算
 */
function hasAutoLearningBudget() {
  const today = new Date().toDateString();

  // 午夜重置计数器
  if (today !== _lastAutoLearningResetDate) {
    _autoLearningDailyCount = 0;
    _lastAutoLearningResetDate = today;
  }

  return _autoLearningDailyCount < DAILY_AUTO_LEARNING_BUDGET;
}

/**
 * 计算内容哈希用于去重
 */
function calculateContentHash(title, content) {
  const hashInput = `${title}\n${content}`;
  return crypto.createHash('sha256').update(hashInput).digest('hex').slice(0, 16);
}

/**
 * 检查相同哈希的学习是否已存在
 */
async function isDuplicateLearning(contentHash, dbPool = pool) {
  const existing = await dbPool.query(
    'SELECT id FROM learnings WHERE content_hash = $1 AND is_latest = true LIMIT 1',
    [contentHash]
  );

  return existing.rows.length > 0;
}

/**
 * 创建自动学习记录
 */
export async function createAutoLearning({ title, category, content, triggerEvent, metadata }, dbPool = pool) {
  // T9 噪音类目拦截（真实执行点）
  if (isNoiseLearningCategory(category)) {
    console.log(`[auto-learning] Skipping noise category: ${category}`);
    return null;
  }

  // 预算检查
  if (!hasAutoLearningBudget()) {
    console.log(`[auto-learning] Daily budget exhausted (${DAILY_AUTO_LEARNING_BUDGET}), skipping learning creation`);
    return null;
  }

  // 计算哈希并检查重复
  const contentHash = calculateContentHash(title, content);

  if (await isDuplicateLearning(contentHash, dbPool)) {
    console.log(`[auto-learning] Duplicate content detected (hash: ${contentHash}), skipping`);
    return null;
  }

  // task_id 防御层（migration 271）：handleTaskCompletedLearning / handleTaskFailedLearning
  // 都把 task_id 塞在 metadata 里，这里从 metadata 提升为列，确保可索引、可反查。
  const taskIdRaw = metadata?.task_id;
  const taskIdValid = typeof taskIdRaw === 'string'
    && /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(taskIdRaw);

  try {
    const result = await dbPool.query(`
      INSERT INTO learnings (title, category, trigger_event, content, metadata, content_hash, version, is_latest, digested, task_id, summary)
      VALUES ($1, $2, $3, $4, $5, $6, 1, true, false, $7, $8)
      RETURNING id, title
    `, [
      title,
      category,
      triggerEvent,
      content,
      JSON.stringify(metadata || {}),
      contentHash,
      taskIdValid ? taskIdRaw : null,
      generateL0Summary(`${title} ${content}`),
    ]);

    // 更新计数器
    _autoLearningDailyCount += 1;

    const learningId = result.rows[0].id;
    console.log(`[auto-learning] Created learning: ${title} (id: ${learningId}, hash: ${contentHash})`);

    return result.rows[0];
  } catch (error) {
    console.error(`[auto-learning] Failed to create learning: ${error.message}`);
    return null;
  }
}

/**
 * 处理 cecelia-run 合成结果（含 exit_code/stderr_tail/failure_class 字段）
 */
function _extractRunResult(result, maxLength) {
  const parts = [];
  if (result.error) parts.push(result.error);
  if (result.failure_class) parts.push(`failure_class=${result.failure_class}`);
  if (result.exit_code != null) parts.push(`exit_code=${result.exit_code}`);
  if (result.stderr_tail) parts.push(`stderr=${result.stderr_tail.slice(0, 200)}`);
  return parts.join(' | ').slice(0, maxLength) || 'Process exited without output';
}

/**
 * 从通用对象中提取摘要文本
 */
function _extractObjectSummary(result, maxLength) {
  const raw = result.error_details || result.error || result.message ||
    result.result || result.findings || result.summary || JSON.stringify(result);
  const text = typeof raw === 'object' ? JSON.stringify(raw) : raw.toString();
  return text.slice(0, maxLength);
}

/**
 * 提取任务摘要
 */
export function extractTaskSummary(result, maxLength = 500) {
  if (!result) return 'No details available';
  if (typeof result === 'string') return result.slice(0, maxLength);
  if (typeof result !== 'object') return 'Unknown result format';

  if (result.exit_code != null || result.stderr_tail || result.failure_class) {
    return _extractRunResult(result, maxLength);
  }
  return _extractObjectSummary(result, maxLength);
}

/**
 * 处理任务完成的自动学习
 */
export async function handleTaskCompletedLearning(task_id, taskType, _status, _result, _metadata = {}) {
  // T9: 任务完成事件层记录与 tasks 表 result 完全重复，零原子准则价值，停写。
  // 失败路径（handleTaskFailedLearning）保留——失败模式喂反刍系统。
  console.log(`[auto-learning] Skipping completed-task learning for ${task_id} (type=${taskType}): event-layer noise (T9)`);
  return null;
}

/**
 * 处理任务失败的自动学习
 */
export async function handleTaskFailedLearning(task_id, taskType, status, result, retryCount = 0, _metadata = {}, dbErrorMessage = null) {
  // 只处理有价值的任务类型
  if (!VALUABLE_TASK_TYPES.includes(taskType)) {
    console.log(`[auto-learning] Skipping task_type=${taskType} (not in valuable list)`);
    return null;
  }

  const title = `任务失败：${task_id}`;
  let errorSummary = extractTaskSummary(result);
  if (errorSummary === 'No details available' && dbErrorMessage) {
    errorSummary = dbErrorMessage.slice(0, 500);
  }

  const content = `任务执行失败。重试次数：${retryCount}。错误摘要：${errorSummary}`;

  return await createAutoLearning({
    title,
    category: 'failure_pattern',
    content,
    triggerEvent: 'task_failed_auto',
    metadata: {
      task_id,
      task_type: taskType,
      retry_count: retryCount,
      auto_generated: true,
      created_at: new Date().toISOString()
    }
  });
}

/**
 * 主要入口：处理任务执行结果的自动学习
 */
export async function processExecutionAutoLearning(task_id, newStatus, result, options = {}) {
  try {
    // 获取任务信息
    const taskResult = await pool.query('SELECT task_type, title, error_message FROM tasks WHERE id = $1', [task_id]);
    const taskRow = taskResult.rows[0];

    if (!taskRow) {
      console.warn(`[auto-learning] Task ${task_id} not found, skipping auto-learning`);
      return null;
    }

    const { task_type: taskType, title: taskTitle, error_message: dbErrorMessage } = taskRow;

    console.log(`[auto-learning] Processing task ${task_id} (type: ${taskType}, status: ${newStatus})`);

    const metadata = {
      trigger_source: options.trigger_source || 'execution_callback',
      task_title: taskTitle,
      ...options.metadata
    };

    if (newStatus === 'completed') {
      return await handleTaskCompletedLearning(task_id, taskType, newStatus, result, metadata);
    } else if (newStatus === 'failed') {
      const retryCount = options.retry_count || options.iterations || 0;
      return await handleTaskFailedLearning(task_id, taskType, newStatus, result, retryCount, metadata, dbErrorMessage);
    }

    console.log(`[auto-learning] Status ${newStatus} not handled for auto-learning`);
    return null;

  } catch (error) {
    console.error(`[auto-learning] Error processing auto-learning for task ${task_id}: ${error.message}`);
    return null;
  }
}

/**
 * 获取当前自动学习统计信息
 */
export function getAutoLearningStats() {
  return {
    dailyCount: _autoLearningDailyCount,
    dailyBudget: DAILY_AUTO_LEARNING_BUDGET,
    budgetRemaining: DAILY_AUTO_LEARNING_BUDGET - _autoLearningDailyCount,
    lastResetDate: _lastAutoLearningResetDate,
    valuableTaskTypes: VALUABLE_TASK_TYPES
  };
}
