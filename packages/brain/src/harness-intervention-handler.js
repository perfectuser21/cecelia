/**
 * harness-intervention-handler.js — Harness 人工干预任务处理器（WS5）
 *
 * Brain tick 在 harness pipeline 卡住（容器异常/超时/不可恢复错误）时创建
 * harness_intervention 任务。本 handler 在 Brain tick 内联调用：
 *   1. 读取卡住容器的 Docker logs（docker logs <containerId>）
 *   2. 调 Brain LLM 分析 logs，给出处置建议
 *   3. 输出 action（retry / skip / alert）写入 task.result
 *
 * 关键约束：tick 内联调用，全程 try-catch，任何异常都降级为 alert，
 * 绝不向上抛错让 tick loop 崩溃。
 */
import { execFile as execFileCb } from 'node:child_process';
import { callLLM } from './llm-caller.js';

// 合法的处置动作枚举（task.result.action 取值范围）
export const INTERVENTION_ACTIONS = ['retry', 'skip', 'alert'];

const DEFAULT_LOG_TAIL = 200;              // 默认读取最后 N 行日志
const DOCKER_LOGS_TIMEOUT_MS = 15000;      // docker logs 子进程超时
const MAX_LOG_CHARS = 8000;                // 喂给 LLM 的日志上限（避免超 token）

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

function buildPrompt(logs, context = {}) {
  return [
    '你是 Cecelia Harness pipeline 的干预决策器。',
    '下面是一个卡住的 pipeline 容器的 Docker 日志，请判断应采取哪种处置：',
    '- retry：瞬态错误（网络抖动、限流、超时），重跑可能成功',
    '- skip：该步骤可跳过，不影响整体交付',
    '- alert：需要人工介入（凭据失效、代码 bug、不可恢复错误）',
    '',
    context.nodeKey ? `当前节点：${context.nodeKey}` : '',
    context.taskTitle ? `任务：${context.taskTitle}` : '',
    '',
    '=== Docker 日志 ===',
    logs.slice(0, MAX_LOG_CHARS),
    '=== 日志结束 ===',
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
 * @param {Function} [deps.callLLM]          - LLM 调用（默认 llm-caller.callLLM）
 * @param {Function} [deps.updateTaskResult] - 写 task.result 的函数 (taskId, result) => Promise
 * @returns {Promise<{action:string, reason:string, analyzed:boolean}>}
 */
export async function handleIntervention(task, deps = {}) {
  const readLogs = deps.readLogs || readDockerLogs;
  const llm = deps.callLLM || callLLM;
  const payload = task?.payload || {};
  const containerId = payload.container_id || payload.containerId || payload.container;

  let result;
  try {
    if (!containerId) {
      result = { action: 'alert', reason: 'no_container_id', analyzed: false };
    } else {
      let logs = '';
      try {
        logs = await readLogs(containerId, { tail: payload.tail });
      } catch (logErr) {
        console.warn(`[harness-intervention] docker logs 读取失败 container=${containerId}: ${logErr.message}`);
        result = { action: 'alert', reason: `docker_logs_failed: ${logErr.message}`, analyzed: false };
      }

      if (!result) {
        if (!logs || !logs.trim()) {
          result = { action: 'alert', reason: 'empty_logs', analyzed: false };
        } else {
          const prompt = buildPrompt(logs, { nodeKey: payload.node_key, taskTitle: task?.title });
          const { text } = await llm('reflection', prompt, { timeout: 60000, maxTokens: 256 });
          const action = parseInterventionAction(text);
          result = { action, reason: (text || '').trim().slice(0, 500), analyzed: true };
        }
      }
    }
  } catch (err) {
    // 任何未预期异常 → 降级 alert，绝不让 tick 崩溃
    console.error(`[harness-intervention] handler 异常 task=${task?.id}: ${err.message}`);
    result = { action: 'alert', reason: `handler_error: ${err.message}`, analyzed: false };
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
