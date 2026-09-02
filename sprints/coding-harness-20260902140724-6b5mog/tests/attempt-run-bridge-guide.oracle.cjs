#!/usr/bin/env node
const fs = require('node:fs');

const TASK_REQUEST_HASH = '83916a00537fa91361e9226d897605f62da559f9c65f04cdac3badec865baf81';
const IMPLEMENTATION_BASELINE = 'd32b864de5adf8d3083c91f31ed3f5f7f58be985';
const docPath = 'docs/current/attempt-run-bridge-guide.md';
let text;
const mode = process.argv[2];

function demand(condition, message) {
  if (!condition) throw new Error(message);
}

function section(title) {
  text ??= fs.readFileSync(docPath, 'utf8');
  const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = text.match(new RegExp(`^## ${escaped}\\s*$([\\s\\S]*?)(?=^## |\\Z)`, 'm'));
  demand(match, `缺少章节：${title}`);
  return match[1];
}

if (mode === 'endpoints-auth') {
  const s = section('端点与鉴权');
  demand(s.includes('POST /api/brain/harness/attempt-run') && /异步派发|创建/.test(s), 'POST 用途不完整');
  demand(s.includes('GET /api/brain/harness/attempt-run/:id') && /查询|轮询/.test(s), 'GET 用途不完整');
  demand(s.includes('internalAuthOrLoopback'), '缺鉴权中间件名');
  demand(/Authorization:\s*Bearer\s+\$?CECELIA_INTERNAL_TOKEN/.test(s), '缺 Bearer header');
  demand(!/宿主|远端/.test(s) || !/宿主.{0,20}免鉴权|远端.{0,20}免鉴权/.test(s), '错误宣称远端免鉴权');
} else if (mode === 'roles') {
  const s = section('角色白名单');
  const actual = [...s.matchAll(/^\s*-\s+`([^`]+)`\s*$/gm)].map((m) => m[1]).sort();
  const expected = ['canary','planner','proposer','reviewer','generator','generator-fix','evaluator','evaluator-evidence-repair','judge'].sort();
  demand(JSON.stringify(actual) === JSON.stringify(expected), `角色集合不等于九项权威集合: ${actual.join(',')}`);
  demand(!actual.includes('commander') && !actual.includes('publisher'), '包含非白名单角色');
  demand(/封闭|仅支持|只支持/.test(s), '未说明白名单封闭');
} else if (mode === 'payload') {
  const s = section('请求 payload');
  for (const key of ['sprint_dir', 'base_repo', 'branch']) demand(new RegExp(`\\b${key}\\b[^\\n]*(必填|required)`, 'i').test(s), `${key} 未标必填`);
  demand(/base_sha[^\n]*(可省略|非必填)/.test(s), 'base_sha 未标可省略');
  demand(/base_sha[^\n]*生产 Brain[^\n]*自解析|生产 Brain[^\n]*自解析[^\n]*base_sha/.test(s), '缺生产 Brain 自解析语义');
  demand(!/必填[^\n]*base_sha|base_sha[^\n]*必填/.test(s), 'base_sha 被误列为必填');
} else if (mode === 'rollback') {
  const s = section('派发失败自动回滚');
  for (const pair of [['run','failed'], ['session','closed'], ['task','cancelled']]) demand(new RegExp(`${pair[0]}\\s*(?:→|->)\\s*${pair[1]}`).test(s), `缺回滚映射 ${pair.join('→')}`);
  demand(/自动/.test(s), '未说明自动回滚');
} else if (mode === 'manager-feedback') {
  const sprintDir = 'sprints/coding-harness-20260902140724-6b5mog';
  const draft = fs.readFileSync(`${sprintDir}/contract-draft.md`, 'utf8');
  const dod = fs.readFileSync(`${sprintDir}/contract-dod.md`, 'utf8');
  const carrier = fs.readFileSync(`${sprintDir}/tests/attempt-run-bridge-guide.test.ts`, 'utf8');
  for (const artifact of [draft, dod, carrier]) demand(artifact.includes(TASK_REQUEST_HASH), '三件套载体缺冻结 task_request_hash');
  demand(draft.includes('source_stage_attempt: 2'), '缺 source_stage_attempt=2');
  demand(draft.includes('source_idempotency_key: coding-harness-20260902140724-6b5mog:a1:contract:2'), '缺 source_idempotency_key');
  demand(draft.includes('unresolved: []'), '缺 unresolved=[]');
  const fixes = [
    'Exact frozen task_request_hash inside contract-draft.md, contract-dod.md, and Test Contract carrier',
    'Pair every positive oracle one-to-one with a concrete negative oracle',
    'Fresh reviewer APPROVED with blockers empty',
    'Complete seal_coordinates from approved SHA',
  ];
  for (const fix of fixes) demand(draft.includes(fix), `缺 fresh evidence 修正项: ${fix}`);
  demand(draft.includes('oracle.cjs manager-feedback'), '缺 manager feedback DoD/Test Contract 执行入口');
  demand(dod.includes('source_stage_attempt=2') && dod.includes('unresolved=[]'), 'DoD 缺精确 manager feedback ack');
} else {
  throw new Error(`未知 oracle: ${mode}; frozen=${TASK_REQUEST_HASH}; baseline=${IMPLEMENTATION_BASELINE}`);
}
console.log(`OK ${mode}`);
