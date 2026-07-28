/**
 * harness-intervention-handler.js — Harness 人工干预任务处理器（WS5）
 *
 * Brain tick 在 harness pipeline 卡住（执行体异常/超时/不可恢复错误）时创建
 * harness_intervention 任务。本 handler 在 Brain tick 内联调用：
 *   1. Kernel v1 读取 harness_attempts result/telemetry；旧 relay 读取 Docker logs
 *   2. 调 Brain LLM 分析 logs，给出处置建议
 *   3. 输出 action（retry / skip / alert）写入 task.result
 *
 * 关键约束：tick 内联调用，全程 try-catch，任何异常都降级为 alert，
 * 绝不向上抛错让 tick loop 崩溃。
 */
import { execFile as execFileCb } from 'node:child_process';
import { callLLM } from './llm-caller.js';
import pool from './db.js';
import { sanitize } from './trace.js';
import { sanitizeDiagnostic } from './orchestrator/failure-persistence.js';

// 合法的处置动作枚举（task.result.action 取值范围）
export const INTERVENTION_ACTIONS = ['retry', 'skip', 'alert'];

const DEFAULT_LOG_TAIL = 200;              // 默认读取最后 N 行日志
const DOCKER_LOGS_TIMEOUT_MS = 15000;      // docker logs 子进程超时
const MAX_LOG_CHARS = 8000;                // 喂给 LLM 的日志上限（避免超 token）
const KERNEL_RUNTIME = 'kernel-v1';
const MAX_KERNEL_ATTEMPTS = 20;

function sanitizeEvidenceStrings(value) {
  if (Array.isArray(value)) return value.map(sanitizeEvidenceStrings);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [key, sanitizeEvidenceStrings(nested)]),
    );
  }
  return typeof value === 'string' ? sanitizeDiagnostic(value) : value;
}

/**
 * 读取指定容器的 Docker logs（最后 tail 行，stdout+stderr 合并）。
 * @param {string} containerId - 容器 ID 或名称
 * @param {object} [opts]
 * @param {number}   [opts.tail]      - 读取末尾行数（默认 200）
 * @param {Function} [opts.execFile]  - child_process.execFile 替换（测试注入）
 * @returns {Promise<string>} 合并后的日志文本
 */
export function readDockerLogs(containerId, opts = {}) {
  const tail = opts.tail || DEFAULT_LOG_TAIL;
  const execFn = opts.execFile || execFileCb;
  return new Promise((resolve, reject) => {
    execFn(
      'docker',
      ['logs', '--tail', String(tail), containerId],
      { timeout: DOCKER_LOGS_TIMEOUT_MS, maxBuffer: 10 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) return reject(err);
        // docker 把容器 stderr 输出到子进程 stderr 流，合并便于 LLM 分析
        resolve(`${stdout || ''}${stderr || ''}`.trim());
      }
    );
  });
}

/**
 * 读取 Kernel Run 最近的角色 Attempt 结果和 telemetry。
 *
 * 只选择诊断白名单列，按 run_id 隔离；result 在进入 Prompt 前递归脱敏。
 * Kernel 没有 relay 容器，因此本函数失败或无数据时调用方必须 fail-closed，
 * 不得回落到 docker logs。
 *
 * @param {string} runId
 * @param {object} [opts]
 * @param {import('pg').Pool} [opts.pool]
 * @returns {Promise<string>} 有 Attempt 时返回 JSON evidence；无 Attempt 返回空串
 */
export async function readKernelAttemptEvidence(runId, opts = {}) {
  if (!runId || typeof runId !== 'string') {
    throw new Error('kernel_run_id_missing');
  }
  const dbPool = opts.pool || pool;
  const { rows } = await dbPool.query(
    `SELECT id, run_id, hop, phase, role, status,
            provider, attempt_kind, retry_of_attempt_id, restart_reason,
            workstream_key, requested_machine_id, actual_machine_id,
            execution_transport, failure_class, error_code, error_message,
            lease_expires_at, heartbeat_at, started_at, completed_at, updated_at,
            result_receipt_id, result_persisted_at, result
       FROM harness_attempts
      WHERE run_id = $1
      ORDER BY hop DESC
      LIMIT ${MAX_KERNEL_ATTEMPTS}`,
    [runId],
  );
  const attempts = (rows || []).map((row) => sanitizeEvidenceStrings(sanitize(row)));
  if (attempts.length === 0) return '';
  return JSON.stringify({
    source: 'harness_attempts',
    run_id: runId,
    attempt_count: attempts.length,
    attempts,
  });
}

/**
 * 从 LLM 返回文本中解析出处置动作（retry/skip/alert）。
 * 优先匹配 "ACTION: <action>" 标记，其次裸词匹配，无法识别时降级 alert。
 * @param {string} llmText
 * @returns {'retry'|'skip'|'alert'}
 */
export function parseInterventionAction(llmText) {
  if (!llmText || typeof llmText !== 'string') return 'alert';
  const lower = llmText.toLowerCase();
  // 优先匹配明确的 ACTION: 标记（兼容半角/全角冒号）
  const tagged = lower.match(/action\s*[:：]\s*(retry|skip|alert)/);
  if (tagged) return tagged[1];
  // 退回裸词匹配
  for (const action of INTERVENTION_ACTIONS) {
    if (new RegExp(`\\b${action}\\b`).test(lower)) return action;
  }
  return 'alert';
}

function buildPrompt(evidence, context = {}) {
  const kernelEvidence = context.evidenceSource === 'harness_attempts';
  return [
    '你是 Cecelia Harness pipeline 的干预决策器。',
    kernelEvidence
      ? '下面是卡住 Run 的 Kernel Attempt evidence，请判断应采取哪种处置：'
      : '下面是一个卡住的 pipeline 容器的 Docker 日志，请判断应采取哪种处置：',
    '- retry：瞬态错误（网络抖动、限流、超时），重跑可能成功',
    '- skip：该步骤可跳过，不影响整体交付',
    '- alert：需要人工介入（凭据失效、代码 bug、不可恢复错误）',
    '',
    context.nodeKey ? `当前节点：${context.nodeKey}` : '',
    context.taskTitle ? `任务：${context.taskTitle}` : '',
    '',
    kernelEvidence ? '=== harness_attempts result/telemetry ===' : '=== Docker 日志 ===',
    evidence.slice(0, MAX_LOG_CHARS),
    kernelEvidence ? '=== Kernel evidence 结束 ===' : '=== 日志结束 ===',
    '',
    '只输出一行，格式：ACTION: <retry|skip|alert>，后面可附一句理由。',
  ].filter(Boolean).join('\n');
}

/**
 * 处理 harness_intervention 任务：读 Docker logs → LLM 分析 → 输出 action。
 *
 * @param {object}   task                    - Brain task 对象（id / title / payload）
 * @param {object}   [deps]                  - 依赖注入（测试用）
 * @param {Function} [deps.readLogs]         - 读日志函数（默认 readDockerLogs）
 * @param {Function} [deps.readKernelEvidence] - 读 Kernel Attempt evidence
 * @param {import('pg').Pool} [deps.pool]     - Kernel evidence PostgreSQL 连接池
 * @param {Function} [deps.callLLM]          - LLM 调用（默认 llm-caller.callLLM）
 * @param {Function} [deps.updateTaskResult] - 写 task.result 的函数 (taskId, result) => Promise
 * @returns {Promise<{action:string, reason:string, analyzed:boolean}>}
 */
export async function handleIntervention(task, deps = {}) {
  const readLogs = deps.readLogs || readDockerLogs;
  const readKernelEvidence = deps.readKernelEvidence || readKernelAttemptEvidence;
  const llm = deps.callLLM || callLLM;
  const payload = task?.payload || {};
  const containerId = payload.container_id || payload.containerId || payload.container;
  const kernelRuntime = payload.harness_runtime === KERNEL_RUNTIME;
  const evidenceSource = kernelRuntime ? 'harness_attempts' : 'docker_logs';

  let result;
  try {
    if (kernelRuntime && !payload.run_id) {
      result = {
        action: 'alert',
        reason: 'kernel_run_id_missing',
        analyzed: false,
        evidence_source: evidenceSource,
      };
    } else if (!kernelRuntime && !containerId) {
      result = {
        action: 'alert',
        reason: 'no_container_id',
        analyzed: false,
        evidence_source: evidenceSource,
      };
    } else {
      let evidence = '';
      try {
        evidence = kernelRuntime
          ? await readKernelEvidence(payload.run_id, { pool: deps.pool || pool })
          : await readLogs(containerId, { tail: payload.tail });
      } catch (evidenceErr) {
        const failureCode = kernelRuntime ? 'kernel_evidence_failed' : 'docker_logs_failed';
        console.warn(
          `[harness-intervention] ${evidenceSource} 读取失败 `
          + `${kernelRuntime ? `run=${payload.run_id}` : `container=${containerId}`}: ${evidenceErr.message}`
        );
        result = {
          action: 'alert',
          reason: `${failureCode}: ${evidenceErr.message}`,
          analyzed: false,
          evidence_source: evidenceSource,
        };
      }

      if (!result) {
        if (!evidence || !evidence.trim()) {
          result = {
            action: 'alert',
            reason: kernelRuntime ? 'empty_kernel_evidence' : 'empty_logs',
            analyzed: false,
            evidence_source: evidenceSource,
          };
        } else {
          const prompt = buildPrompt(evidence, {
            nodeKey: payload.node_key,
            taskTitle: task?.title,
            evidenceSource,
          });
          const { text } = await llm('reflection', prompt, { timeout: 60000, maxTokens: 256 });
          const action = parseInterventionAction(text);
          result = {
            action,
            reason: (text || '').trim().slice(0, 500),
            analyzed: true,
            evidence_source: evidenceSource,
          };
        }
      }
    }
  } catch (err) {
    // 任何未预期异常 → 降级 alert，绝不让 tick 崩溃
    console.error(`[harness-intervention] handler 异常 task=${task?.id}: ${err.message}`);
    result = {
      action: 'alert',
      reason: `handler_error: ${err.message}`,
      analyzed: false,
      evidence_source: evidenceSource,
    };
  }

  // 写入 task.result（写库失败也不影响返回值）
  if (deps.updateTaskResult) {
    try {
      await deps.updateTaskResult(task.id, result);
    } catch (writeErr) {
      console.error(`[harness-intervention] 写 task.result 失败 task=${task?.id}: ${writeErr.message}`);
    }
  }

  console.log(`[harness-intervention] task=${task?.id} action=${result.action} analyzed=${result.analyzed}`);
  return result;
}
