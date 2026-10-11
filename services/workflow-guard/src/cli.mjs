#!/usr/bin/env node
// CLI 入口：保持与原 workflow-write-guard.mjs 完全相同的用法与退出码，
// 这样 Commander 在与账本同机时仍可继续走本地路径（降级/排障用）。
// 判定逻辑与 HTTP 服务共用 guard-core，不存在第二份实现。
import { authorizeWrite } from './guard-core.js';

function parse(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const v = argv[i];
    if (!v.startsWith('--')) { out._.push(v); continue; }
    const key = v.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) out[key] = true;
    else { out[key] = next; i += 1; }
  }
  return out;
}

const args = parse(process.argv.slice(2));
if (args._[0] !== 'authorize') {
  process.stderr.write(`${JSON.stringify({ ok: false, authorized: false, error: 'Usage: cli.mjs authorize --run-id ID --attempt-id ID --execution-id ID --lease-id ID --worker-agent-id ID --stage-id ID --stage-attempt N --intent INTENT [--state-dir DIR]' })}\n`);
  process.exit(2);
}

const result = authorizeWrite({
  run_id: args['run-id'], attempt_id: args['attempt-id'], execution_id: args['execution-id'],
  lease_id: args['lease-id'], worker_agent_id: args['worker-agent-id'],
  stage_id: args['stage-id'], stage_attempt: args['stage-attempt'],
  intent: args.intent, state_dir: args['state-dir'],
});

if (!result.ok) { process.stderr.write(`${JSON.stringify(result)}\n`); process.exit(2); }
process.stdout.write(`${JSON.stringify(result)}\n`);
