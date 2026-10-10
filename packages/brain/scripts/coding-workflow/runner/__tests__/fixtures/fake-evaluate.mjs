#!/usr/bin/env node
// 假 evaluate 活动：stdin 读输入（追加记到 FAKE_QA_LOG），按 FAKE_QA_MODE 输出结果 JSON：
// pass / fail / cannot（CANNOT_VERIFY，T-2 缺工具）（写 05-qa-report-r<round>.md 后 completed，qa.verdict PASS/FAIL，FAIL 带 T-1 失败）
// | retry（retryable preview_unavailable）| unverified（retryable qa_evidence_unverified，带 T-5）| fatal（fatal evaluate_touched_production）
import fs from 'node:fs';
import path from 'node:path';

const input = JSON.parse(fs.readFileSync(0, 'utf8'));
if (process.env.FAKE_QA_LOG) fs.appendFileSync(process.env.FAKE_QA_LOG, `${JSON.stringify(input)}\n`);
const mode = process.env.FAKE_QA_MODE || 'pass';
const out = (r) => {
  process.stdout.write(`${JSON.stringify({ schema_version: 1, run_tag: input.run_tag, metrics: {}, evidence: [], ...r })}\n`);
  process.exit(r.status === 'completed' ? 0 : 2);
};
// unverified：报告引用的命令执行记录里查不到（金丝雀 #6160 第 1 轮实况）
if (mode === 'unverified') {
  out({ status: 'failed', failure_class: 'retryable', reason_code: 'qa_evidence_unverified', outputs: {}, evidence: [{ unverified: [{ id: 'T-5', reason: 'command_not_executed' }] }] });
}
if (mode === 'retry') out({ status: 'failed', failure_class: 'retryable', reason_code: 'preview_unavailable', outputs: {} });
if (mode === 'fatal') {
  out({ status: 'failed', failure_class: 'fatal', reason_code: 'evaluate_touched_production', outputs: {}, evidence: [{ commands: ['curl -s http://localhost:5221/api/brain/tasks'] }] });
}
const file = `05-qa-report-r${input.round}.md`;
fs.writeFileSync(path.join(input.worktree, input.sprint_dir, file), `# QA 报告 第 ${input.round} 轮 ${mode}\n`);
const cannot = mode === 'cannot' ? [{ id: 'T-2', covers: ['Q-1'], reason: '工具缺失：预览环境没有 ffprobe' }] : [];
const failed = mode === 'fail' ? [{ id: 'T-1', covers: ['Q-1'], command: 'curl x', output_tail: '500' }] : [];
out({
  status: 'completed', failure_class: null,
  outputs: { qa_report_file: file, qa: { verdict: mode === 'fail' ? 'FAIL' : mode === 'cannot' ? 'CANNOT_VERIFY' : 'PASS', cannot_verify: cannot, round: input.round, env: { kind: 'preview', url: 'http://localhost:5302' }, failed, blocking: [], cost_usd: 0.5 } },
});
