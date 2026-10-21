import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { taskDir, noLinks, workingBytes, hash, fail, writeEvent } from './record-provenance-store.mjs';

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export const judgeInputRequired = stage => stage.stage === 'judge'
  && stage.controller?.modules?.some(m => m.path.endsWith('/runner/lib/judge-gate.mjs'))
  && stage.controller.modules.some(m => m.path.endsWith('/lib/record-provenance-inputs.mjs'));
export const inputIdentity = c => ({ sprint_dir: c.sprintDir, run_id: c.runId, stage: c.stage,
  round: c.round, tested_head: c.startedHead, controller: c.controller });

function privateFile(c, suffix, bytes) {
  const dir = taskDir(c.root, c.taskId, true), file = path.join(dir, `${randomUUID()}.${suffix}`);
  const fd = fs.openSync(file, 'wx', 0o600);
  try { fs.writeFileSync(fd, bytes);fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  noLinks(dir);
  if (!fs.readFileSync(noLinks(file)).equals(bytes)) fail('input_readback');
  return file;
}
export function writeJudgeInput(c, { system, user }) {
  if (c.stage !== 'judge' || c.native.length || c.judgeInput || typeof system !== 'string' || typeof user !== 'string') fail('judge_input_context');
  const materials = Buffer.from(JSON.stringify({ system, user })), stdin = Buffer.from(`${system}\n\n${user}`);
  const data = { kind: 'judge_input', ...inputIdentity(c), materials_sha256: hash(materials), stdin_sha256: hash(stdin),
    stdin_bytes: stdin.length, materials_path: privateFile(c, 'materials', materials), stdin_path: privateFile(c, 'stdin', stdin) };
  const event = writeEvent(c.root, c.taskId, data);
  validateJudgeInput(c, event, { ...inputIdentity(c), task_id: c.taskId });
  c.judgeInput = event;
  return { event_id: event.id, ...Object.fromEntries(['materials_sha256', 'stdin_sha256', 'stdin_bytes', 'materials_path', 'stdin_path'].map(k => [k, event[k]])) };
}
export function validateJudgeInput(c, event, identity) {
  if (!event || event.kind !== 'judge_input' || event.task_id !== c.taskId || event.stage !== 'judge'
    || event.sprint_dir !== identity.sprint_dir || event.run_id !== identity.run_id || event.round !== identity.round
    || event.tested_head !== identity.tested_head || !same(event.controller, identity.controller)) fail('judge_input_binding');
  const dir = taskDir(c.root, c.taskId);
  for (const [key, suffix] of [['materials_path', 'materials'], ['stdin_path', 'stdin']]) {
    if (typeof event[key] !== 'string' || path.dirname(event[key]) !== dir || !new RegExp(`^[a-f0-9-]{36}\\.${suffix}$`).test(path.basename(event[key]))) fail('judge_input_path');
  }
  const materials = workingBytes(dir, path.basename(event.materials_path)), stdin = workingBytes(dir, path.basename(event.stdin_path));
  let data;try { data = JSON.parse(materials.toString('utf8')); } catch { fail('judge_input_materials'); }
  if (!data || !same(Object.keys(data), ['system', 'user']) || typeof data.system !== 'string' || typeof data.user !== 'string'
    || !stdin.equals(Buffer.from(`${data.system}\n\n${data.user}`)) || event.stdin_bytes !== stdin.length
    || event.materials_sha256 !== hash(materials) || event.stdin_sha256 !== hash(stdin)) fail('judge_input_bytes');
}
export function validateJudgeStageInput(c, stage, all) {
  const natives = (stage.native_ids ?? []).map(id => all.find(e => e.id === id));
  if (!judgeInputRequired(stage) && !stage.judge_input_event_id && !natives.some(n => n?.judge_input_event_id)) return;
  const event = all.find(e => e.id === stage.judge_input_event_id);
  validateJudgeInput(c, event, { ...stage, tested_head: stage.head_before });
  if (stage.stdin_sha256 !== event.stdin_sha256 || !natives.length || natives.some(n => !n
    || n.judge_input_event_id !== event.id || n.stdin_sha256 !== event.stdin_sha256 || n.stdin_bytes !== event.stdin_bytes
    || n.stdin_expected !== true || n.stdin_finished !== true || n.stdin_error)) fail('judge_input_native');
}
