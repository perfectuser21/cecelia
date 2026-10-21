#!/usr/bin/env node
// 假 claude（evaluator 真人 QA）：按 FAKE_EVAL_MODE 在 stdout 输出 stream-json 执行记录并写 REPORT_PATH。
// pass | fail（最后一条 Q FAIL）| finding（全 PASS + 一条阻断探索发现）| unittest（T-1 用 vitest 当证据）
// | fabricate（报告写了但没有执行记录）| prod（另外 curl 了生产 5221）| prod-hk（另外 curl 了 zenithjoy 生产 hk-vps）| incomplete（只测第一条 Q）
// | outside（另写越界文件）| badformat（报告没有任何条目）| cannot（最后一条 Q 验不了：工具缺失）
// | cannot-noreason（验不了但没写原因）| trivial（T-1 命令带 `|| true`）| shot-missing（报告引用的截图不存在）
// | playwright-noshot（T-1 用 Playwright 但截图目录为空）| playwright-shot（同上但留了截图）。启动时打印 FAKE_HIDDEN_BUILD / FAKE_HIDDEN_EVIDENCE（03/04 是否被藏起）。
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import { fileURLToPath } from 'node:url';

export const FAKE_CLAUDE_EVAL = fileURLToPath(import.meta.url);

if (process.argv[1] && path.resolve(process.argv[1]) === FAKE_CLAUDE_EVAL) {
const argv = process.argv.slice(2);
const prompt = argv.includes('-p') ? argv[argv.indexOf('-p') + 1] : fs.readFileSync(0, 'utf8');
if (process.env.FAKE_EVAL_PROMPT_CAPTURE_PATH) fs.writeFileSync(process.env.FAKE_EVAL_PROMPT_CAPTURE_PATH, prompt);
const field = (name) => (prompt.match(new RegExp(`^${name}: (.*)$`, 'm')) || [])[1] ?? '';
const mode = process.env.FAKE_EVAL_MODE || 'pass';
const sprint = field('SPRINT_DIR');
const url = field('PREVIEW_URL');
const qaIds = field('QA_IDS').split(',').filter(Boolean);
console.error(`FAKE_HIDDEN_BUILD: ${!fs.existsSync(path.join(sprint, '03-build.md'))}`);
console.error(`FAKE_HIDDEN_EVIDENCE: ${!fs.existsSync(path.join(sprint, '04-evidence.md'))}`);
console.error(`FAKE_PREVIEW_URL: ${url}`);
console.error(`FAKE_WORKTREE: ${field('WORKTREE')}`);
console.error(`FAKE_PRODUCTION: ${field('PRODUCTION')}`);
console.error(`FAKE_JUDGE_FEEDBACK: ${field('JUDGE_FEEDBACK')}`);
console.error(`FAKE_PREV_ERRORS: ${field('PREV_ERRORS')}`);
if (mode === 'bridge') {
  if (!process.env.CURL_HOME || !prompt.includes('HTTP + browser')) throw new Error('bridge_transport_missing');
  console.error(`FAKE_CURL_HOME: ${process.env.CURL_HOME}`);
}

let n = 0;
const emit = (command, output) => {
  if (mode === 'fabricate') return;
  n += 1;
  if (process.env.FAKE_EVAL_NATIVE === 'codex') {
    console.log(JSON.stringify({ type: 'item.completed', item: { id: `c${n}`, type: 'command_execution', command, aggregated_output: output, exit_code: 0, status: 'completed' } }));
    return;
  }
  console.log(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id: `t${n}`, name: 'Bash', input: { command } }] } }));
  console.log(JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: `t${n}`, content: output }] } }));
};
const F = '```';
const sections = [];
const tested = mode === 'incomplete' ? qaIds.slice(0, 1) : qaIds;
tested.forEach((q, i) => {
  const playwright = (mode === 'playwright-noshot' || mode === 'playwright-shot') && i === 0;
  const command = mode === 'unittest' && i === 0 ? 'npx vitest run scripts/x.test.mjs'
    : mode === 'trivial' && i === 0 ? `curl -s ${url}/api/brain/check?q=${q} || true`
      : playwright ? `node qa-page.mjs ${url}/` : `curl -s ${url}/api/brain/check?q=${q}`;
  if (playwright) emit('cat > qa-page.mjs <<EOF\nconst { chromium } = require("playwright");\nEOF', '');
  if (mode === 'playwright-shot' && i === 0) {
    fs.mkdirSync(field('SHOTS_DIR'), { recursive: true });
    fs.writeFileSync(path.join(field('SHOTS_DIR'), 'home.png'), 'png');
  }
  const output = mode === 'bridge' ? execFileSync('/bin/sh', ['-c', command], { encoding: 'utf8' }).trim() : `{"ok":true,"scenario":"${q}"}`;
  emit(command, output);
  const last = i === tested.length - 1;
  const verdict = mode === 'fail' && last ? 'FAIL' : (mode === 'cannot' || mode === 'cannot-noreason') && last ? 'CANNOT_VERIFY' : 'PASS';
  const reason = mode === 'cannot' && last ? '原因: 工具缺失：预览环境没有 ffprobe，无法验证视频流\n' : '';
  const shot = mode === 'shot-missing' && i === 0 ? `截图: ${path.basename(field('SHOTS_DIR'))}/missing.png\n` : '';
  sections.push(`### T-${i + 1}\n对应: ${q}\nverdict: ${verdict}\n${reason}${shot}${F}command\n${command}\n${F}\n${F}output\n${output}\n${F}\n`);
});
if (mode === 'finding') {
  const command = `curl -s -X POST ${url}/api/brain/tasks -d '{}'`;
  emit(command, '{"error":"internal"} 500');
  sections.push(`### X-1\n对应: ${qaIds[0]}\n严重度: 阻断\n场景: 用户提交空 body 拿到 500\nverdict: FAIL\n${F}command\n${command}\n${F}\n${F}output\n{"error":"internal"} 500\n${F}\n`);
}
if (mode === 'prod') emit('curl -s http://localhost:5221/api/brain/tasks', '[]');
if (mode === 'prod-hk') emit('curl -s http://100.86.118.99:5200/api/health', '{}');
const upstream = qaIds.map((q) => `"02-spec.md#${q}"`).join(', ');
const body = mode === 'badformat' ? '看起来都好。\n' : sections.join('\n');
fs.writeFileSync(field('REPORT_PATH'), `---\ntask_id: ${field('TASK_ID')}\nstep: evaluate\nupstream: [${upstream}]\n---\n# QA 报告\n\n${body}`);
if (mode === 'outside') fs.writeFileSync('stray.txt', 'x\n');
console.log(JSON.stringify(process.env.FAKE_EVAL_NATIVE === 'codex'
  ? { type: 'turn.completed', usage: { input_tokens: 100, output_tokens: 20 } }
  : { type: 'result', subtype: 'success', is_error: false, total_cost_usd: 0.7 }));
}
