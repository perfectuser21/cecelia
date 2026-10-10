/**
 * tasks 列表查询参数（status / limit）的集中校验。
 * 非法值返回 400 错误对象，避免静默回落默认值或把非法值透传给 Postgres 引发 500。
 */
import { TASK_STATUSES } from './task-status-transitions.js';

export const MAX_TASK_LIST_LIMIT = 1000;

const LIMIT_RE = /^[1-9]\d*$/;

/**
 * @param {object} query  req.query
 * @param {{ defaultLimit: number }} opts
 * @returns {{ ok: true, status: string|undefined, limit: number } | { status: 400, body: object }}
 */
export function parseTaskListQuery(query = {}, { defaultLimit } = {}) {
  const { status: rawStatus, limit: rawLimit } = query;

  let status;
  if (rawStatus !== undefined && rawStatus !== '') {
    if (typeof rawStatus !== 'string' || !TASK_STATUSES.includes(rawStatus)) {
      return {
        status: 400,
        body: {
          error: 'invalid_status',
          message: `status 取值非法：${rawStatus}`,
          allowed: [...TASK_STATUSES],
        },
      };
    }
    status = rawStatus;
  }

  let limit = defaultLimit;
  if (rawLimit !== undefined) {
    const n = typeof rawLimit === 'string' && LIMIT_RE.test(rawLimit) ? Number(rawLimit) : NaN;
    if (!(n <= MAX_TASK_LIST_LIMIT)) {
      return {
        status: 400,
        body: {
          error: 'invalid_limit',
          message: `limit 必须是 1~${MAX_TASK_LIST_LIMIT} 的正整数`,
          got: rawLimit,
        },
      };
    }
    limit = n;
  }

  return { ok: true, status, limit };
}
