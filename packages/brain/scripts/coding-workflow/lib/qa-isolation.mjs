// 可信父控制器的临时工作区隐藏/恢复；不声称封锁 Git 历史，也不替代产品 QA。
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { hash, fail, gitText, gitBytes, gitMode, noLinks, workingBytes, workingMode, taskDir, writeEvent, UUID, SHA } from './record-provenance-store.mjs';

const POLICY = 'evaluate_workspace_reports_v1';
const FILES = ['03-build.md', '04-evidence.md'];
const HEX = /^[a-f0-9]{64}$/;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const exists = file => { try { fs.lstatSync(file);return true; } catch (e) { if (e.code === 'ENOENT') return false;throw e; } };
const identity = c => hash(JSON.stringify([fs.realpathSync(c.worktree), gitText(c.worktree, 'rev-parse', '--absolute-git-dir')]));
const exactKeys = (o, keys) => o && typeof o === 'object' && !Array.isArray(o) && same(Object.keys(o).sort(), [...keys].sort());
const check = (value, code) => { if (!value) fail(`isolation_${code}`); };

/** 只由 record-provenance 当前 evaluate context 调用；身份不从任务或模型结果读取。 */
export function startQaIsolation(c) {
  check(c.stage === 'evaluate' && Number.isSafeInteger(c.round) && c.round > 0 && !c.native.length, 'context');
  check(gitText(c.worktree, 'rev-parse', 'HEAD') === c.startedHead, 'head');
  const holderRoot = path.join(taskDir(c.root, c.taskId, true), `hidden-${c.runId}`);
  check(!exists(holderRoot), 'holder_exists');
  // 全部文件先验证，避免第二文件本来就坏而第一文件已经被移动。
  const files = FILES.map(name => {
    const rel = `${c.sprintDir}/${name}`;check(exists(path.join(c.worktree, rel)), 'original_missing');
    const bytes = workingBytes(c.worktree, rel), mode = workingMode(c.worktree, rel);
    const stat = fs.lstatSync(path.join(c.worktree, rel));check(!(stat.mode & 0o7000), 'unsupported_permissions');
    check(mode === gitMode(c.worktree, c.startedHead, rel) && bytes.equals(gitBytes(c.worktree, c.startedHead, rel)), 'original');
    return { path: rel, mode, fs_mode: stat.mode & 0o777, sha256: hash(bytes), git_blob: gitText(c.worktree, 'rev-parse', `${c.startedHead}:${rel}`),
      holder_id: randomUUID(), holder_path: path.join(holderRoot, name) };
  });
  noLinks(holderRoot, true);
  const base = { kind: 'isolation', producer: 'controller', policy: POLICY, sprint_dir: c.sprintDir, run_id: c.runId,
    stage: 'evaluate', round: c.round, head: c.startedHead, controller: c.controller, worktree_id: identity(c), files };
  const moved = [];
  let phase = 'starting', hidden, captured, restored;
  function restoreFiles() {
    let ok = true;
    for (const f of moved) {
      try {
        const destination = path.join(c.worktree, f.path);
        check(!exists(destination), 'destination_exists');
        check(hash(workingBytes(holderRoot, path.basename(f.path))) === f.sha256
          && workingMode(holderRoot, path.basename(f.path)) === f.mode
          && (fs.statSync(f.holder_path).mode & 0o7777) === f.fs_mode, 'holder_changed');
        noLinks(path.dirname(destination));
        fs.copyFileSync(f.holder_path, destination, fs.constants.COPYFILE_EXCL);
        fs.chmodSync(destination, f.fs_mode);
        check(hash(workingBytes(c.worktree, f.path)) === f.sha256 && workingMode(c.worktree, f.path) === f.mode && (fs.statSync(destination).mode & 0o7777) === f.fs_mode, 'restore_changed');
        fs.unlinkSync(f.holder_path);
      } catch { ok = false; }
    }
    return ok;
  }
  try {
    for (const f of files) {
      const source = path.join(c.worktree, f.path);
      fs.copyFileSync(source, f.holder_path, fs.constants.COPYFILE_EXCL);
      fs.chmodSync(f.holder_path, f.fs_mode);
      check(hash(workingBytes(holderRoot, path.basename(f.path))) === f.sha256, 'copy_changed');
      fs.unlinkSync(source);moved.push(f);check(!exists(source), 'not_hidden');
    }
    hidden = writeEvent(c.root, c.taskId, { ...base, phase: 'hidden', observed_at: new Date().toISOString() });phase = 'hidden';
  } catch (error) { phase = 'failed';restoreFiles();throw error; }
  function finish(abort) {
    if (phase === 'restored') { if (abort) phase = 'aborted';return true; }
    if (phase !== 'hidden') return false;
    phase = abort ? 'aborted' : 'failed';
    // 每个文件都尝试，即使 HEAD 已变、原生失败或第一文件恢复失败。
    const intact = restoreFiles();
    if (abort) return intact;
    try {
      check(intact && captured && captured.success && gitText(c.worktree, 'rev-parse', 'HEAD') === c.startedHead, 'incomplete');
      const observedAt = new Date().toISOString();check(observedAt >= hidden.observed_at, 'clock_order');
      restored = writeEvent(c.root, c.taskId, { ...base, phase: 'restored', observed_at: observedAt, hidden_event_id: hidden.id, native_event_id: captured.id });
      phase = 'restored';return true;
    } catch { return false; }
  }
  return Object.freeze({
    capture(event) { check(phase === 'hidden' && !captured, 'native_interval');captured = event; },
    assertActive() {
      check(phase === 'hidden' && !captured && gitText(c.worktree, 'rev-parse', 'HEAD') === c.startedHead, 'native_interval');
      for (const f of files) check(!exists(path.join(c.worktree, f.path))
        && hash(workingBytes(holderRoot, path.basename(f.path))) === f.sha256
        && (fs.statSync(f.holder_path).mode & 0o7777) === f.fs_mode, 'native_boundary');
      return hidden.id;
    },
    hiddenFacts() {
      check(phase === 'hidden', 'hidden_unavailable');
      return JSON.parse(JSON.stringify({ policy: POLICY, status: 'hidden', producer: 'controller', task_id: c.taskId,
        stage: 'evaluate', round: c.round, run_id: c.runId, tested_head: c.startedHead, controller: c.controller,
        hidden_event_id: hidden.id, hidden_at: hidden.observed_at, files: files.map(({ holder_path, ...f }) => f) }));
    },
    restore: () => finish(false), abort: () => finish(true),
    completed() { check(phase === 'restored' && restored, 'incomplete');return restored.id; },
  });
}

const BASE_KEYS = ['schema_version', 'repo', 'task_id', 'id', 'digest', 'kind', 'producer', 'policy', 'sprint_dir', 'run_id', 'stage', 'round', 'head', 'controller', 'worktree_id', 'files', 'phase', 'observed_at'];
const validTime = t => typeof t === 'string' && Number.isFinite(Date.parse(t)) && new Date(t).toISOString() === t;
const validFsMode = f => Number.isInteger(f.fs_mode) && f.fs_mode >= 0 && f.fs_mode <= 0o777 && Boolean(f.fs_mode & 0o111) === (f.mode === '100755');
const FILE_KEYS = ['path', 'mode', 'fs_mode', 'sha256', 'git_blob', 'holder_id', 'holder_path'];
function validateEvent(c, e, stage, phase) {
  check(exactKeys(e, [...BASE_KEYS, ...(phase === 'restored' ? ['hidden_event_id', 'native_event_id'] : [])]), 'event_shape');
  check(e.kind === 'isolation' && e.phase === phase && e.producer === 'controller' && e.policy === POLICY
    && e.task_id === c.taskId && e.sprint_dir === c.sprintDir && e.stage === 'evaluate' && e.round === stage.round
    && e.run_id === stage.run_id && e.head === stage.head_before && stage.head_before === stage.head_after
    && same(e.controller, stage.controller) && HEX.test(e.worktree_id) && validTime(e.observed_at), 'binding');
  check(Array.isArray(e.files) && e.files.length === FILES.length, 'files');
  e.files.forEach((f, i) => {
    const rel = `${c.sprintDir}/${FILES[i]}`;
    check(exactKeys(f, FILE_KEYS) && f.path === rel && UUID.test(f.holder_id) && validFsMode(f) && HEX.test(f.sha256) && SHA.test(f.git_blob), 'file_shape');
    check(f.holder_path === path.join(c.root, c.taskId, `hidden-${e.run_id}`, FILES[i]), 'holder_identity');
    check(f.mode === gitMode(c.worktree, e.head, rel) && f.sha256 === hash(gitBytes(c.worktree, e.head, rel))
      && f.git_blob === gitText(c.worktree, 'rev-parse', `${e.head}:${rel}`), 'file_identity');
  });
}
/** 读取固定当前05 stage关联的生命周期；不接受模型提供的projection。 */
export function verifyQaIsolation(c, stage, all, current = false) {
  check(stage.stage === 'evaluate' && ['model', 'controller_assembly'].includes(stage.producer) && UUID.test(stage.isolation_event_id ?? ''), 'missing');
  const restored = all.find(e => e.id === stage.isolation_event_id);
  validateEvent(c, restored, stage, 'restored');
  const hidden = all.find(e => e.id === restored.hidden_event_id);
  validateEvent(c, hidden, stage, 'hidden');
  check(hidden.id !== restored.id && same(hidden.files, restored.files) && hidden.worktree_id === restored.worktree_id && hidden.observed_at <= restored.observed_at, 'pair');
  const native = all.find(e => e.id === restored.native_event_id);
  check(native?.kind === 'native' && native.success && !Object.hasOwn(native, 'isolation_error') && native.isolation_hidden_event_id === hidden.id && native.id === stage.current_native_id && same(stage.native_ids, [native.id])
    && native.task_id === c.taskId && native.sprint_dir === c.sprintDir && native.run_id === stage.run_id
    && native.stage === 'evaluate' && native.round === stage.round && same(native.controller, stage.controller), 'native_binding');
  if (current) {
    check(stage.head_before === c.head && hidden.worktree_id === identity(c)
      && (c.round === undefined || c.round === stage.round), 'current_binding');
    for (const f of restored.files) check(hash(workingBytes(c.worktree, f.path)) === f.sha256 && workingMode(c.worktree, f.path) === f.mode && (fs.statSync(path.join(c.worktree, f.path)).mode & 0o7777) === f.fs_mode, 'current_file');
  }
  return { policy: POLICY, status: 'restored', producer: 'controller', task_id: c.taskId, stage: 'evaluate', round: stage.round,
    run_id: stage.run_id, tested_head: stage.head_before, qa_stage_event_id: stage.id,
    hidden_event_id: hidden.id, restored_event_id: restored.id, native_event_id: native.id,
    worktree_id: hidden.worktree_id, controller: restored.controller, hidden_at: hidden.observed_at, restored_at: restored.observed_at, files: hidden.files.map(({ holder_path, ...f }) => f) };
}
const PROJECTION_KEYS = ['policy', 'status', 'producer', 'task_id', 'stage', 'round', 'run_id', 'tested_head', 'qa_stage_event_id', 'hidden_event_id', 'restored_event_id', 'native_event_id', 'worktree_id', 'controller', 'hidden_at', 'restored_at', 'files'];
export function isolationProjection(proof, result) {
  check(exactKeys(proof, PROJECTION_KEYS) && proof.policy === POLICY && proof.status === 'restored' && proof.producer === 'controller'
    && proof.task_id === result.task_id && proof.stage === 'evaluate' && Number.isSafeInteger(proof.round) && proof.round > 0
    && SHA.test(proof.tested_head) && HEX.test(proof.worktree_id)
    && validTime(proof.hidden_at) && validTime(proof.restored_at) && proof.hidden_at <= proof.restored_at
    && exactKeys(proof.controller, ['revision', 'modules']) && SHA.test(proof.controller.revision)
    && Array.isArray(proof.controller.modules) && proof.controller.modules.length > 0
    && proof.controller.modules.every(m => exactKeys(m, ['path', 'sha256']) && typeof m.path === 'string' && HEX.test(m.sha256))
    && ['run_id', 'qa_stage_event_id', 'hidden_event_id', 'restored_event_id', 'native_event_id'].every(k => UUID.test(proof[k])), 'projection');
  check(result.records.some(r => r.path === `${result.sprint_dir}/05-qa-report-r${proof.round}.md`
    && r.stage === 'evaluate' && ['model', 'controller_assembly'].includes(r.producer) && r.round === proof.round
    && r.stage_event_id === proof.qa_stage_event_id && r.stage_input_head === proof.tested_head), 'projection_stage');
  check(Array.isArray(proof.files) && proof.files.length === FILES.length && proof.files.every((f, i) => exactKeys(f, FILE_KEYS.filter(k => k !== 'holder_path'))
    && f.path === `${result.sprint_dir}/${FILES[i]}` && ['100644', '100755'].includes(f.mode) && HEX.test(f.sha256)
    && SHA.test(f.git_blob) && UUID.test(f.holder_id) && validFsMode(f)), 'projection_files');
  return JSON.parse(JSON.stringify(proof));
}
