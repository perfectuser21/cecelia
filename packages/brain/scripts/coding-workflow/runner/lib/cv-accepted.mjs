// 接受限制只影响处置，绝不证明 QA PASS。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { prFile } from './repos.mjs';
const ACCEPT = new Set(['维持规格', '采纳']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA = /^[0-9a-f]{64}$/;
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const sameItem = (a, b) => typeof a?.reason === 'string' && a.reason.length > 0 && a.reason === b?.reason
  && Array.isArray(a.covers) && a.covers.length > 0 && Array.isArray(b?.covers)
  && JSON.stringify([...a.covers].sort()) === JSON.stringify([...b.covers].sort());
const validContext = c => c && UUID.test(c.taskId ?? '') && typeof c.sprintDir === 'string' && c.sprintDir.length > 0
  && /^[0-9a-f]{40}$/.test(c.head ?? '') && SHA.test(c.specSha256 ?? '')
  && SHA.test(c.executionContextSha256 ?? '') && Number.isInteger(c.round) && c.round > 0;
export function qaAcceptanceContext(worktree, intent, head, round, qa, qaStageEventId, sourceExecutionContextSha256) {
  return { taskId: intent.taskId, sprintDir: intent.sprintDir, head, round, qaStageEventId,
    specSha256: hash(fs.readFileSync(path.join(worktree, intent.sprintDir, '02-spec.md'))),
    executionContextSha256: hash(JSON.stringify({ env: { kind: qa.env?.kind ?? null, url: qa.env?.url ?? null,
      transport: qa.env?.transport ?? null }, provider: qa.provider ?? null, model: qa.model ?? null, source_execution_context_sha256: sourceExecutionContextSha256 ?? null })) };
}
/** 历史台账查询兼容接口；仅展示旧 covers，不作为本轮处置或验收依据。 */
export function acceptedKeys(cfg, prNumber) {
  let cs;
  try { cs = JSON.parse(fs.readFileSync(prFile(cfg, `commander-${prNumber}.json`), 'utf8')); } catch { return new Set(); }
  const keys = new Set();
  for (const iv of cs?.interventions ?? []) {
    if (iv?.action !== 'resume' || iv.escalation?.type !== 'qa_cannot_verify') continue;
    for (const ruling of iv.rulings ?? []) {
      if (!ACCEPT.has(ruling.verdict)) continue;
      const item = (iv.escalation.cannot_verify ?? []).find(x => x?.id === ruling.issue);
      for (const key of item?.covers?.length ? item.covers : [ruling.issue]) keys.add(key);
    }
  }
  return keys;
}
export function cannotVerifyAccepted(cfg, prNumber, items, current) {
  if (!validContext(current) || !Array.isArray(items) || !items.length) return null;
  let cs;
  try { cs = JSON.parse(fs.readFileSync(prFile(cfg, `commander-${prNumber}.json`), 'utf8')); } catch { return null; }
  for (const iv of cs?.interventions ?? []) {
    const s = iv?.cv_scope;
    if (iv?.action !== 'resume' || iv.escalation?.type !== 'qa_cannot_verify' || s?.schema_version !== 1
      || s.task_id !== current.taskId || s.sprint_dir !== current.sprintDir || s.head !== current.head
      || s.spec_sha256 !== current.specSha256 || s.execution_context_sha256 !== current.executionContextSha256
      || !UUID.test(s.source_qa_stage_event_id ?? '') || s.source_round !== iv.escalation.round
      || s.applies_to_round !== s.source_round + 1 || s.applies_to_round !== current.round) continue;
    const accepted = (s.items ?? []).filter(item => (iv.escalation.cannot_verify ?? []).some(original =>
      original.id === item.id && sameItem(original, item) && (iv.rulings ?? []).some(r => r.issue === original.id && ACCEPT.has(r.verdict))));
    if (items.every(item => accepted.some(old => sameItem(item, old)))) return items.map(item => item.id);
  }
  return null;
}
export function commanderCvScope(worktree, intent, escalation, ruling, head, originalSpecSha256) {
  const c = escalation.qa_context;
  if (escalation.type !== 'qa_cannot_verify' || !validContext(c) || !UUID.test(c.qaStageEventId ?? '')
    || c.taskId !== intent.taskId || c.sprintDir !== intent.sprintDir || c.round !== escalation.round
    || c.specSha256 !== originalSpecSha256) return null;
  const items = (escalation.cannot_verify ?? []).filter(item => (ruling.rulings ?? []).some(r =>
    r.issue === item.id && ACCEPT.has(r.verdict)));
  if (!items.length) return null;
  return { schema_version: 1, task_id: c.taskId, sprint_dir: c.sprintDir, head,
    spec_sha256: hash(fs.readFileSync(path.join(worktree, intent.sprintDir, '02-spec.md'))),
    execution_context_sha256: c.executionContextSha256, source_qa_stage_event_id: c.qaStageEventId,
    source_round: c.round, applies_to_round: c.round + 1, items };
}
