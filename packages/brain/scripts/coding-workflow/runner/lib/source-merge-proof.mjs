// 可信同步的独立严格读取器。事件只证明本地控制器提交，不声明远端推送或产品/QA通过。
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual as equal } from 'node:util';
import { controllerIdentity, verifyRecordProvenance } from '../../lib/record-provenance.mjs';
import { provenanceRoot, assertProvenanceSeparation } from '../../lib/provenance-path.mjs';
import { identity } from '../../lib/record-provenance-records.mjs';
import { REPO, MANIFEST, OWNER, hash, git, gitText, gitBytes, fixedHead, ancestor, events, safeRelative } from '../../lib/record-provenance-store.mjs';

export const mergeFail = code => { throw Error(`source_merge_${code}`); };
const exact = (o, keys) => o && typeof o === 'object' && !Array.isArray(o) && Object.keys(o).sort().join(',') === [...keys].sort().join(',');
const controllerRepo = gitText(path.dirname(fileURLToPath(import.meta.url)), 'rev-parse', '--show-toplevel');
export const mergeController = controllerIdentity(import.meta.url, ['./source-merge.mjs', './source-provenance.mjs', './cifix.mjs', './pr-branch.mjs', './proc.mjs', './qa-gate.mjs', './repos.mjs'].map(p => new URL(p, import.meta.url)));
for (const m of mergeController.modules) Object.freeze(m);Object.freeze(mergeController.modules);Object.freeze(mergeController);
export function mergeOptions(worktree, intent) {
  identity(intent);
  const root = assertProvenanceSeparation(provenanceRoot(), [worktree]);
  return { worktree, taskId: intent.taskId, sprintDir: intent.sprintDir, root };
}
function manifest(bytes) {
  let d;try { d = JSON.parse(bytes); } catch { mergeFail('manifest_invalid'); }
  if (bytes.length > 1024 * 1024 || !exact(d, ['schema_version', 'repo', 'relations']) || d.schema_version !== 1 || d.repo !== REPO || !Array.isArray(d.relations) || d.relations.length > 1024) mergeFail('manifest_invalid');
  const seen = new Set();
  for (const r of d.relations) {
    if (!exact(r, r?.role === 'verification_config' ? ['owner_path', 'path', 'role', 'ci_path', 'consumer_path'] : ['owner_path', 'path', 'role']) || !['documentation', 'release', 'verification', 'verification_config'].includes(r.role) || seen.has(r.path)) mergeFail('manifest_invalid');
    for (const key of ['owner_path', 'path', ...(r.role === 'verification_config' ? ['ci_path', 'consumer_path'] : [])]) safeRelative(r[key]);
    seen.add(r.path);
  }
  return d;
}
export function treeEntries(worktree, head) {
  const entries = new Map();
  for (const line of git(worktree, 'ls-tree', '-r', '-z', fixedHead(worktree, head)).toString('utf8').split('\0').filter(Boolean)) {
    const m = /^(\d{6}) (blob|commit) ([a-f0-9]{40})\t(.+)$/.exec(line);
    if (!m) mergeFail('tree_entry');safeRelative(m[4]);
    entries.set(m[4], { mode: m[1], oid: m[3] });
  }
  return entries;
}
const objectHash = (kind, bytes) => createHash('sha1').update(`${kind} ${bytes.length}\0`).update(bytes).digest('hex');
export function expectedTree(entries) {
  const root = new Map();
  for (const [file, data] of entries) {
    const parts = file.split('/');let node = root;
    for (const part of parts.slice(0, -1)) {
      if (!node.has(part)) node.set(part, new Map());
      node = node.get(part);if (!(node instanceof Map)) mergeFail('tree_collision');
    }
    if (node.has(parts.at(-1))) mergeFail('tree_collision');node.set(parts.at(-1), data);
  }
  const walk = node => {
    const ordered = [...node].sort(([a, av], [b, bv]) => Buffer.compare(Buffer.from(a + (av instanceof Map ? '/' : '')), Buffer.from(b + (bv instanceof Map ? '/' : ''))));
    return objectHash('tree', Buffer.concat(ordered.map(([name, value]) => Buffer.concat([
      Buffer.from(`${value instanceof Map ? '40000' : value.mode} ${name}\0`), Buffer.from(value instanceof Map ? walk(value) : value.oid, 'hex'),
    ]))));
  };
  return walk(root);
}
function touchedPaths(w, base, head, taskOnly = false) {
  const commits = gitText(w, 'rev-list', '--parents', ...(taskOnly ? ['--first-parent'] : []), `${base}..${head}`).split('\n').filter(Boolean);
  const paths = new Set();
  for (const line of commits) {
    const [commit, ...parents] = line.split(' ');
    // 已核的可信同步只引入上游，不把该merge差异算任务产品改动。
    if (taskOnly && parents.length !== 1) continue;
    if (!parents.length) mergeFail('history_root');
    for (const parent of parents) for (const file of changedPaths(w, parent, commit)) paths.add(file);
  }
  return [...paths].sort();
}
const changedPaths = (w, a, b) => git(w, 'diff', '--no-renames', '--name-only', '-z', a, b).toString('utf8').split('\0').filter(Boolean);

/** 固定Git、真实registration/stage/native为输入；不采信候选manifest的自述。 */
function makePlan(worktree, intent, before, main, verify) {
  const c = mergeOptions(worktree, intent);fixedHead(worktree, before);fixedHead(worktree, main);
  const bases = gitText(worktree, 'merge-base', '--all', before, main).split('\n');
  if (bases.length !== 1 || ancestor(worktree, main, before)) mergeFail('base_invalid');
  const base = bases[0], proof = verify({ ...c, head: before });
  const own = changedPaths(worktree, base, before).filter(f => f !== MANIFEST);
  const scope = [...new Set([...own, ...touchedPaths(worktree, base, before, true)])].filter(f => f !== MANIFEST).sort();
  const upstream = touchedPaths(worktree, base, main);
  if (upstream.some(f => scope.includes(f) || f.startsWith(`${intent.sprintDir}/`))) mergeFail('upstream_task_overlap');
  const bytes = { base: gitBytes(worktree, base, MANIFEST), before: gitBytes(worktree, before, MANIFEST), main: gitBytes(worktree, main, MANIFEST) };
  const docs = Object.fromEntries(Object.entries(bytes).map(([k, v]) => [k, manifest(v)]));
  const old = new Map(docs.base.relations.map(r => [r.path, r]));
  if (!equal(docs.before.relations.filter(r => old.has(r.path)), docs.base.relations)) mergeFail('branch_manifest_history');
  const additions = docs.before.relations.filter(r => !old.has(r.path));
  const records = new Map(proof.records.map(r => [r.path, r]));
  for (const row of additions) if (!equal(row, { owner_path: OWNER, path: row.path, role: 'documentation' }) || !records.has(row.path) || !row.path.startsWith(`${intent.sprintDir}/`)) mergeFail('unproven_addition');
  const mainRows = new Map(docs.main.relations.map(r => [r.path, r]));
  for (const record of proof.records.filter(r => r.path.endsWith('.md'))) {
    const required = { owner_path: OWNER, path: record.path, role: 'documentation' };
    if (mainRows.has(record.path) && !equal(mainRows.get(record.path), required)) mergeFail('main_relation_conflict');
    if (old.has(record.path) && !mainRows.has(record.path)) mergeFail('main_record_removed');
  }
  const stageIds = [...new Set(proof.records.map(r => r.stage_event_id))].sort();
  const all = events(c.root, c.taskId);
  const nativeIds = [...new Set(all.filter(e => e.kind === 'stage' && stageIds.includes(e.id)).flatMap(e => e.native_ids))].sort();
  const insert = additions.filter(r => !mainRows.has(r.path));
  if (docs.main.relations.length + insert.length > 1024) mergeFail('manifest_invalid');
  const text = bytes.main.toString('utf8'), match = /"relations"\s*:\s*\[/.exec(text);
  if (!match) mergeFail('manifest_invalid');
  const offset = match.index + match[0].length;
  const after = Buffer.from(insert.length ? text.slice(0, offset) + '\n' + insert.map(r => `    ${JSON.stringify(r)}`).join(',\n') + (docs.main.relations.length ? ',' : '') + text.slice(offset) : text);
  manifest(after);
  const entries = treeEntries(worktree, main), branch = treeEntries(worktree, before);
  for (const file of own) { if (branch.has(file)) entries.set(file, branch.get(file));else entries.delete(file); }
  entries.set(MANIFEST, { mode: '100644', oid: objectHash('blob', after) });
  return { c, before, main, base, own, scope, entries, after, tree: expectedTree(entries), proof,
    manifest: { mode: '100644', base: hash(bytes.base), before: hash(bytes.before), main: hash(bytes.main), after: hash(after) },
    input_ids: { registration: [...new Set(proof.records.map(r => r.registration_event_id))].sort(), stage: stageIds, native: nativeIds } };
}
export function sourceMergePlan(worktree, intent, before, main) {
  return makePlan(worktree, intent, before, main, verifyRecordProvenance);
}
export const remotePrArgs = number => ['pr', 'view', String(number), '--repo', REPO, '--json', 'state,headRefName,headRefOid,baseRefName,isCrossRepository,autoMergeRequest'];
export const remoteRefArgs = branch => ['ls-remote', '--refs', 'origin', 'refs/heads/main', `refs/heads/${branch}`];
export function validateRemoteObservation(o, before, main, branch, requireAutoOff = false) {
  if (!exact(o, ['repo', 'before', 'main', 'branch', 'pr_number', 'observed_at', 'remote_url', 'pr', 'refs']) || o.repo !== REPO || o.before !== before || o.main !== main || o.branch !== branch || !Number.isSafeInteger(o.pr_number) || o.pr_number < 1
    || !/^(?:https:\/\/github\.com\/|git@github\.com:)perfectuser21\/cecelia(?:\.git)?$/.test(o.remote_url ?? '') || (typeof o.observed_at !== 'string' || !Number.isFinite(Date.parse(o.observed_at)) || new Date(o.observed_at).toISOString() !== o.observed_at)) mergeFail('remote_contract');
  for (const [key, argv] of [['pr', remotePrArgs(o.pr_number)], ['refs', remoteRefArgs(branch)]]) {
    const r = o[key];if (!exact(r, ['argv', 'code', 'stdout', 'stdout_sha256']) || !equal(r.argv, argv) || r.code !== 0 || typeof r.stdout !== 'string' || r.stdout.length > 1024 * 1024 || hash(r.stdout) !== r.stdout_sha256) mergeFail('remote_capture');
  }
  let pr;try { pr = JSON.parse(o.pr.stdout); } catch { mergeFail('pr_unknown'); }
  if (pr.state !== 'OPEN') mergeFail('pr_closed');
  if (pr.baseRefName !== 'main' || pr.isCrossRepository !== false) mergeFail('pr_identity');
  if (pr.headRefName !== branch || pr.headRefOid !== before) mergeFail('pr_changed');
  if (requireAutoOff && pr.autoMergeRequest !== null) mergeFail('auto_still_enabled');
  const lines = o.refs.stdout.trim().split('\n').filter(Boolean).map(l => l.split('\t'));
  const refs = new Map(lines.map(([sha, ref]) => [ref, sha]));
  if (lines.length !== 2 || refs.size !== 2 || refs.get('refs/heads/main') !== main || refs.get(`refs/heads/${branch}`) !== before) mergeFail('remote_changed');
  return o;
}
function remoteProjection(o) {
  return { repo: o.repo, pr_number: o.pr_number, branch: o.branch, base_ref: 'main', same_repository: true, before: o.before, main: o.main, observed_at: o.observed_at,
    pr_stdout_sha256: o.pr.stdout_sha256, refs_stdout_sha256: o.refs.stdout_sha256 };
}
const EVENT_KEYS = ['schema_version', 'repo', 'task_id', 'id', 'digest', 'kind', 'sprint_dir', 'branch', 'base', 'before', 'main', 'commit', 'parents', 'tree', 'expected_tree', 'manifest', 'input_ids', 'product_paths', 'controller', 'evidence_scope', 'remote_before', 'remote_after_commit'];
function verifyEvent(c, e, verify) {
  if (!exact(e, EVENT_KEYS) || e.kind !== 'merge' || e.sprint_dir !== c.sprintDir || e.branch !== `cp-${c.sprintDir.split('/')[1]}` || e.evidence_scope !== 'local_controller_merge_only' || !exact(e.controller, ['revision', 'modules']) || !equal(e.controller.modules, mergeController.modules) || !ancestor(controllerRepo, e.controller.revision, mergeController.revision)) mergeFail('event_contract');
  validateRemoteObservation(e.remote_before, e.before, e.main, e.branch);
  validateRemoteObservation(e.remote_after_commit, e.before, e.main, e.branch);
  if (e.remote_before.pr_number !== e.remote_after_commit.pr_number || Date.parse(e.remote_before.observed_at) > Date.parse(e.remote_after_commit.observed_at)) mergeFail('remote_binding');
  const p = makePlan(c.worktree, c, e.before, e.main, verify);
  if (e.base !== p.base || e.tree !== p.tree || e.expected_tree !== p.tree || !equal(e.manifest, p.manifest) || !equal(e.input_ids, p.input_ids) || !equal(e.product_paths, p.scope.filter(f => !f.startsWith(`${c.sprintDir}/`))) || !equal(e.parents, [p.before, p.main])) mergeFail('event_binding');
  fixedHead(c.worktree, e.commit);
  if (gitText(c.worktree, 'show', '-s', '--format=%P', e.commit) !== e.parents.join(' ') || gitText(c.worktree, 'rev-parse', `${e.commit}^{tree}`) !== p.tree || !gitBytes(c.worktree, e.commit, MANIFEST).equals(p.after)) mergeFail('commit_binding');
  verify({ ...c, head: e.commit });
  return e;
}

/** 从本任务最早真实intent输入HEAD开始沿第一父链审每个merge，不能凭某个事件存在放行其它merge。 */
function walkSourceMerges(c, head, requiredQaRound, all, verify) {
  const { worktree } = c;
  const anchors = all.filter(e => e.kind === 'registration' && e.sprint_dir === c.sprintDir && e.records?.some(r => r.path === `${c.sprintDir}/01-intent.md`) && ancestor(worktree, e.commit, head));
  const earliest = anchors.filter(a => anchors.every(b => ancestor(worktree, a.commit, b.commit)));
  const anchorIds = [...new Set(earliest.map(e => e.commit))];if (anchorIds.length !== 1) mergeFail('anchor_missing');
  // registration完整重验后取得当时intent真实输入HEAD，覆盖首次publish以前的build提交。
  const first = verify({ ...c, head: anchorIds[0] });
  const anchor = first.records.find(r => r.path === `${c.sprintDir}/01-intent.md`)?.stage_input_head;
  if (!anchor) mergeFail('anchor_missing');
  const history = gitText(worktree, 'rev-list', '--first-parent', '--max-count=10001', head).split('\n');
  const end = history.indexOf(anchor);if (end < 0) mergeFail('anchor_history');
  const selected = [];
  for (const commit of history.slice(0, end).reverse()) {
    const parents = gitText(worktree, 'show', '-s', '--format=%P', commit).split(' ');
    if (parents.length === 1) continue;
    const matching = all.filter(e => e.kind === 'merge' && e.commit === commit);
    if (parents.length !== 2 || matching.length !== 1) mergeFail('receipt_missing_or_duplicate');
    selected.push(verifyEvent(c, matching[0], verify));
  }
  // 原QA的ancestor条件不足以允许跨同步批准；同步之后必须实测新HEAD。
  if (requiredQaRound !== undefined && selected.length) {
    const proof = verify({ ...c, head, requiredQaRound });
    const qa = proof.records.find(r => r.path === `${c.sprintDir}/05-qa-report-r${requiredQaRound}.md`);
    if (!qa || !selected.every(e => ancestor(worktree, e.commit, qa.stage_input_head))) mergeFail('qa_before_sync');
  }
  return selected.map(e => ({ event_id: e.id, base: e.base, before: e.before, main: e.main, commit: e.commit, parents: e.parents, tree: e.tree,
    manifest: e.manifest, input_ids: e.input_ids, controller: e.controller, remote_before: remoteProjection(e.remote_before), remote_after_commit: remoteProjection(e.remote_after_commit), evidence_scope: e.evidence_scope }));
}

/** 仅同一次调用、相同精确HEAD/QA轮次复用；调用结束重读全部事件摘要，变化即拒绝。无进程级缓存。 */
export function verifySourceChain(worktree, intent, head, requiredQaRound) {
  const c = mergeOptions(worktree, intent);fixedHead(worktree, head);
  const all = events(c.root, c.taskId), signature = rows => rows.map(e => `${e.id}:${e.digest}`).sort();
  const memo = new Map();
  const verify = options => {
    const key = `${options.head}:${options.requiredQaRound ?? 'none'}`;
    if (!memo.has(key)) memo.set(key, verifyRecordProvenance(options));
    return memo.get(key);
  };
  const proof = verify({ ...c, head, ...(requiredQaRound !== undefined ? { requiredQaRound } : {}) });
  const sync = walkSourceMerges(c, head, requiredQaRound, all, verify);
  if (!equal(signature(all), signature(events(c.root, c.taskId)))) mergeFail('events_changed_during_read');
  return { proof, sync };
}
export function verifySourceMerges(worktree, intent, head, requiredQaRound) {
  return verifySourceChain(worktree, intent, head, requiredQaRound).sync;
}
