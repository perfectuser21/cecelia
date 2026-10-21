import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { hash, fail, gitText, writeEvent, events, workingBytes, noLinks } from './record-provenance-store.mjs';
import { inputIdentity } from './record-provenance-inputs.mjs';
import { strictNativeExecutions, compileQaReport, QA_NATIVE_POLICY } from './native-evidence.mjs';
import { parseQaReport } from './qa-report.mjs';

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const isCompilerController = controller => controller?.modules?.some(m => m.path.endsWith('/lib/native-evidence.mjs'));
export const compiledQaRequired = (c, stage) => c.evidencePolicy === QA_NATIVE_POLICY
  || (stage?.stage === 'evaluate' && isCompilerController(stage.controller));
function nativeFor(c, all, id, identity) {
  const native = all.find(e => e.id === id);
  if (!native || native.kind !== 'native' || native.provider !== 'codex' || !native.success || native.stdin_error
    || (native.stdin_expected && !native.stdin_finished) || native.task_id !== c.taskId || native.sprint_dir !== identity.sprint_dir
    || native.run_id !== identity.run_id || native.stage !== 'evaluate' || native.round !== identity.round
    || !same(native.controller, identity.controller) || native.isolation_error || !native.isolation_hidden_event_id) fail('qa_native_binding');
  return native;
}
function ledgerIdentity(c, native, testedHead) {
  return { task_id: c.taskId, sprint_dir: native.sprint_dir, round: native.round, run_id: native.run_id,
    tested_head: testedHead, native_event_id: native.id };
}
export function assembleCurrentQa(c, reportRel) {
  if (c.stage !== 'evaluate' || c.evidencePolicy !== QA_NATIVE_POLICY || c.native.length !== 1 || c.qaAssembly) fail('qa_assembly_context');
  const draftBytes = workingBytes(c.worktree, reportRel);
  const native = nativeFor(c, events(c.root, c.taskId), c.native[0], inputIdentity(c));
  if (gitText(c.worktree, 'rev-parse', 'HEAD') !== c.startedHead) fail('qa_assembly_head');
  // Preserve the original even if parsing or item verification subsequently fails.
  const draft = writeEvent(c.root, c.taskId, { kind: 'qa_draft', ...inputIdentity(c), producer: 'model',
    report_path: reportRel, native_event_id: native.id, sha256: hash(draftBytes), bytes: draftBytes.length,
    bytes_base64: draftBytes.toString('base64') });
  const commands = strictNativeExecutions(native.stdout);
  const parsed = parseQaReport(draftBytes.toString('utf8'), { executions: commands, draft: true });
  const text = compileQaReport(draftBytes.toString('utf8'), parsed, commands, ledgerIdentity(c, native, c.startedHead));
  const file = path.join(c.worktree, reportRel), tmp = `${file}.${randomUUID()}.tmp`;
  noLinks(file);
  const fd = fs.openSync(tmp, 'wx', fs.statSync(file).mode & 0o777);
  try { fs.writeFileSync(fd, text);fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(tmp, file);
  if (!workingBytes(c.worktree, reportRel).equals(Buffer.from(text))) fail('qa_assembly_readback');
  c.qaAssembly = { draft_event_id: draft.id, draft_sha256: draft.sha256, native_event_id: native.id,
    native_stdout_sha256: hash(native.stdout), compiled_report_sha256: hash(Buffer.from(text)), report_path: reportRel };
  return text;
}
export function validateQaAssembly(c, stage, all) {
  const required = compiledQaRequired(c, stage);
  if (!required && stage.producer !== 'controller_assembly') return;
  if (stage.stage !== 'evaluate' || stage.producer !== 'controller_assembly' || stage.evidence_policy !== QA_NATIVE_POLICY
    || !stage.controller_input || stage.native_ids?.length !== 1 || stage.current_native_id !== stage.native_ids[0]
    || stage.head_before !== stage.head_after) fail('qa_compiled_policy');
  const proof = stage.controller_input, draft = all.find(e => e.id === proof.draft_event_id);
  const native = nativeFor(c, all, stage.current_native_id, stage);
  if (!draft || draft.kind !== 'qa_draft' || draft.stage !== 'evaluate' || draft.producer !== 'model' || draft.task_id !== c.taskId
    || draft.sprint_dir !== stage.sprint_dir || draft.round !== stage.round || draft.run_id !== stage.run_id
    || draft.tested_head !== stage.head_before || draft.native_event_id !== native.id || !same(draft.controller, stage.controller)
    || proof.native_event_id !== native.id || proof.native_stdout_sha256 !== hash(native.stdout)) fail('qa_draft_binding');
  if (typeof draft.bytes_base64 !== 'string') fail('qa_draft_bytes');
  const bytes = Buffer.from(draft.bytes_base64, 'base64');
  if (bytes.toString('base64') !== draft.bytes_base64 || bytes.length !== draft.bytes || hash(bytes) !== draft.sha256 || proof.draft_sha256 !== draft.sha256) fail('qa_draft_bytes');
  const commands = strictNativeExecutions(native.stdout), parsed = parseQaReport(bytes.toString('utf8'), { executions: commands, draft: true });
  const text = compileQaReport(bytes.toString('utf8'), parsed, commands, ledgerIdentity(c, native, stage.head_before));
  const report = `${stage.sprint_dir}/05-qa-report-r${stage.round}.md`;
  if (proof.report_path !== report || draft.report_path !== report || proof.compiled_report_sha256 !== hash(Buffer.from(text))
    || !stage.records.some(r => r.path === report && r.sha256 === proof.compiled_report_sha256)) fail('qa_compiled_bytes');
}
