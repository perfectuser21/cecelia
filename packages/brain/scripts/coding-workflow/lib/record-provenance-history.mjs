// Historical captured command data for a trusted judge, never a current-QA execution or product verdict.
import { fail, hash, UUID, SHA } from './record-provenance-store.mjs';

const reject = code => fail(`history_${code}`);
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const EVENTS = new Set(['thread.started', 'turn.started', 'turn.completed', 'turn.failed', 'error', 'item.started', 'item.updated', 'item.completed']);
const ITEMS = new Set(['command_execution', 'reasoning', 'agent_message', 'file_change', 'mcp_tool_call', 'web_search', 'todo_list', 'error']);
function executions(stdout) {
  if (typeof stdout !== 'string') reject('stdout_missing');
  const lines = stdout.split('\n');if (lines.at(-1) === '') lines.pop();
  const pending = new Map(), seen = new Set(), commands = [];
  let thread = null, turnStarted = false, terminal = null, error = false;
  for (const line of lines) {
    let e;try { e = JSON.parse(line); } catch { reject('json_invalid'); }
    if (!e || !EVENTS.has(e.type)) reject('event_unknown');
    if (terminal) reject('after_terminal');
    if (e.type === 'thread.started') {
      if (thread || typeof e.thread_id !== 'string' || !e.thread_id) reject('thread_invalid');
      thread = e.thread_id;continue;
    }
    if (!thread) reject('thread_missing');
    if (e.type === 'turn.started') { if (turnStarted) reject('turn_duplicate');turnStarted = true;continue; }
    if (e.type === 'error') { error = true;continue; }
    if (['turn.completed', 'turn.failed'].includes(e.type)) { terminal = e.type;continue; }
    const i = e.item;
    if (!i || !ITEMS.has(i.type)) reject('item_unknown');
    // Deliberately do not copy reasoning, model messages, file bodies, or tool metadata.
    if (i.type !== 'command_execution') continue;
    if (typeof i.id !== 'string' || !i.id || typeof i.command !== 'string' || !i.command) reject('command_identity');
    if (e.type === 'item.started') {
      if (pending.has(i.id) || seen.has(i.id)) reject('duplicate_id');
      pending.set(i.id, i.command);continue;
    }
    if (pending.has(i.id) && pending.get(i.id) !== i.command) reject('command_changed');
    if (e.type === 'item.updated') { if (seen.has(i.id)) reject('duplicate_id');continue; }
    if (e.type !== 'item.completed' || seen.has(i.id)) reject('duplicate_id');
    if (typeof i.aggregated_output !== 'string' || !Number.isInteger(i.exit_code) || !['completed', 'failed'].includes(i.status)) reject('result_incomplete');
    pending.delete(i.id);seen.add(i.id);
    commands.push({ item_id: i.id, command: i.command, output: i.aggregated_output, exit_code: i.exit_code });
  }
  if (!thread || !terminal || pending.size) reject('session_incomplete');
  return { commands, terminal, error };
}
function nativeProjection(native, stage, proof) {
  if (!native || native.kind !== 'native' || native.schema_version !== 1 || native.repo !== proof.repo
    || native.task_id !== proof.task_id || native.sprint_dir !== proof.sprint_dir || native.stage !== stage.stage
    || native.run_id !== stage.run_id || native.round !== stage.round || !equal(native.controller, stage.controller)
    || native.provider !== 'codex' || !UUID.test(native.id ?? '') || typeof native.success !== 'boolean'
    || !Number.isInteger(native.code) || typeof native.timed_out !== 'boolean' || typeof native.terminated !== 'boolean') reject('native_binding');
  const parsed = executions(native.stdout);
  const complete = parsed.terminal === 'turn.completed' && !parsed.error && native.code === 0 && !native.timed_out
    && !native.terminated && !native.stdin_error && (!native.stdin_expected || native.stdin_finished);
  if (Boolean(complete) !== native.success) reject('native_success_mismatch');
  return { native_event_id: native.id, run_id: native.run_id, stage: native.stage, round: native.round,
    controller: native.controller, provider: native.provider, model: native.model ?? null,
    code: native.code, timed_out: native.timed_out, terminated: native.terminated, success: native.success,
    execution_complete: Boolean(complete), terminal_event: parsed.terminal, stdout_sha256: hash(native.stdout),
    stdout_bytes: Buffer.byteLength(native.stdout), error_event_seen: parsed.error, executions: parsed.commands };
}
/** Caller supplies only records/stages already checked by the protected registration verifier. */
export function historicalExecutionProjection(proof, selected, all) {
  if (proof.status !== 'verified' || !SHA.test(proof.head ?? '') || selected.length !== 2) reject('proof_invalid');
  const stages = selected.map(({ record, stage, registration }) => {
    if (!['build', 'verify'].includes(stage.stage) || stage.id !== record.stage_event_id
      || registration.id !== record.registration_event_id || registration.commit !== record.commit
      || stage.head_before !== record.stage_input_head || !UUID.test(stage.run_id ?? '')
      || stage.round !== record.round || !Array.isArray(stage.native_ids) || !stage.native_ids.length
      || new Set(stage.native_ids).size !== stage.native_ids.length
      || stage.current_native_id !== stage.native_ids.at(-1)) reject('stage_binding');
    const natives = stage.native_ids.map(id => nativeProjection(all.find(n => n.id === id), stage, proof));
    if (!natives.at(-1).success) reject('current_native_failed');
    return { stage: stage.stage, record: { path: record.path, mode: record.mode, sha256: record.sha256 },
      stage_event_id: stage.id, stage_input_head: stage.head_before, stage_output_head: stage.head_after,
      registration_event_id: registration.id, commit: registration.commit, run_id: stage.run_id,
      round: stage.round, controller: stage.controller, natives };
  });
  return { schema_version: 1, evidence_scope: 'historical_registered_stage_execution', repo: proof.repo,
    task_id: proof.task_id, sprint_dir: proof.sprint_dir, head: proof.head, stages,
    command_semantics: 'captured_command_strings_aggregated_output_and_exit_not_product_verdict',
    output_completeness: 'native_captured_aggregate_only_not_separate_child_stdout_stderr' };
}
