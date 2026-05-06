/**
 * LangGraph 节点级 RetryPolicy 共享配置。
 *
 * Spec: docs/superpowers/specs/2026-05-06-harness-langgraph-reliability-design.md §W2
 * Plan: docs/superpowers/plans/2026-05-06-harness-langgraph-reliability.md §W2
 *
 * 使用方法：
 *   import { LLM_RETRY, DB_RETRY, NO_RETRY } from './retry-policies.js';
 *   .addNode('planner', plannerFn, { retryPolicy: LLM_RETRY })
 *
 * 决策表：
 *   LLM_RETRY  — 调 LLM/Docker 子进程的节点（瞬时网络/503 自动重试）
 *   DB_RETRY   — 纯 DB 操作节点（短重试，剔除唯一/外键等业务永久错）
 *   NO_RETRY   — 状态机/纯函数/schema parse 节点（重试无意义）
 */

// 永久错关键词（命中后不重试）：401/403 鉴权、schema/parse 校验、GraphInterrupt（用户暂停）、AbortError（watchdog）
const PERMANENT_ERROR_RE = /\b(401|403|invalid api key|invalid_api_key|schema|parse error|parse failed|validation failed|GraphInterrupt|AbortError)\b/i;

export const LLM_RETRY = {
  maxAttempts: 3,
  initialInterval: 5000,
  backoffFactor: 2.0,
  jitter: true,
  retryOn: (err) => {
    const msg = String(err?.message || '');
    return !PERMANENT_ERROR_RE.test(msg);
  },
};

export const DB_RETRY = {
  maxAttempts: 2,
  initialInterval: 1000,
  backoffFactor: 2.0,
  jitter: false,
  retryOn: (err) => {
    const msg = String(err?.message || '');
    if (PERMANENT_ERROR_RE.test(msg)) return false;
    // DB 业务永久错（违反约束）不重试
    if (/duplicate key|UNIQUE constraint|foreign key/i.test(msg)) return false;
    return true;
  },
};

export const NO_RETRY = { maxAttempts: 1 };
