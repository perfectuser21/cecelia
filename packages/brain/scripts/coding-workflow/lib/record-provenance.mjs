// 受信控制器当时观察的阶段/登记事实；哈希不代替 verify/evaluate 的命令语义核验。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { provenanceRoot, assertProvenanceSeparation } from './provenance-path.mjs';
import { REPO, MANIFEST, OWNER, UUID, SHA, hash, fail, git, gitText, fixedHead, ancestor, noLinks, workingBytes, workingMode, gitBytes, gitMode, sourceManifest, writeEvent, events } from './record-provenance-store.mjs';
import { startQaIsolation, verifyQaIsolation, isolationProjection } from './qa-isolation.mjs';
import { identity, recordType, inspectRecord, workingRecord, branchIdentity, listRecords } from './record-provenance-records.mjs';

const storage = new AsyncLocalStorage(), transactions = new WeakMap();
const STAGES = new Set(['intent', 'spec', 'spec_review', 'build', 'verify', 'evaluate', 'judge', 'commander']);
const ownUrls = [import.meta.url, new URL('./record-provenance-store.mjs', import.meta.url), new URL('./record-provenance-records.mjs', import.meta.url), new URL('./provenance-path.mjs', import.meta.url), new URL('./qa-isolation.mjs', import.meta.url)];
const ownBytes = new Map(ownUrls.map(url => { const file = fileURLToPath(url);noLinks(file);return [file, hash(fs.readFileSync(file))]; }));
const clone = value => JSON.parse(JSON.stringify(value));
function controllerValid(c) {
  if (!c || !SHA.test(c.revision ?? '') || !Array.isArray(c.modules) || !c.modules.length || c.modules.some(m => typeof m.path !== 'string' || !/^[a-f0-9]{64}$/.test(m.sha256 ?? ''))) fail('controller_identity');
  return clone(c);
}
/** 应由可信模块初始化时调用；revision和实际字节分别记录，dirty代码不冒充Git原文。 */
export function controllerIdentity(entryUrl, dependencyUrls = []) {
  const entry = fileURLToPath(entryUrl), repo = gitText(path.dirname(entry), 'rev-parse', '--show-toplevel');
  const files = [...new Set([entryUrl, ...dependencyUrls, ...ownUrls].map(u => fileURLToPath(u)))];
  return { revision: gitText(repo, 'rev-parse', 'HEAD'), modules: files.map(file => {
    noLinks(file);if (!fs.statSync(file).isFile()) fail('controller_file');
    return { path: path.relative(repo, file), sha256: ownBytes.get(file) ?? hash(fs.readFileSync(file)) };
  }).sort((a, b) => a.path.localeCompare(b.path)) };
}
export function provenanceRequired(worktree) {
  let origin = '';try { origin = gitText(worktree, 'remote', 'get-url', 'origin'); } catch { /* generic repos may lack origin */ }
  if (/^(?:https:\/\/github\.com\/|git@github\.com:)perfectuser21\/cecelia(?:\.git)?$/.test(origin)) return true;
  if (fs.existsSync(path.join(worktree, MANIFEST))) {
    let data;try { data = JSON.parse(workingBytes(worktree, MANIFEST)); } catch { fail('manifest_invalid'); }
    if (data.repo === REPO) fail('repo_mismatch');
  }
  return false;
}
function config(options, writing = false) {
  const c = { ...options, root: options.root ?? storage.getStore()?.root ?? provenanceRoot() };
  identity(c);c.worktree = fs.realpathSync(c.worktree);
  if (!provenanceRequired(c.worktree)) fail('repo_mismatch');
  c.root = assertProvenanceSeparation(c.root, [c.worktree]);
  if (writing) branchIdentity(c);
  return c;
}
export function hasRecordProvenanceContext() { return Boolean(storage.getStore()); }
export function withRecordProvenance(options, fn) {
  const c = config(options, true);
  if (!(STAGES.has(c.stage) || c.stage === 'publish') || !Number.isSafeInteger(c.round ?? 0) || (c.round ?? 0) < 0) fail('stage_invalid');
  c.controller = controllerValid(c.controller);c.round ??= 0;c.runId ??= randomUUID();
  if (!UUID.test(c.runId)) fail('run_invalid');
  c.native = [];c.startedHead = gitText(c.worktree, 'rev-parse', 'HEAD');
  return storage.run(c, fn);
}
/** 只有可信 evaluate 父控制器可开启；身份从本次 context 取，不接受模型字段。 */
export function beginEvaluateIsolation() {
  const c = storage.getStore();if (!c) return null;
  if (c.stage !== 'evaluate' || c.isolation) fail('isolation_context');
  c.isolation = startQaIsolation(c);
  return Object.freeze({ restore: () => c.isolation.restore(), abort: () => c.isolation.abort(), hiddenFacts: () => c.isolation.hiddenFacts() });
}
function nativeSucceeded(run) {
  if (run.provider !== 'codex' || run.code !== 0 || run.timedOut || run.terminated || typeof run.stdout !== 'string') return false;
  const rows = run.stdout.split('\n').filter(Boolean).map(line => { try { return JSON.parse(line); } catch { return null; } });
  return rows.some(e => e?.type === 'thread.started' && typeof e.thread_id === 'string') && rows.some(e => e?.type === 'turn.completed') && !rows.some(e => e?.type === 'turn.failed' || e?.type === 'error');
}
/** 仅接收父控制器直接捕获的原生stdout，不从模型生成文件反读。 */
export function captureNativeExecution(run) {
  const c = storage.getStore();if (!c) return null;
  let hiddenId, isolationError;
  if (c.stage === 'evaluate') {
    if (!c.isolation) fail('isolation_missing');
    try { hiddenId = c.isolation.assertActive(); } catch (error) { isolationError = error; }
  }
  const data = { kind: 'native', ...(isolationError ? { isolation_error: isolationError.message } : {}), ...(hiddenId ? { isolation_hidden_event_id: hiddenId } : {}), run_id: c.runId, sprint_dir: c.sprintDir, stage: c.stage, round: c.round, controller: c.controller,
    provider: run.provider ?? null, model: run.model ?? null, tag: run.tag ?? null, code: run.code ?? null,
    timed_out: Boolean(run.timedOut), terminated: Boolean(run.terminated), stdout: typeof run.stdout === 'string' ? run.stdout : '',
    success: nativeSucceeded(run) };
  const event = writeEvent(c.root, c.taskId, data);c.native.push(event.id);
  // 即使隔离边界破坏也保留真实管道原文，但不能将它绑定为成功隔离。
  if (isolationError) throw isolationError;
  if (c.stage === 'evaluate') c.isolation.capture(event);return event;
}
function eventBase(c) { return { sprint_dir: c.sprintDir, run_id: c.runId, controller: c.controller }; }
export function sealStageEvidence({ files, result, producer = 'model', controllerInput, round, nativeIds } = {}) {
  const c = storage.getStore();if (!c) return null;
  if (!STAGES.has(c.stage) || result?.status !== 'completed' || !['model', 'controller', 'controller_render'].includes(producer)) fail('stage_not_completed');
  if (producer === 'controller' && c.stage !== 'intent') fail('producer_invalid');
  if (producer === 'controller_render' && !['judge', 'commander'].includes(c.stage)) fail('producer_invalid');
  const r = round ?? c.round;if (!Number.isSafeInteger(r) || r < 0) fail('round_invalid');
  if (!Array.isArray(files) || !files.length || new Set(files).size !== files.length) fail('files_invalid');
  const ids = nativeIds ?? [...c.native], all = c.native.length ? events(c.root, c.taskId) : [];
  if (!Array.isArray(ids) || ids.some(id => !c.native.includes(id))) fail('native_context');
  const natives = ids.map(id => all.find(e => e.id === id));
  if (producer !== 'controller' && (!ids.includes(c.native.at(-1)) || !natives.length || !all.find(e => e.id === c.native.at(-1))?.success || !natives.some(e => e?.kind === 'native' && e.run_id === c.runId && e.success))) fail('native_missing');
  if (producer === 'controller_render' && (!controllerInput || typeof controllerInput !== 'object')) fail('render_input_missing');
  const records = files.map(file => workingRecord(c, file, c.stage, r));
  const isolationId = c.stage === 'evaluate' ? c.isolation?.completed() : null;
  if (c.stage === 'evaluate' && !isolationId) fail('isolation_missing');
  return writeEvent(c.root, c.taskId, { kind: 'stage', ...eventBase(c), stage: c.stage, round: r, producer,
    head_before: c.startedHead, head_after: gitText(c.worktree, 'rev-parse', 'HEAD'), records,
    ...(isolationId ? { isolation_event_id: isolationId } : {}),
    native_ids: ids, current_native_id: c.native.at(-1) ?? null, result: clone(result), ...(controllerInput ? { controller_input: clone(controllerInput) } : {}) });
}
function validateStage(c, stage, all) {
  if (stage.kind !== 'stage' || stage.sprint_dir !== c.sprintDir || !STAGES.has(stage.stage) || stage.result?.status !== 'completed' || !Array.isArray(stage.records)) fail('stage_invalid');
  controllerValid(stage.controller);
  if (stage.producer === 'controller') { if (stage.stage !== 'intent') fail('producer_invalid'); }
  else {
    if (!['model', 'controller_render'].includes(stage.producer) || !Array.isArray(stage.native_ids)) fail('producer_invalid');
    const native = stage.native_ids.map(id => all.find(e => e.id === id));
    const current = native.find(n => n?.id === stage.current_native_id);
    if (!current || current.id !== stage.native_ids.at(-1) || JSON.stringify(current.controller) !== JSON.stringify(stage.controller) || !current.success || !nativeSucceeded({ provider: current.provider, code: current.code, timedOut: current.timed_out, terminated: current.terminated, stdout: current.stdout })) fail('native_missing');
    if (!native.some(n => n?.kind === 'native' && n.run_id === stage.run_id && n.stage === stage.stage && n.sprint_dir === c.sprintDir && n.success && nativeSucceeded({ provider: n.provider, code: n.code, timedOut: n.timed_out, terminated: n.terminated, stdout: n.stdout }))) fail('native_missing');
    if (stage.producer === 'controller_render' && (!['judge', 'commander'].includes(stage.stage) || !stage.controller_input)) fail('render_input_missing');
  }
  if (stage.isolation_event_id !== undefined) verifyQaIsolation(c, stage, all);
}
function findStage(c, record, head, all, stageEventId, qaStageEventId) {
  const matching = all.filter(e => (!stageEventId || e.id === stageEventId) && (!qaStageEventId || e.controller_input?.qa_stage_event_id === qaStageEventId) && e.kind === 'stage' && e.sprint_dir === c.sprintDir && e.records?.some(r => r.path === record.path && r.sha256 === record.sha256 && r.mode === record.mode) && ancestor(c.worktree, e.head_after, head));
  for (const e of matching.reverse()) {
    validateStage(c, e, all);const r = e.records.find(x => x.path === record.path && x.sha256 === record.sha256 && x.mode === record.mode);
    const type = recordType(r.path, c.sprintDir);
    if (!type.stages.includes(e.stage) || (type.round && type.round !== r.round)) continue;
    return { stage: e, record: r };
  }
  fail('stage_missing');
}
function manifestDelta(beforeBytes, afterBytes, records) {
  const before = sourceManifest(beforeBytes), after = sourceManifest(afterBytes), old = new Map(before.relations.map(r => [r.path, r]));
  for (const [p, r] of old) if (JSON.stringify(after.relations.find(x => x.path === p)) !== JSON.stringify(r)) fail('manifest_history_changed');
  const allowed = new Set(records.filter(r => r.markdown).map(r => r.path));
  for (const r of after.relations) if (!old.has(r.path) && (!allowed.has(r.path) || r.owner_path !== OWNER || r.role !== 'documentation' || Object.keys(r).length !== 3)) fail('manifest_delta_invalid');
  for (const p of allowed) { const r = after.relations.find(x => x.path === p);if (!r || r.owner_path !== OWNER || r.role !== 'documentation' || Object.keys(r).length !== 3) fail('relation_missing'); }
  return after.relations.filter(r => !old.has(r.path));
}
function registrationFor(c, record, head, all) {
  const lastChange = gitText(c.worktree, 'log', '-1', '--format=%H', head, '--', record.path);
  for (const e of all.filter(x => x.kind === 'registration').reverse()) {
    const r = e.records?.find(x => x.path === record.path && x.sha256 === record.sha256 && x.mode === record.mode);
    if (!r || e.sprint_dir !== c.sprintDir || !ancestor(c.worktree, e.commit, head) || !ancestor(c.worktree, lastChange, e.commit)) continue;
    controllerValid(e.controller);
    if (!ancestor(c.worktree, e.head_before, e.commit) || JSON.stringify(e.parents) !== JSON.stringify([e.head_before])) fail('registration_history');
    if (gitText(c.worktree, 'rev-parse', `${e.commit}^{tree}`) !== e.tree || JSON.stringify(gitText(c.worktree, 'show', '-s', '--format=%P', e.commit).split(' ').filter(Boolean)) !== JSON.stringify(e.parents)) fail('registration_git_mismatch');
    if (hash(gitBytes(c.worktree, e.commit, record.path)) !== record.sha256 || gitMode(c.worktree, e.commit, record.path) !== record.mode || hash(gitBytes(c.worktree, e.head_before, MANIFEST)) !== e.manifest_before || hash(gitBytes(c.worktree, e.commit, MANIFEST)) !== e.manifest_after) fail('registration_git_mismatch');
    manifestDelta(gitBytes(c.worktree, e.head_before, MANIFEST), gitBytes(c.worktree, e.commit, MANIFEST), e.records);
    const stage = all.find(s => s.id === r.stage_event_id);if (!stage) fail('stage_missing');validateStage(c, stage, all);
    if (!stage.records.some(s => s.path === r.path && s.sha256 === r.sha256 && s.mode === r.mode) || !ancestor(c.worktree, stage.head_after, e.head_before)) fail('stage_binding');
    return { event: e, stage, record: r };
  }
  fail('registration_missing');
}
export function beginRecordRegistration(options, files) {
  const c = config(options, true);c.controller = controllerValid(c.controller);
  if (!['publish', 'qa', 'commander'].includes(c.stage) || !Array.isArray(files) || !files.length || new Set(files).size !== files.length) fail('registration_invalid');
  const head = gitText(c.worktree, 'rev-parse', 'HEAD'), all = events(c.root, c.taskId);
  if (c.stage === 'qa' && !UUID.test(c.qaStageEventId ?? '')) fail('qa_stage_selector_missing');
  const records = files.map(file => {
    const rec = workingRecord(c, file), type = recordType(file, c.sprintDir);
    const found = findStage(c, rec, head, all, c.stage === 'qa' && type.stages.includes('evaluate') ? c.qaStageEventId : undefined,
      c.stage === 'qa' && type.stages.includes('judge') ? c.qaStageEventId : undefined);
    if (c.stage === 'qa' && (found.stage.stage === 'evaluate'
      ? found.stage.id !== c.qaStageEventId : found.stage.controller_input?.qa_stage_event_id !== c.qaStageEventId)) fail('qa_stage_binding');
    if ((c.stage === 'publish' && !['intent', 'spec', 'spec_review', 'build', 'verify'].includes(found.stage.stage)) ||
      (c.stage === 'qa' && !['evaluate', 'judge'].includes(found.stage.stage)) ||
      (c.stage === 'commander' && found.stage.stage !== 'commander') || (type.round && type.round !== c.round && c.stage !== 'publish')) fail('registration_stage');
    return { ...rec, stage_event_id: found.stage.id };
  });
  const before = gitBytes(c.worktree, head, MANIFEST);
  if (!workingBytes(c.worktree, MANIFEST).equals(before)) fail('manifest_uncommitted');
  const token = Object.freeze({ id: randomUUID() });
  transactions.set(token, { c, head, before, records, observed: false });return token;
}
export function observeRecordRegistration(token, returnedSourcePaths) {
  const t = transactions.get(token);if (!t || t.observed || !Array.isArray(returnedSourcePaths) || returnedSourcePaths.some(p => p !== MANIFEST) || returnedSourcePaths.length > 1) fail('registration_token');
  if (gitText(t.c.worktree, 'rev-parse', 'HEAD') !== t.head) fail('head_moved');
  for (const r of t.records) if (hash(workingBytes(t.c.worktree, r.path)) !== r.sha256 || workingMode(t.c.worktree, r.path) !== r.mode) fail('record_changed');
  const after = workingBytes(t.c.worktree, MANIFEST), additions = manifestDelta(t.before, after, t.records);
  if (Boolean(returnedSourcePaths.length) !== !after.equals(t.before)) fail('registration_result');
  t.after = after;t.additions = additions;t.observed = true;
}
export function finalizeRecordRegistration(token) {
  const t = transactions.get(token);if (!t?.observed) fail('registration_unobserved');
  transactions.delete(token);
  const { c } = t, commit = gitText(c.worktree, 'rev-parse', 'HEAD');
  if (!ancestor(c.worktree, t.head, commit) || !gitBytes(c.worktree, commit, MANIFEST).equals(t.after)) fail('commit_invalid');
  for (const r of t.records) if (hash(gitBytes(c.worktree, commit, r.path)) !== r.sha256 || hash(workingBytes(c.worktree, r.path)) !== r.sha256 || workingMode(c.worktree, r.path) !== r.mode || gitMode(c.worktree, commit, r.path) !== r.mode) fail('commit_record_changed');
  if (commit === t.head) {
    const all = events(c.root, c.taskId), prior = t.records.map(r => registrationFor(c, r, commit, all));
    transactions.delete(token);return { reused: true, event_ids: [...new Set(prior.map(x => x.event.id))], commit };
  }
  if (gitText(c.worktree, 'show', '-s', '--format=%P', commit) !== t.head) fail('commit_parent');
  const e = writeEvent(c.root, c.taskId, { kind: 'registration', sprint_dir: c.sprintDir, run_id: randomUUID(), stage: c.stage, round: c.round ?? 0,
    controller: c.controller, head_before: t.head, commit, tree: gitText(c.worktree, 'rev-parse', `${commit}^{tree}`), parents: gitText(c.worktree, 'show', '-s', '--format=%P', commit).split(' ').filter(Boolean),
    registrar: { function: 'registerRecordSources', returned_source_paths: t.after.equals(t.before) ? [] : [MANIFEST] },
    manifest_before: hash(t.before), manifest_after: hash(t.after), additions: t.additions, records: t.records });
  transactions.delete(token);return e;
}
const baseResult = (c, head, status, records) => ({ schema_version: 1, status, repo: REPO, task_id: c.taskId, sprint_dir: c.sprintDir, head, records,
  evidence_scope: 'controller_registration_and_stage_capture', command_semantics: 'existing_verify_evaluate_checks' });
function verifyQaRound(c, head, records, all) {
  const round = c.requiredQaRound;
  if (!Number.isSafeInteger(round) || round < 1) fail('qa_round_invalid');
  const qaRecord = records.find(r => r.path === `${c.sprintDir}/05-qa-report-r${round}.md`);
  const judgeRecord = records.find(r => r.path === `${c.sprintDir}/06-judge-r${round}.md`);
  if (!qaRecord || !judgeRecord) fail('qa_proof_missing');
  const qa = all.find(e => e.id === qaRecord.stage_event_id), judge = all.find(e => e.id === judgeRecord.stage_event_id);
  if (qa?.stage !== 'evaluate' || qa.producer !== 'model' || qa.round !== round || qa.result?.outputs?.qa?.verdict !== 'PASS' || qa.result.outputs.qa.round !== round || qa.head_before !== qa.head_after || !ancestor(c.worktree, qa.head_before, head)) fail('qa_pass_missing');
  verifyQaIsolation(c, qa, all);
  if (judge?.stage !== 'judge' || judge.producer !== 'controller_render' || judge.round !== round || judge.result?.outputs?.judge_verdict !== 'PASS' || judge.controller_input?.decision?.verdict !== 'PASS' || judge.controller_input.round !== round || judge.controller_input.qa_stage_event_id !== qa.id || judge.controller_input.tested_head !== qa.head_before || !ancestor(c.worktree, qa.head_before, judge.head_before)) fail('judge_pass_missing');
}
export function verifyRecordProvenance(options) {
  const c = config(options), head = fixedHead(c.worktree, c.head), all = events(c.root, c.taskId), files = listRecords(c, head);
  if (!files.length || !files.includes(`${c.sprintDir}/01-intent.md`)) fail('records_missing');
  const manifest = sourceManifest(gitBytes(c.worktree, head, MANIFEST));
  const present = new Set(files);
  for (const r of manifest.relations) if (r.path.startsWith(`${c.sprintDir}/`) && !present.has(r.path)) fail('record_deleted');
  for (const e of all.filter(e => e.kind === 'registration' && e.sprint_dir === c.sprintDir && ancestor(c.worktree, e.commit, head))) {
    if (!Array.isArray(e.records) || e.records.some(r => !present.has(r.path))) fail('record_deleted');
  }
  const records = files.map(file => {
    const record = inspectRecord(c, file, gitBytes(c.worktree, head, file), null, null, gitMode(c.worktree, head, file));
    if (record.markdown && !manifest.relations.some(r => r.path === file && r.owner_path === OWNER && r.role === 'documentation')) fail('relation_missing');
    const { event, stage } = registrationFor(c, record, head, all);
    return { path: file, mode: record.mode, sha256: record.sha256, stage: stage.stage, round: record.round, producer: stage.producer, stage_event_id: stage.id, stage_input_head: stage.head_before, registration_event_id: event.id, commit: event.commit };
  });
  if (c.requiredQaRound !== undefined) verifyQaRound(c, head, records, all);
  return baseResult(c, head, 'verified', records);
}
/** 仅证明当前待提交字节已被当时stage接收；即便文件已提交也不在此接口声明登记成功。 */
export function verifyPendingStageEvidence(options, files) {
  const c = config(options), head = fixedHead(c.worktree, c.head);
  if (gitText(c.worktree, 'rev-parse', 'HEAD') !== head) fail('head_moved');
  const all = events(c.root, c.taskId);
  if (!Array.isArray(files) || !files.length) fail('files_invalid');
  let isolation;
  const records = files.map(file => {
    const record = workingRecord(c, file), type = recordType(file, c.sprintDir);
    if (type.stages.includes('evaluate') && !UUID.test(c.stageEventId ?? '')) fail('qa_stage_selector_missing');
    const { stage } = findStage(c, record, head, all, type.stages.includes('evaluate') ? c.stageEventId : undefined);
    if (/\/05-qa-report-r[1-9]\d*\.md$/.test(file)) isolation = verifyQaIsolation({ ...c, head }, stage, all, true);
    return { path: file, mode: record.mode, sha256: record.sha256, stage: stage.stage, round: record.round, producer: stage.producer, stage_event_id: stage.id, stage_input_head: stage.head_before };
  });
  return { ...baseResult(c, head, 'sealed_not_registered', records), ...(isolation ? { isolation } : {}) };
}
/** 已登记 QA 的独立裁判重试：只允许原测试之后的本轮受保护记录提交。 */
export function verifyRegisteredQaEvidence(options, reportRel) {
  const c = config(options), head = fixedHead(c.worktree, c.head);
  if (!UUID.test(c.stageEventId ?? '') || !SHA.test(c.testedHead ?? '') || !Number.isSafeInteger(c.round) || c.round < 1
    || reportRel !== `${c.sprintDir}/05-qa-report-r${c.round}.md`) fail('qa_retry_selector');
  if (gitText(c.worktree, 'rev-parse', 'HEAD') !== head || !ancestor(c.worktree, c.testedHead, head)) fail('qa_retry_head');
  const verified = verifyRecordProvenance({ ...options, head }), all = events(c.root, c.taskId);
  const record = verified.records.find(r => r.path === reportRel);
  if (!record || record.stage_event_id !== c.stageEventId || record.stage_input_head !== c.testedHead || record.round !== c.round) fail('qa_retry_stage');
  const stage = all.find(e => e.id === c.stageEventId);validateStage(c, stage, all);
  const isolation = verifyQaIsolation(c, stage, all);
  if (hash(workingBytes(c.worktree, reportRel)) !== record.sha256 || workingMode(c.worktree, reportRel) !== record.mode) fail('qa_retry_report');
  let previous = c.testedHead;
  const commits = gitText(c.worktree, 'rev-list', '--reverse', `${c.testedHead}..${head}`).split('\n').filter(Boolean);
  if (!commits.length) fail('qa_retry_unregistered');
  for (const commit of commits) {
    if (gitText(c.worktree, 'show', '-s', '--format=%P', commit) !== previous) fail('qa_retry_history');
    const changed = git(c.worktree, 'diff', '--name-only', '-z', previous, commit).toString('utf8').split('\0').filter(Boolean);
    const registration = all.find(e => e.kind === 'registration' && e.commit === commit && e.stage === 'qa' && e.round === c.round);
    if (!registration || registration.head_before !== previous) fail('qa_retry_registration');
    for (const file of changed.filter(f => f !== MANIFEST)) {
      const type = recordType(file, c.sprintDir);
      if (type.round !== c.round || !type.stages.some(s => ['evaluate', 'judge'].includes(s))) fail('qa_retry_scope');
      const rec = inspectRecord(c, file, gitBytes(c.worktree, commit, file), null, null, gitMode(c.worktree, commit, file));
      const bound = registrationFor(c, rec, commit, all);
      if (bound.event.id !== registration.id || (bound.stage.stage === 'evaluate'
        ? bound.stage.id !== c.stageEventId : bound.stage.controller_input?.qa_stage_event_id !== c.stageEventId)) fail('qa_retry_binding');
    }
    manifestDelta(gitBytes(c.worktree, previous, MANIFEST), gitBytes(c.worktree, commit, MANIFEST), registration.records);
    previous = commit;
  }
  return { ...baseResult(c, head, 'verified', [record]), isolation };
}
export function provenanceProjection(result) {
  if (!result || result.schema_version !== 1 || result.repo !== REPO || !['verified', 'sealed_not_registered'].includes(result.status)) fail('projection_invalid');
  const keys = ['schema_version', 'status', 'repo', 'task_id', 'sprint_dir', 'head', 'records', 'evidence_scope', 'command_semantics', 'isolation'];
  if (Object.keys(result).some(k => !keys.includes(k)) || result.evidence_scope !== 'controller_registration_and_stage_capture' || result.command_semantics !== 'existing_verify_evaluate_checks') fail('projection_invalid');
  identity({ taskId: result.task_id, sprintDir: result.sprint_dir });
  if (!SHA.test(result.head ?? '') || !Array.isArray(result.records) || !result.records.length) fail('projection_invalid');
  for (const r of result.records) {
    if (Object.keys(r).some(k => !['path', 'mode', 'sha256', 'stage', 'round', 'producer', 'stage_event_id', 'stage_input_head', 'registration_event_id', 'commit'].includes(k))) fail('projection_invalid');
    recordType(r.path, result.sprint_dir);
    if (!['100644', '100755'].includes(r.mode) || !/^[a-f0-9]{64}$/.test(r.sha256 ?? '') || !STAGES.has(r.stage) || !Number.isSafeInteger(r.round) || r.round < 0 || !['model', 'controller', 'controller_render'].includes(r.producer) || !UUID.test(r.stage_event_id ?? '') || !SHA.test(r.stage_input_head ?? '') || (result.status === 'verified' && (!UUID.test(r.registration_event_id ?? '') || !SHA.test(r.commit ?? '')))) fail('projection_invalid');
  }
  const records = result.records.map(r => Object.fromEntries(['path', 'mode', 'sha256', 'stage', 'round', 'producer', 'stage_event_id', 'stage_input_head', 'registration_event_id', 'commit'].filter(k => r[k] !== undefined).map(k => [k, r[k]])));
  return { ...baseResult({ taskId: result.task_id, sprintDir: result.sprint_dir }, result.head, result.status, records),
    ...(result.isolation ? { isolation: isolationProjection(result.isolation, result) } : {}) };
}
