// 来源证明独立于产品QA：只信固定Git与受保护控制器事件，不消费候选提供的PASS。
import { execFileSync } from 'node:child_process';
import { verifySourceChain } from './source-merge-proof.mjs';
import { childEnv } from '../../lib/protocol.mjs';
import { verifyPendingStageEvidence, verifyRegisteredQaEvidence, provenanceProjection } from '../../lib/record-provenance.mjs';

export const needsSourceProvenance = cfg => cfg.repoSlug === 'perfectuser21/cecelia';
export function sourceContext(cfg, worktree, intent, stage, round, controller) {
  if (!needsSourceProvenance(cfg)) return null;
  return { worktree, taskId: intent.taskId, sprintDir: intent.sprintDir, stage, round, controller };
}
function verifiedSource(cfg, worktree, intent, head, requiredQaRound) {
  if (!needsSourceProvenance(cfg)) return null;
  return verifySourceChain(worktree, intent, head, requiredQaRound);
}
export function verifySourceHead(cfg, worktree, intent, head, requiredQaRound) {
  return verifiedSource(cfg, worktree, intent, head, requiredQaRound)?.proof ?? null;
}
export function sourceFacts(worktree, intent, head) {
  const { proof, sync } = verifiedSource({ repoSlug: 'perfectuser21/cecelia' }, worktree, intent, head);
  return { ...provenanceProjection(proof), sync };
}
export function judgeSourceFacts(cfg, worktree, intent, head, reportRel, options = {}) {
  const checked = verifiedSource(cfg, worktree, intent, head);
  if (!checked) return null;
  const { proof: committed, sync } = checked;
  const { mode, stageEventId, testedHead, round } = options;
  if (!['pending', 'registered'].includes(mode) || !Number.isSafeInteger(round) || round < 1
    || reportRel !== `${intent.sprintDir}/05-qa-report-r${round}.md`) throw Error('record_provenance_qa_selector');
  const selected = { worktree, taskId: intent.taskId, sprintDir: intent.sprintDir, head, stageEventId, testedHead, round };
  if (mode === 'pending' && testedHead !== head) throw Error('record_provenance_qa_tested_head');
  const pending = mode === 'registered' ? verifyRegisteredQaEvidence(selected, reportRel) : verifyPendingStageEvidence(selected, [reportRel]);
  return { committed: provenanceProjection(committed), current_qa: provenanceProjection(pending), sync };
}
// merge门不检出候选：从精确Git对象读唯一任务身份，core再核完整树/提交链。
export function verifyMergeSource(cfg, pr, requiredQaRound) {
  if (!needsSourceProvenance(cfg)) return null;
  if (!Number.isSafeInteger(requiredQaRound) || requiredQaRound < 1) throw new Error('record_provenance_approval_round_invalid');
  const git = args => execFileSync('git', ['-C', cfg.repo, ...args], { encoding: 'utf8', env: childEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
  if (!/^[0-9a-f]{40}$/.test(pr.headRefOid)) throw new Error('record_provenance_head_invalid');
  const dirs = git(['ls-tree', '--name-only', pr.headRefOid, 'sprints/']).trim().split('\n')
    .filter(p => p.endsWith(`-cw-${pr.headRefName.slice(-8)}`));
  if (dirs.length !== 1) throw new Error('record_provenance_identity_missing');
  const text = git(['show', `${pr.headRefOid}:${dirs[0]}/01-intent.md`]);
  const taskId = /^task_id:\s*(\S+)/m.exec(text)?.[1];
  if (!taskId) throw new Error('record_provenance_identity_missing');
  return verifySourceHead(cfg, cfg.repo, { taskId, sprintDir: dirs[0] }, pr.headRefOid, requiredQaRound);
}
