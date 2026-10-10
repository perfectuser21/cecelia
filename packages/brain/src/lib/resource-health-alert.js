/**
 * resource-health-alert.js — 资源健康变坏预警（任务 5bf2512a）
 *
 * 复用现有通道：
 *   urgent  （变成 offline / restricted）→ Bark 推主理人手机（按 资源+状态 去重 6 小时）+ alerting P1 系统汇总
 *   warn    （变成 degraded）            → alerting P1
 *   recover （offline/restricted → healthy）→ alerting P2
 * 告警是旁路：任何通道出错只记日志，绝不外抛。
 */
import { sendBark as defaultSendBark } from '../notifier.js';
import { raise as defaultRaise } from '../alerting.js';

const BAD = new Set(['offline', 'restricted']);
const LABEL = { offline: '掉线', restricted: '被风控', degraded: '降级', healthy: '恢复正常', unknown: '状态未知' };
const BARK_DEDUPE_TTL_SEC = 6 * 3600;

/** 状态迁移 → 告警级别（urgent / warn / recover / null）。 */
export function decideHealthAlert(previous, next) {
  if (previous === next) return null;
  if (BAD.has(next)) return 'urgent';
  if (next === 'degraded') return previous === null || previous === undefined || previous === 'healthy' || previous === 'unknown' ? 'warn' : null;
  if (next === 'healthy' && BAD.has(previous)) return 'recover';
  return null;
}

async function safe(label, fn) {
  try {
    await fn();
  } catch (err) {
    console.error(`[resource-health-alert] ${label} 失败（不影响主流程）: ${err.message}`);
  }
}

/**
 * 按迁移发告警。
 * @param {object} row 当前 resource_health 行
 * @param {string|null} previous 上一状态
 * @param {{sendBark?: Function, raise?: Function}} [deps]
 * @returns {Promise<'urgent'|'warn'|'recover'|null>}
 */
export async function notifyHealthTransition(row, previous, deps = {}) {
  const level = decideHealthAlert(previous ?? null, row?.status);
  if (!level) return null;
  const sendBark = deps.sendBark ?? defaultSendBark;
  const raise = deps.raise ?? defaultRaise;
  const who = `${row.resource_type} ${row.resource_key}`;
  const detail = `${who}：${previous ?? '(首次)'} → ${row.status}${row.reason ? `，原因：${row.reason}` : ''}${row.source ? `（来源 ${row.source}）` : ''}`;

  if (level === 'urgent') {
    await safe('Bark', () => sendBark(`资源${LABEL[row.status]}：${row.resource_key}`, detail, {
      dedupeKey: `resource-health:${row.resource_type}:${row.resource_key}:${row.status}`,
      dedupeTtlSec: BARK_DEDUPE_TTL_SEC,
    }));
    await safe('alerting P1', () => raise('P1', `resource_health_${row.status}`, `资源${LABEL[row.status]}：${detail}`));
  } else if (level === 'warn') {
    await safe('alerting P1', () => raise('P1', 'resource_health_degraded', `资源降级：${detail}`));
  } else {
    await safe('alerting P2', () => raise('P2', 'resource_health_recovered', `资源恢复：${detail}`));
  }
  return level;
}
