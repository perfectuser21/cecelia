// 来源证明独立于产品QA：只信固定Git与受保护控制器事件，不消费候选提供的PASS。
import { execFileSync } from 'node:child_process';
import { childEnv } from '../../lib/protocol.mjs';
import { verifyRecordProvenance, verifyPendingStageEvidence, provenanceProjection } from '../../lib/record-provenance.mjs';

export const needsSourceProvenance = cfg => cfg.repoSlug === 'perfectuser21/cecelia';
export function sourceContext(cfg, worktree, intent, stage, round, controller) {
  if (!needsSourceProvenance(cfg)) return null;
  return { worktree, taskId: intent.taskId, sprintDir: intent.sprintDir, stage, round, controller };
}
export function verifySourceHead(cfg, worktree, intent, head, requiredQaRound) {
  if (!needsSourceProvenance(cfg)) return null;
  return verifyRecordProvenance({ worktree, taskId: intent.taskId, sprintDir: intent.sprintDir, head,
    ...(requiredQaRound !== undefined ? { requiredQaRound } : {}) });
}
export function judgeSourceFacts(cfg, worktree, intent, head, reportRel) {
  const committed = verifySourceHead(cfg, worktree, intent, head);
  if (!committed) return null;
  const pending = verifyPendingStageEvidence({ worktree, taskId: intent.taskId, sprintDir: intent.sprintDir, head }, [reportRel]);
  return { committed: provenanceProjection(committed), current_qa: provenanceProjection(pending) };
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
  return verifyRecordProvenance({ worktree: cfg.repo, taskId, sprintDir: dirs[0], head: pr.headRefOid, requiredQaRound });
}
