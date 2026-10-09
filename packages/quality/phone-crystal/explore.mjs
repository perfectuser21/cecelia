#!/usr/bin/env node
// explore.mjs — 带轨迹记录的探索器（技能蒸馏第①步：纯 LLM 跑并留证据）
//
// 与 ab-test/ab.mjs 的关键差别：ab.mjs 每步的 act 执行完即丢，只返回汇总统计，
// 提炼器因此没有输入；截图 tag 用 a0/a1 固定名，第二次跑直接覆盖前一次证据
// （违反决策 28ca1f69 第①条「文件名必须带 trial+timestamp，禁复用覆盖」）。
//
// 本文件记录每一步：截图路径、LLM 原文、解析出的动作、执行结果、耗时、token。
// 并要求 LLM 在给动作时同时给出 role（控件语义名）——把语义判断前移到 LLM 本来
// 就在做的那一步，使后续提炼成为纯机械转换，不必再调一次模型（决策 ca9f3d7b：
// 能程序化就不用 AI）。
//
// 用法: node explore.mjs --name open_publish --task "打开抖音发布页" [--target xxx] [--max-steps 12]

import * as L from './lib.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';

const args = {};
for (let i = 2; i < process.argv.length; i += 2) args[process.argv[i].replace(/^--/, '')] = process.argv[i + 1];

const NAME = args.name || 'unnamed';
const TASK = args.task || '';
const TARGET = args.target ?? '';
const MAX = Number(args['max-steps'] ?? 12);
const STAMP = new Date().toISOString().replace(/[:.]/g, '-');
const TRIAL = args.trial ?? STAMP;

if (!TASK) { console.error('必须给 --task'); process.exit(2); }
mkdirSync('./traces', { recursive: true });

const SYS = `你是安卓 UI 操作代理。每次看一张截图，只输出一个 JSON 动作，不要解释、不要 markdown。
可用动作：
{"action":"tap","x":<0-1000>,"y":<0-1000>,"role":"<控件语义名>","describe":"<一句话说清它是什么>"}
{"action":"type","text":"<要输入的文字>","describe":"..."}
{"action":"key","code":"ENTER","describe":"..."}
{"action":"done","describe":"任务已完成的理由"}
坐标为千分比，原点左上角，x 向右，y 向下。
role 用小写下划线（如 search_entry / tab_users / publish_entry），必须是控件的稳定语义名，
不要包含坐标或页面序号。同一个控件在任何一轮都要用同一个 role——这个名字会被固化进技能。`;

const trace = {
  name: NAME, task: TASK, target: TARGET, trial: String(TRIAL),
  device: { model: L.deviceModel(), app_version: L.appVersion(), density: String(L.density()) },
  started_at: new Date().toISOString(),
  steps: [],
};

const t0 = Date.now();
const u0 = { ...L.usage };
L.resetApp();
L.sleep(2500);

let doneClaimed = false;
for (let i = 0; i < MAX; i++) {
  // 截图 tag 带 name+trial+序号 —— 三段齐全，任何一轮都不会互相覆盖
  const shot = L.screenshot(`ex-${NAME}-${TRIAL}-${i}`);
  const askedAt = Date.now();
  const raw = await L.vision(SYS, `任务：${TASK}${TARGET ? `\n目标参数：${TARGET}` : ''}\n给出下一个动作。`, shot);
  const act = L.parseJson(raw);

  const rec = {
    i, screenshot: shot, asked_ms: Date.now() - askedAt,
    llm_raw: String(raw).slice(0, 400), action: act ?? null,
    executed: false, error: null,
  };

  if (!act) { rec.error = 'unparsable_llm_output'; trace.steps.push(rec); L.sleep(600); continue; }
  if (act.action === 'done') { doneClaimed = true; trace.steps.push(rec); break; }

  try {
    if (act.action === 'tap') L.tapPermille(act.x, act.y);
    else if (act.action === 'type') L.typeText(act.text ?? TARGET);
    else if (act.action === 'key') L.key(act.code === 'BACK' ? 'KEYCODE_BACK' : 'KEYCODE_ENTER');
    else { rec.error = `unknown_action:${act.action}`; }
    rec.executed = !rec.error;
  } catch (e) { rec.error = String(e.message).slice(0, 160); }

  trace.steps.push(rec);
  L.sleep(1800);
}

trace.done_claimed = doneClaimed;
trace.ms = Date.now() - t0;
trace.tokens = (L.usage.prompt - u0.prompt) + (L.usage.completion - u0.completion);
trace.llm_calls = L.usage.calls - u0.calls;
trace.finished_at = new Date().toISOString();

// 执行者自称成功不可信（决策 28ca1f69：A臂第1轮 doneClaimed=true 但停在桌面）。
// 这里只记录 done_claimed，真正的 ok 由 verify 阶段的 postcondition 判定，本文件不下结论。
const out = `./traces/trace-${NAME}-${TRIAL}.json`;
writeFileSync(out, JSON.stringify(trace, null, 2));
console.log(JSON.stringify({
  name: NAME, trial: String(TRIAL), steps: trace.steps.length,
  done_claimed: doneClaimed, ms: trace.ms, tokens: trace.tokens,
  llm_calls: trace.llm_calls, trace_file: out,
}));
