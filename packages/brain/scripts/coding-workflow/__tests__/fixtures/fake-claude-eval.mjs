#!/usr/bin/env node
// 假 claude（evaluator 真人 QA）：按 FAKE_EVAL_MODE 在 stdout 输出 stream-json 执行记录并写 REPORT_PATH。
// pass | fail（最后一条 Q FAIL）| finding（全 PASS + 一条阻断探索发现）| unittest（T-1 用 vitest 当证据）
// | fabricate（报告写了但没有执行记录）| prod（另外 curl 了生产 5221）| incomplete（只测第一条 Q）
// | outside（另写越界文件）| badformat（报告没有任何条目）。启动时打印 FAKE_HIDDEN_BUILD / FAKE_HIDDEN_EVIDENCE（03/04 是否被藏起）。
import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const prompt = argv[argv.indexOf('-p') + 1] || '';
const field = (name) => (prompt.match(new RegExp(`^${name}: (.*)$`, 'm')) || [])[1] ?? '';
const mode = process.env.FAKE_EVAL_MODE || 'pass';
const sprint = field('SPRINT_DIR');
const url = field('PREVIEW_URL');
const qaIds = field('QA_IDS').split(',').filter(Boolean);
console.error(`FAKE_HIDDEN_BUILD: ${!fs.existsSync(path.join(sprint, '03-build.md'))}`);
console.error(`FAKE_HIDDEN_EVIDENCE: ${!fs.existsSync(path.join(sprint, '04-evidence.md'))}`);
console.error(`FAKE_PREVIEW_URL: ${url}`);
console.error(`FAKE_JUDGE_FEEDBACK: ${field('JUDGE_FEEDBACK')}`);
console.error(`FAKE_PREV_ERRORS: ${field('PREV_ERRORS')}`);

let n = 0;
const emit = (command, output) => {
  if (mode === 'fabricate') return;
  n += 1;
  console.log(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id: `t${n}`, name: 'Bash', input: { command } }] } }));
  console.log(JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: `t${n}`, content: output }] } }));
};
const F = '```';
const sections = [];
const tested = mode === 'incomplete' ? qaIds.slice(0, 1) : qaIds;
tested.forEach((q, i) => {
  const command = mode === 'unittest' && i === 0 ? 'npx vitest run scripts/x.test.mjs' : `curl -s ${url}/api/brain/check?q=${q}`;
  const output = `{"ok":true,"scenario":"${q}"}`;
  emit(command, output);
  const verdict = mode === 'fail' && i === tested.length - 1 ? 'FAIL' : 'PASS';
  sections.push(`### T-${i + 1}\n对应: ${q}\nverdict: ${verdict}\n${F}command\n${command}\n${F}\n${F}output\n${output}\n${F}\n`);
});
if (mode === 'finding') {
  const command = `curl -s -X POST ${url}/api/brain/tasks -d '{}'`;
  emit(command, '{"error":"internal"} 500');
  sections.push(`### X-1\n对应: ${qaIds[0]}\n严重度: 阻断\n场景: 用户提交空 body 拿到 500\nverdict: FAIL\n${F}command\n${command}\n${F}\n${F}output\n{"error":"internal"} 500\n${F}\n`);
}
if (mode === 'prod') emit('curl -s http://localhost:5221/api/brain/tasks', '[]');
const upstream = qaIds.map((q) => `"02-spec.md#${q}"`).join(', ');
const body = mode === 'badformat' ? '看起来都好。\n' : sections.join('\n');
fs.writeFileSync(field('REPORT_PATH'), `---\ntask_id: ${field('TASK_ID')}\nstep: evaluate\nupstream: [${upstream}]\n---\n# QA 报告\n\n${body}`);
if (mode === 'outside') fs.writeFileSync('stray.txt', 'x\n');
console.log(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, total_cost_usd: 0.7 }));
