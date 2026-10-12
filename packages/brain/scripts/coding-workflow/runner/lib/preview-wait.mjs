/** starting/error 共用等待时限；跨 tick 持久化，同一 head 的状态抖动不能重新计时。 */
export async function waitForPreview(ctx, pr, s, p, { writeState, escalate }) {
  const now = Date.now();
  const previous = s.preview?.waiting_head === pr.headRefOid ? Date.parse(s.preview.waiting_since) : NaN;
  const since = Number.isFinite(previous) ? previous : now;
  const last_error = p.error ?? `preview ${p.status ?? p.state}`;
  s.preview = { ...s.preview, waiting_since: new Date(since).toISOString(), waiting_head: pr.headRefOid, last_error };
  if (now - since >= ctx.cfg.qaPreviewEscalateMs) {
    return escalate(ctx, pr, s, null, { type: 'qa_preview_unavailable', preview_state: p.state, last_error, since: s.preview.waiting_since });
  }
  writeState(ctx.cfg, pr.number, s);
  ctx.log(`PR #${pr.number} 预览环境 ${p.state}，已等待 ${Math.floor((now - since) / 1000)} 秒，下轮再验`);
}

/** 预览已走出 pending/error，下一次故障必须重新计时。 */
export function clearPreviewWait(ctx, pr, s, writeState) {
  if (!s.preview?.waiting_since) return;
  delete s.preview.waiting_since;
  delete s.preview.waiting_head;
  delete s.preview.last_error;
  writeState(ctx.cfg, pr.number, s);
}
