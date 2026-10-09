#!/usr/bin/env node
/**
 * emit-step-span.mjs — 技能每做完一步发一条 Step span（树+仓库 v3.0 第 4 刀，路 B）
 *
 * 用法:
 *   node packages/brain/scripts/emit-step-span.mjs <run_id> <activity_id> <step_key> <pass|fail|skipped|unknown> \
 *     [--observed <值或JSON>] [--name 名字] [--action 动作] [--reads A.x,B.y] [--writes C.z] [--field 字段] \
 *     [--attempts N] [--executor agent|code|human]
 *   环境变量 BRAIN_URL（默认 http://localhost:5221）。
 *
 * 约定的证据格式：evidence = { step_key, name?, action?, reads?, writes?, observed?, field? }。
 * 沉淀技能（POST /api/brain/skill-settlement/draft）读它起草 Steps，收敛对账（POST /api/brain/step-reconcile/:activityId）
 * 拿 observed 对 Steps.readback。没传的不编造：没有 --observed 就没有 observed 这个键。
 */
import { fileURLToPath } from 'node:url';

const OUTCOMES = new Set(['pass', 'fail', 'skipped', 'unknown']);
const EXECUTORS = new Set(['code', 'agent', 'human']);
const STEP_KEY = /^[a-z][a-z0-9_]*$/;

export function parseArgs(argv) {
  const positional = [], opts = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i].startsWith('--')) { opts[argv[i].slice(2)] = argv[i + 1]; i += 1; } else positional.push(argv[i]);
  }
  const [run, activity, step, outcome] = positional;
  if (!run || !activity || !step || !outcome) {
    throw new Error('用法: emit-step-span.mjs <run_id> <activity_id> <step_key> <pass|fail|skipped|unknown> [--observed ..] [--name ..] [--action ..] [--reads ..] [--writes ..] [--field ..] [--attempts N] [--executor ..]');
  }
  return { run, activity, step, outcome, ...opts };
}

const list = text => (text ? text.split(',').map(s => s.trim()).filter(Boolean) : undefined);
function parseObserved(text) {
  try { return JSON.parse(text); } catch { return text; }
}

export function buildStepSpan(a, now = () => new Date()) {
  if (!OUTCOMES.has(a.outcome)) throw new Error(`outcome 必须是 ${[...OUTCOMES].join('|')}`);
  if (!STEP_KEY.test(a.step)) throw new Error('step 必须是 snake_case 键');
  const executor = a.executor ?? 'agent';
  if (!EXECUTORS.has(executor)) throw new Error(`executor 必须是 ${[...EXECUTORS].join('|')}`);
  const at = now().toISOString();
  const evidence = { step_key: a.step };
  if (a.name) evidence.name = a.name;
  if (a.action) evidence.action = a.action;
  if (a.reads) evidence.reads = list(a.reads);
  if (a.writes) evidence.writes = list(a.writes);
  if (a.observed !== undefined) evidence.observed = parseObserved(a.observed);
  if (a.field) evidence.field = a.field;
  return {
    run_id: a.run, activity_id: a.activity, started_at: at, ended_at: at, executor_kind: executor,
    attempts: a.attempts ? Number(a.attempts) : 1, outcome: a.outcome, evidence,
  };
}

async function main(argv) {
  const span = buildStepSpan(parseArgs(argv));
  const base = process.env.BRAIN_URL || 'http://localhost:5221';
  const res = await fetch(`${base}/api/brain/spans`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(span) });
  const text = await res.text();
  if (!res.ok) throw new Error(`POST /spans ${res.status}: ${text}`);
  console.log(text);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2)).catch(err => { console.error(err.message); process.exit(1); });
}
