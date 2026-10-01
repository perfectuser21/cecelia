import { appendFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';

let text = '';
for await (const chunk of process.stdin) text += chunk;
const input = JSON.parse(text);
const action = process.argv[2];
const trace = (event) => appendFileSync(input.trace, JSON.stringify({ action, ...event }) + '\n');
trace({ record: input.record?.id, budget: input.budget, input });
const result = { schema_version: 1, run_tag: input.run_tag, status: 'completed', failure_class: null,
  outputs: {}, metrics: { calls: 1 }, evidence: [{ action, record: input.record?.id }] };
const finish = (code = 0) => { process.stdout.write(JSON.stringify(result) + '\n'); process.exitCode = code; };
if (action === 'inspect') {
  result.outputs.records = [{ ...input.record, state: input.record.reject ? 'refused' : 'approved' }];
} else if (action === 'collect') {
  result.outputs.fragments = [{ id: input.record.id + ':fragment', owner: input.record.id }];
} else if (action === 'batch') {
  result.outputs.fragments = input.fragments.map(row => ({ ...row, scored: true }));
} else if (action === 'deliver') {
  result.outputs.delivered = input.fragments;
  result.metrics.delivered = input.fragments.length;
} else if (action === 'partial' || action === 'fatal') {
  result.status = 'partial';
  result.failure_class = action === 'fatal' ? 'fatal' : 'retryable';
  result.outputs.fragments = [{ id: 'retained', owner: 'partial' }];
  finish(2);
} else if (action === 'retry') {
  const attempt = input.attempt;
  result.outputs.fragments = [{ id: 'attempt:' + attempt }];
  if (attempt === 1) { result.status = 'partial'; result.failure_class = 'retryable'; finish(2); }
} else if (action === 'timeout') {
  const interval = setInterval(() => {}, 100);
  process.on('SIGTERM', () => {
    trace({ cleanup: true }); clearInterval(interval);
    result.status = 'partial'; result.failure_class = 'retryable';
    result.outputs.fragments = [{ id: 'before-timeout' }]; finish(2);
  });
} else if (action === 'hang') {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  writeFileSync(input.child_pid, String(child.pid));
  process.on('SIGTERM', () => {});
  setInterval(() => {}, 100);
} else if (action === 'finalize') {
  result.outputs.cleanup = true;
} else if (action === 'wrongrun') {
  result.run_tag = 'other-run';
} else if (action === 'malformed') {
  process.stdout.write('noise\n');
}
if (!['partial', 'fatal', 'timeout', 'hang'].includes(action) && !(action === 'retry' && input.attempt === 1)) finish();
