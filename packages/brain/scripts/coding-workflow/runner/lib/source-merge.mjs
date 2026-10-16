// 无模型的受控三方同步。私有token只授权当前完整事务的manifest；持久事件供后续独立读取。
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { REPO, MANIFEST, git, gitText, hash, writeEvent, workingBytes, workingMode } from '../../lib/record-provenance-store.mjs';
import { sourceMergePlan, verifySourceMerges, mergeController, mergeFail, validateRemoteObservation, remotePrArgs, remoteRefArgs } from './source-merge-proof.mjs';
import { gh, git as remoteGit } from './proc.mjs';
import { verifySourceHead } from './source-provenance.mjs';
const tokens = new WeakMap();
const RUNNER = ['-c', 'user.name=coding-workflow-runner', '-c', 'user.email=coding-workflow-runner@cecelia.local'];
function clean(w) { if (gitText(w, 'status', '--porcelain')) mergeFail('uncommitted'); }
export async function observeSourceRemote(cfg, worktree, pr, before, main, requireAutoOff = false) {
  if (cfg.repoSlug !== REPO) mergeFail('repo');
  const branch = pr.headRefName, prArgs = remotePrArgs(pr.number), refArgs = remoteRefArgs(branch);
  const reply = await gh(cfg, prArgs, { timeoutMs: 60000 });
  const refs = await remoteGit(worktree, refArgs, { timeoutMs: 60000 });
  const capture = (argv, r) => ({ argv, code: r.code, stdout: r.stdout, stdout_sha256: hash(r.stdout) });
  return validateRemoteObservation({ repo: REPO, before, main, branch, pr_number: pr.number, observed_at: new Date().toISOString(),
    remote_url: gitText(worktree, 'remote', 'get-url', 'origin'), pr: capture(prArgs, reply), refs: capture(refArgs, refs) }, before, main, branch, requireAutoOff);
}
export async function createSourceMerge(cfg, worktree, intent, before, main, pr) {
  clean(worktree);
  if (gitText(worktree, 'rev-parse', 'HEAD') !== before || gitText(worktree, 'branch', '--show-current') !== `cp-${path.basename(intent.sprintDir)}`) mergeFail('head_or_branch');
  verifySourceHead(cfg, worktree, intent, before);
  const remoteBefore = await observeSourceRemote(cfg, worktree, pr, before, main);
  const p = sourceMergePlan(worktree, intent, before, main);
  // 不调用merge driver，不给模型写index/提交机会。index由main完整树和已核的PR路径确定。
  git(worktree, 'read-tree', '--reset', main);
  for (const file of p.own) {
    const e = p.entries.get(file);
    if (e) git(worktree, 'update-index', '--add', '--cacheinfo', e.mode, e.oid, file);
    else git(worktree, 'update-index', '--force-remove', '--', file);
  }
  const tmp = path.join(path.dirname(worktree), `.source-merge-${randomUUID()}`);
  let blob;
  try { fs.writeFileSync(tmp, p.after, { flag: 'wx', mode: 0o600 });blob = gitText(worktree, 'hash-object', '--no-filters', '-w', tmp); }
  finally { fs.rmSync(tmp, { force: true }); }
  git(worktree, 'update-index', '--add', '--cacheinfo', '100644', blob, MANIFEST);
  if (gitText(worktree, 'write-tree') !== p.tree || gitText(worktree, 'rev-parse', 'HEAD') !== before) mergeFail('index_or_head');
  const commit = gitText(worktree, ...RUNNER, 'commit-tree', p.tree, '-p', before, '-p', main, '-m', 'chore(cw): controller source-preserving main synchronization');
  // 恢复旧index后才移动HEAD，reset能准确清理main已删除的旧工作区文件。
  git(worktree, 'read-tree', '--reset', before);
  git(worktree, 'update-ref', 'HEAD', commit, before);
  git(worktree, 'reset', '--hard', commit);clean(worktree);
  if (hash(workingBytes(worktree, MANIFEST)) !== p.manifest.after || workingMode(worktree, MANIFEST) !== '100644') mergeFail('working_manifest');
  const remoteAfterCommit = await observeSourceRemote(cfg, worktree, pr, before, main);
  const event = writeEvent(p.c.root, intent.taskId, { kind: 'merge', sprint_dir: intent.sprintDir, branch: `cp-${path.basename(intent.sprintDir)}`,
    base: p.base, before, main, commit, parents: [before, main], tree: p.tree, expected_tree: p.tree, manifest: p.manifest,
    input_ids: p.input_ids, product_paths: p.scope.filter(f => !f.startsWith(`${intent.sprintDir}/`)), controller: mergeController, evidence_scope: 'local_controller_merge_only', remote_before: remoteBefore, remote_after_commit: remoteAfterCommit });
  const readback = verifySourceMerges(worktree, intent, commit);
  if (readback.at(-1)?.event_id !== event.id) mergeFail('receipt_readback');
  const token = Object.freeze({});tokens.set(token, { worktree: fs.realpathSync(worktree), intent, before, main, commit, tree: p.tree, eventId: event.id });
  return { token, commit, eventId: event.id, main, before };
}
/** 公共字符串allow、伪造对象、别的worktree/HEAD/index、重复消费均不给例外。 */
export function consumeSourceMerge(token, worktree, before, mainRef) {
  const t = tokens.get(token);if (!t) mergeFail('token');tokens.delete(token);
  if (fs.realpathSync(worktree) !== t.worktree || before !== t.before || mainRef !== t.main || gitText(worktree, 'rev-parse', 'HEAD') !== t.commit || gitText(worktree, 'write-tree') !== t.tree) mergeFail('token_binding');
  clean(worktree);
  if (verifySourceMerges(worktree, t.intent, t.commit).at(-1)?.event_id !== t.eventId) mergeFail('token_receipt');
  return MANIFEST;
}
