// 执行器回执解读：读终态回执、提炼失败活动与原因。
import fs from 'node:fs';

const FINAL_STATUSES = new Set(['completed', 'partial', 'failed']);

const isFinal = (r) => r !== null && typeof r === 'object' && FINAL_STATUSES.has(r.status);

function parse(text) {
  try {
    return JSON.parse(String(text).trim());
  } catch {
    return null;
  }
}

/**
 * 执行器的唯一终态 JSON 在 stdout；stdout 不可用时回落到 --receipt 文件，
 * 但只认终态（进度快照带 last_event，不算）。都不可用返回 null。
 */
export function readReceipt(stdout, receiptPath) {
  const fromStdout = parse(stdout);
  if (isFinal(fromStdout)) return fromStdout;
  let fromFile = null;
  try {
    fromFile = parse(fs.readFileSync(receiptPath, 'utf8'));
  } catch {
    return null;
  }
  if (isFinal(fromFile) && !('last_event' in fromFile)) return fromFile;
  return null;
}

/**
 * 提炼：completed 需有 outputs.pr_url，否则 reason_code=pr_url_missing；
 * 未完成时 failed_activity = 第一个非 completed/skipped 的活动，reason_code 取其最后一次尝试，
 * 没有活动级原因时取回执级 reason_code，再没有则 run_<status>。
 */
export function summarizeReceipt(receipt) {
  // 链路总花费（审计 #35）：各活动 metrics.cost_usd 之和，有才带
  const costs = Object.values(receipt?.metrics ?? {}).map((m) => m?.cost_usd).filter((v) => typeof v === 'number');
  const cost = costs.length > 0 ? { cost_usd: Math.round(costs.reduce((a, b) => a + b, 0) * 10000) / 10000 } : {};
  const prUrl = typeof receipt?.outputs?.pr_url === 'string' && receipt.outputs.pr_url !== ''
    ? receipt.outputs.pr_url
    : null;
  if (receipt?.status === 'completed') {
    return { status: 'completed', failed_activity: null, reason_code: prUrl ? null : 'pr_url_missing', pr_url: prUrl, ...cost };
  }
  const activities = Array.isArray(receipt?.activities) ? receipt.activities : [];
  const failed = activities.find((a) => a?.status !== 'completed' && a?.status !== 'skipped');
  const attemptReason = Array.isArray(failed?.attempts) ? failed.attempts.at(-1)?.reason_code : undefined;
  return {
    status: receipt?.status ?? 'failed',
    failed_activity: failed?.key ?? null,
    reason_code: attemptReason || failed?.reason_code || receipt?.reason_code || `run_${receipt?.status ?? 'failed'}`,
    pr_url: prUrl,
    ...cost,
  };
}
