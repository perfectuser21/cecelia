import { qaScreenshotDeclarations } from './evidence.mjs';
import { matchesShellEvidence } from './shell-command.mjs';

export const QA_NATIVE_POLICY = 'qa_native_compiled_v1';
export const QA_NATIVE_MARKER = '<!-- coding-workflow-native-evidence:v1 -->';
const metadata = new WeakMap();
const reject = code => { throw Error(`qa_native_${code}`); };
export function rememberNativeRun(run, item) { metadata.set(run, { ...item }); }
export function nativeRun(run) {
  const item = metadata.get(run);
  if (!item || typeof item.id !== 'string' || typeof item.aggregated_output !== 'string'
    || !Number.isInteger(item.exit_code) || !['completed', 'failed'].includes(item.status)) return null;
  return { item_id: item.id, command: item.command, output: item.aggregated_output, exit_code: item.exit_code };
}

/** CLI JSONL, never model prose or a mutable transcript file. Completion is not child-output completeness. */
export function strictNativeExecutions(stdout) {
  if (typeof stdout !== 'string') reject('stdout_missing');
  const commands = [], started = new Map(), completed = new Set();let threads = 0, turns = 0;
  const lines = stdout.split('\n');
  if (lines.at(-1) === '') lines.pop();
  for (const line of lines) {
    let e;try { e = JSON.parse(line); } catch { reject('json_invalid'); }
    if (!e || typeof e.type !== 'string') reject('event_invalid');
    if (['error', 'turn.failed'].includes(e.type)) reject('session_failed');
    if (e.type === 'thread.started') { if (typeof e.thread_id !== 'string' || !e.thread_id) reject('thread_invalid');threads++; }
    if (e.type === 'turn.completed') turns++;
    const i = e.item;
    if (i?.type !== 'command_execution') continue;
    if (typeof i.id !== 'string' || !i.id || typeof i.command !== 'string' || !i.command) reject('command_identity');
    if (e.type === 'item.started') {
      if (started.has(i.id) || completed.has(i.id)) reject('duplicate_id');
      started.set(i.id, i.command);continue;
    }
    if (e.type === 'item.updated') continue;
    if (e.type !== 'item.completed' || completed.has(i.id)) reject('duplicate_or_incomplete');
    if (started.has(i.id) && started.get(i.id) !== i.command) reject('command_changed');
    if (typeof i.aggregated_output !== 'string' || !Number.isInteger(i.exit_code) || !['completed', 'failed'].includes(i.status)) reject('result_incomplete');
    completed.add(i.id);
    commands.push({ item_id: i.id, command: i.command, output: i.aggregated_output, exit_code: i.exit_code });
  }
  if (threads !== 1 || turns !== 1 || [...started.keys()].some(id => !completed.has(id))) reject('session_incomplete');
  return commands;
}
const sameOutput = (claimed, actual) => claimed === actual || (claimed !== '' && actual.endsWith('\n') && claimed === actual.slice(0, -1));
export function resolveNativeItem(item, commands) {
  let candidates = commands.filter(run => run && matchesShellEvidence(run.command, String(item.command).trim()));
  // 同命令的completed账顺序，先选明确序号，再核其它声明；绝不按成功状态重排。
  if (item.native_occurrence !== undefined) {
    const n = item.native_occurrence;
    if (!Number.isSafeInteger(n) || n < 1 || n > candidates.length) reject('occurrence_invalid');
    candidates = [candidates[n - 1]];
  }
  if (item.native_item_id) candidates = candidates.filter(run => run.item_id === item.native_item_id);
  if (item.exit_code !== undefined) candidates = candidates.filter(run => run.exit_code === item.exit_code);
  if (item.evidence_source !== 'controller_native' || item.output_present !== false) candidates = candidates.filter(run => sameOutput(item.output, run.output));
  if (candidates.length !== 1) reject('item_unverified_or_ambiguous');
  return candidates[0];
}

export function compileQaReport(draft, parsed, commands, identity) {
  if (parsed.errors.length) reject('draft_invalid');
  const head = /^---\r?\n[\s\S]*?\r?\n---\r?\n/.exec(draft)?.[0];
  if (!head) reject('draft_identity');
  const materialize = item => {
    const run = resolveNativeItem(item, commands);
    return { ...item, command: run.command, output: run.output, native_item_id: run.item_id, exit_code: run.exit_code };
  };
  const tests = parsed.tests.map(materialize), findings = parsed.findings.map(materialize);
  const parts = [head.trimEnd(), '# QA 报告（控制器原生事实编译；模型语义结论原样保留）'];
  for (const item of [...tests, ...findings]) {
    parts.push(`### ${item.id}`, `对应: ${item.covers.join(',')}`, `verdict: ${item.verdict}`, `native_item_id: ${item.native_item_id}`, `exit_code: ${item.exit_code}`);
    for (const [key, label] of [['reason', '原因'], ['severity', '严重度'], ['scene', '场景']]) if (item[key]) parts.push(`${label}: ${item[key]}`);
    // JSON scalars keep CRLF, fences, headings and empty strings as data, never Markdown structure.
    parts.push('command_encoding: json', '```command', JSON.stringify(item.command), '```', 'output_encoding: json', '```output', JSON.stringify(item.output), '```');
  }
  parts.push(...qaScreenshotDeclarations(draft));
  parts.push(QA_NATIVE_MARKER, '```json', JSON.stringify({ schema_version: 1, evidence_policy: QA_NATIVE_POLICY, ...identity, commands }), '```');
  return parts.join('\n') + '\n';
}
export function compiledLedger(text) {
  const m = /\n<!-- coding-workflow-native-evidence:v1 -->\n```json\n([^\n]+)\n```\n?$/.exec(text);
  if (!m) return null;
  let ledger;try { ledger = JSON.parse(m[1]); } catch { reject('ledger_invalid'); }
  if (ledger.schema_version !== 1 || ledger.evidence_policy !== QA_NATIVE_POLICY || !Array.isArray(ledger.commands)) reject('ledger_invalid');
  return { body: text.slice(0, m.index), ledger };
}
