// /learnings-received 不具幂等性：只发送一次，按返回 ID + 原文只读确认；未知/部分成功绝不自动重发。
import { createHash } from 'node:crypto';
import { syncEntry, updateSync } from './pr-sync.mjs';
const digest = (text) => createHash('sha256').update(text).digest('hex');

async function readback(ctx, ids, hashes) {
  if (typeof ctx.brain.listLearnings !== 'function') return false;
  const found = new Map();
  for (let offset = 0; offset < 1000; offset += 100) {
    const r = await ctx.brain.listLearnings({ limit: 100, offset });
    if (!r.ok || !Array.isArray(r.body?.learnings)) return false;
    for (const row of r.body.learnings) if (ids.includes(row.id)) found.set(row.id, digest(String(row.content)));
    if (ids.every((id, i) => found.get(id) === hashes[i])) return true;
    if (r.body.learnings.length < 100) break;
  }
  return false;
}

export async function recordMergeLearning(ctx, pr, body) {
  let entry = syncEntry(ctx.cfg, pr);
  if (!entry?.learning_pending) return;
  if (entry.learning_blocked) {
    ctx.log(`合并门 PR #${pr.number} 已有终态回执的 Learning 未确认，不回放历史写入`);
    return;
  }
  if (!entry.learning_attempted) {
    const hashes = body.next_steps_suggested.map(digest);
    // 留 unknown 在网络操作之前；进程中断也不会自动再次 POST。
    updateSync(ctx, pr, { learning_attempted: true, learning_status: 'unknown', learning_hashes: hashes });
    const r = await ctx.brain.postLearnings(body);
    const ids = r.body?.learning_ids;
    const complete = r.ok && r.body?.success === true && r.body.learnings_inserted === hashes.length
      && Array.isArray(ids) && ids.length === hashes.length && new Set(ids).size === ids.length && ids.every((id) => typeof id === 'string');
    updateSync(ctx, pr, {
      learning_status: complete ? 'readback_pending' : r.ok ? 'partial_or_invalid' : 'unknown',
      ...(complete ? { learning_ids: ids } : {}),
    });
    entry = syncEntry(ctx.cfg, pr);
  }
  if (entry.learning_status === 'readback_pending' && await readback(ctx, entry.learning_ids, entry.learning_hashes)) {
    updateSync(ctx, pr, { learning_pending: false, learning_status: 'confirmed' });
    return;
  }
  ctx.log(`合并门 PR #${pr.number} 交付复盘未确认（${entry.learning_status}），保留待办，不自动重发`);
}
