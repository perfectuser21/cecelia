#!/usr/bin/env node
// 假 evaluate 活动：stdin 读输入（追加记到 FAKE_QA_LOG），按 FAKE_QA_MODE 输出结果 JSON：
// pass / fail（写 05-qa-report-r<round>.md 后 completed，qa.verdict PASS/FAIL，FAIL 带 T-1 失败）
// | retry（retryable preview_unavailable）| fatal（fatal evaluate_touched_production）
import fs from 'node:fs';
import path from 'node:path';

const input = JSON.parse(fs.readFileSync(0, 'utf8'));
if (process.env.FAKE_QA_LOG) fs.appendFileSync(process.env.FAKE_QA_LOG, `${JSON.stringify(input)}\n`);
const mode = process.env.FAKE_QA_MODE || 'pass';
const out = (r) => {
  process.stdout.write(`${JSON.stringify({ schema_version: 1, run_tag: input.run_tag, metrics: {}, evidence: [], ...r })}\n`);
  process.exit(r.status === 'completed' ? 0 : 2);
};
if (mode === 'retry') out({ status: 'failed', failure_class: 'retryable', reason_code: 'preview_unavailable', outputs: {} });
if (mode === 'fatal') out({ status: 'failed', failure_class: 'fatal', reason_code: 'evaluate_touched_production', outputs: {} });
const file = `05-qa-report-r${input.round}.md`;
fs.writeFileSync(path.join(input.worktree, input.sprint_dir, file), `# QA 报告 第 ${input.round} 轮 ${mode}\n`);
const failed = mode === 'fail' ? [{ id: 'T-1', covers: ['Q-1'], command: 'curl x', output_tail: '500' }] : [];
out({
  status: 'completed', failure_class: null,
  outputs: { qa_report_file: file, qa: { verdict: mode === 'fail' ? 'FAIL' : 'PASS', round: input.round, env: { kind: 'preview', url: 'http://localhost:5302' }, failed, blocking: [], cost_usd: 0.5 } },
});
