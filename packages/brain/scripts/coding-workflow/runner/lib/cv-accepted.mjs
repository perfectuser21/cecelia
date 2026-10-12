// QA 验不了（CANNOT_VERIFY）的项是否已被 coding commander 裁过接受（金丝雀 6 #6291：
// 已裁「维持规格」的项下一轮 QA 又报同一项，不认前裁就会循环升级到介入上限上交人）。
import fs from 'node:fs';
import { prFile } from './repos.mjs';

const ACCEPT = new Set(['维持规格', '采纳']);

/** 已接受的键：按 Q 项（covers）认，条目没有 covers 时按条目 id 认。读不到记录返回空集。 */
export function acceptedKeys(cfg, prNumber) {
  let cs;
  try {
    cs = JSON.parse(fs.readFileSync(prFile(cfg, `commander-${prNumber}.json`), 'utf8'));
  } catch {
    return new Set();
  }
  const keys = new Set();
  for (const iv of cs?.interventions ?? []) {
    if (iv?.action !== 'resume' || iv.escalation?.type !== 'qa_cannot_verify') continue;
    for (const r of iv.rulings ?? []) {
      if (!ACCEPT.has(r?.verdict)) continue;
      const item = (iv.escalation.cannot_verify ?? []).find((x) => x?.id === r.issue);
      for (const k of item?.covers?.length ? item.covers : [r.issue]) keys.add(k);
    }
  }
  return keys;
}

/** 本轮验不了的项全部已被接受 → 条目 id 列表；有任一未接受（或没有条目）→ null。 */
export function cannotVerifyAccepted(cfg, prNumber, items) {
  if (!Array.isArray(items) || items.length === 0) return null;
  const keys = acceptedKeys(cfg, prNumber);
  const ok = items.every((x) => (x?.covers?.length ? x.covers.every((q) => keys.has(q)) : keys.has(x?.id)));
  return ok ? items.map((x) => x.id) : null;
}
