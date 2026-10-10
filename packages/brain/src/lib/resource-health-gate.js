/**
 * resource-health-gate.js — 调度前资源健康闸（任务 5bf2512a，决策 de6dff5d 第 5 步）
 *
 * 派发路径（dispatcher 候选循环 / 秋米路由后 / worker 池 / 手动派发）在点火前调用：
 * 任务引用的资源（collectTaskResourceRefs）里有 offline / restricted → blocked + 原因，调用方不派、保持 queued，
 * 资源恢复 healthy 后下一轮自然放行。
 *
 * fail-safe：闸挂在派发主路径上，自身出任何错（表不存在、查询超时…）都只记日志并放行，绝不让原路径失败。
 * 被挡留痕写 task_events（resource_health_blocked），同一张单同一原因只记一次，防每 tick 刷屏。
 */
import { collectTaskResourceRefs, checkResourcesHealth, summarizeHealthCheck } from './resource-health.js';
import { recordTaskEventSafe } from './task-event-log.js';

const lastLogged = new Map();
const LAST_LOGGED_MAX = 500;

/** 测试用：清空留痕去重表。 */
export function _resetGateEventMemo() {
  lastLogged.clear();
}

/**
 * @param {{id?: string, payload?: object}} task
 * @param {{pool: {query: Function}, payload?: object, tag?: string}} deps payload 可覆盖（如秋米刚定下的路由补丁）
 * @returns {Promise<{blocked: false, error?: string}|{blocked: true, reasons: object[], summary: string}>}
 */
export async function resourceHealthGate(task, deps = {}) {
  const tag = deps.tag ?? 'resource-health-gate';
  try {
    const refs = collectTaskResourceRefs(deps.payload ?? task?.payload);
    if (refs.length === 0) return { blocked: false };
    const check = await checkResourcesHealth(deps.pool, refs);
    if (check.ok) return { blocked: false };
    const summary = summarizeHealthCheck(check);
    await logBlocked(deps.pool, task?.id, summary, check.blocked);
    return { blocked: true, reasons: check.blocked, summary };
  } catch (err) {
    console.error(`[${tag}] 资源健康检查出错，按放行处理（fail-safe） task=${task?.id ?? '-'}: ${err.message}`);
    return { blocked: false, error: err.message };
  }
}

async function logBlocked(pool, taskId, summary, reasons) {
  if (!taskId || lastLogged.get(taskId) === summary) return;
  if (lastLogged.size >= LAST_LOGGED_MAX) lastLogged.clear();
  lastLogged.set(taskId, summary);
  await recordTaskEventSafe(pool, taskId, 'resource_health_blocked', { summary, reasons });
}
