#!/usr/bin/env node
// 假 claude（合同对抗 v2）：按 FAKE_GAN_SCRIPT（JSON 文件）逐轮回放 QA 评审与开发改写；轮次计数存 FAKE_GAN_STATE。
// script = {
//   reviews: [{ scores: <数字|{维度:分}>, issues: [{id, targets, severity, scene, basis, body}], prior: [{id, status, reason}],
//               raw: <直接写入的正文，模拟格式坏>, cost, tamper: <改 01>, outside: <越界写> }, ...]（超出取最后一条）,
//   revise: { grow: <每轮往 02 末尾追加的行数>, response: '采纳'|'驳回', cost, dropInvariants: 删掉 02 的铁律对照段 }
// }
// 每次运行在 stdout 输出一行 stream-json 的 result 事件（带 total_cost_usd），prompt 里的 PRIOR_OPEN/SPEC_ERRORS/PREV_REVIEW_ERRORS/STUCK 行原样回显到 FAKE_GAN_SEEN。
import fs from 'node:fs';

const argv = process.argv.slice(2);
const prompt = argv[argv.indexOf('-p') + 1] || '';
const field = (name) => (prompt.match(new RegExp(`^${name}: (.*)$`, 'm')) || [])[1] ?? '';
const role = field('ROLE');
const script = JSON.parse(fs.readFileSync(process.env.FAKE_GAN_SCRIPT, 'utf8'));
const statePath = process.env.FAKE_GAN_STATE;
const state = fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, 'utf8')) : { review: 0, revise: 0 };
const DIMS = ['意图对齐', '可验证', '场景覆盖', '回归风险', '可执行'];
const result = (cost) => console.log(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, total_cost_usd: cost ?? 0.1 }));

if (process.env.FAKE_GAN_SEEN) fs.appendFileSync(process.env.FAKE_GAN_SEEN, `${role} PRIOR_OPEN=${field('PRIOR_OPEN')} SPEC_ERRORS=${field('SPEC_ERRORS')} PREV_REVIEW_ERRORS=${field('PREV_REVIEW_ERRORS')} STUCK=${field('STUCK')}\n`);

if (role === 'spec_review') {
  const r = script.reviews[Math.min(state.review, script.reviews.length - 1)];
  state.review += 1;
  fs.writeFileSync(statePath, JSON.stringify(state));
  const upstream = field('SPEC_IDS').split(',').filter(Boolean).map((id) => `"02-spec.md#${id}"`).join(', ');
  const fm = `---\ntask_id: ${field('TASK_ID')}\nstep: spec_review\nupstream: [${upstream}]\n---\n# 规格评审\n\n`;
  let body = r.raw;
  if (body === undefined) {
    const scores = typeof r.scores === 'number' ? Object.fromEntries(DIMS.map((d) => [d, r.scores])) : r.scores;
    const parts = [`## 评分\n${DIMS.map((d) => `${d}: ${scores[d]}`).join('\n')}`];
    // pivot：卡住时评审给出的换思路段
    if (r.pivot) parts.push('## 换思路\n别再逐条补措辞，改成先定接口再补场景');
    if (r.prior?.length) parts.push(`## 上轮问题\n${r.prior.map((p) => `- ${p.id}: ${p.status} —— ${p.reason ?? '理由'}`).join('\n')}`);
    for (const i of r.issues ?? []) {
      parts.push([`### ${i.id}`, `针对: ${i.targets ?? 'S-1'}`, `严重度: ${i.severity ?? '阻断'}`,
        `场景: ${i.scene ?? '用户重复提交后看到两条任务'}`, `依据: ${i.basis ?? 'activities/x.mjs'}`, i.body ?? '需要处理'].join('\n'));
    }
    body = parts.join('\n\n');
  }
  fs.writeFileSync(field('REVIEW_PATH'), `${fm}${body}\n`);
  if (r.tamper) fs.appendFileSync(field('INTENT_PATH'), '\n篡改\n');
  if (r.outside) fs.writeFileSync('stray.txt', 'out of scope\n');
  result(r.cost);
} else if (role === 'spec_revise') {
  const v = script.revise ?? {};
  state.revise += 1;
  fs.writeFileSync(statePath, JSON.stringify(state));
  const ids = [...fs.readFileSync(field('REVIEW_PATH'), 'utf8').matchAll(/^### (R-\d+)/gm)].map((m) => m[1]);
  fs.writeFileSync(field('RESPONSE_PATH'), ids.map((id) => `### ${id}\n处理: ${v.response ?? '采纳'}\n说明: 第 ${state.revise} 轮已处理`).join('\n\n') + '\n');
  const extra = Array.from({ length: v.grow ?? 1 }, (_, i) => `补充 r${state.revise}-${i}`).join('\n');
  fs.appendFileSync(field('SPEC_PATH'), `${extra}\n`);
  // dropInvariants：改写时把 `## 铁律对照` 整段删掉（模拟开发方改合同时丢了铁律交代）
  if (v.dropInvariants) {
    const text = fs.readFileSync(field('SPEC_PATH'), 'utf8');
    fs.writeFileSync(field('SPEC_PATH'), text.replace(/^## 铁律对照[\s\S]*?(?=^## |(?![\s\S]))/m, ''));
  }
  result(v.cost);
} else {
  console.error(`fake-claude-gan: unknown role ${role}`);
  process.exit(3);
}
