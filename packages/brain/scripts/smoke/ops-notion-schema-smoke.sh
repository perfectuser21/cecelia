#!/usr/bin/env bash
# ops-notion-schema-smoke — 守「推送要发的列 / 库定义给的列 / 回读能读的列」三者一致。
# 血训：09-06 记过一次「复用已有库须单独 PATCH 补列」，09-08 又踩——新加的 Liveness/SilentFor
# 没进库定义，推送 400 被 upsertOpsRows 的逐行 catch 吞掉，看板静默停更两天。这个闸防第三次。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
node --input-type=module -e "
import { OPS_DB_PROPS } from './src/ops-notion-schema.js';
import { readFileSync } from 'fs';
const push = readFileSync('./src/notion-push-sync.js', 'utf8');
const script = readFileSync('../../scripts/ops/create-ops-notion-dbs.js', 'utf8');
const fail = (m) => { console.error('FAIL: ' + m); process.exit(1); };
const pass = (m) => console.log('PASS: ' + m);

// ① 推送构造里 p.Xxx = 的每个列，库定义必须有（少一个就是上线即 400）
const emitted = [...push.matchAll(/\bp\.([A-Za-z][A-Za-z0-9]*)\s*=/g)].map((m) => m[1]);
const wfCols = new Set(Object.keys(OPS_DB_PROPS.workflows));
const unitCols = new Set(Object.keys(OPS_DB_PROPS.graph));
const runCols = new Set(Object.keys(OPS_DB_PROPS.runs));
const known = new Set([...wfCols, ...unitCols, ...runCols]);
const missing = [...new Set(emitted)].filter((c) => !known.has(c));
if (missing.length) fail('推送发了库定义里没有的列: ' + missing.join(', ') + ' —— 上线即 400 静默停更');
pass('推送用到的 ' + new Set(emitted).size + ' 个列全在库定义里');

// ② 回读认的人工列，库定义必须有（否则人在 Notion 上没地方填，双向等于没做）
const MANUAL = ['Owner', 'Note', 'Priority', 'Starred', 'Stage', 'Enabled', 'Org', 'RoleManual'];
for (const c of MANUAL) {
  if (!push.includes(\"'\" + c + \"'\")) fail('回读未认人工列 ' + c);
}
for (const c of ['Owner', 'Note', 'Priority', 'Starred']) {
  for (const db of ['workflows', 'graph', 'skills']) {
    if (!(c in OPS_DB_PROPS[db])) fail(db + ' 库缺人工列 ' + c);
  }
}
if (!('Enabled' in OPS_DB_PROPS.workflows)) fail('workflows 缺 Enabled（停用意图入口）');
if (!('Stage' in OPS_DB_PROPS.skills)) fail('skills 缺 Stage（档位人工覆盖）');
pass('回读认的人工列都在库定义里');

// ③ 人工列绝不能被推送发出去（发了会冲掉主理人在 Notion 改的）
const leaked = MANUAL.filter((c) => new RegExp('\\\\bp\\\\.' + c + '\\\\s*=').test(push));
if (leaked.length) fail('推送发了人工列: ' + leaked.join(', ') + ' —— 会冲掉主理人的修改');
pass('推送不发任何人工列');

// ④ 四库定义齐全，且 skills 已被建库脚本纳管（此前它只靠手动灌数据，仓库无代码维护）
for (const db of ['graph', 'workflows', 'skills', 'runs']) {
  if (!OPS_DB_PROPS[db]) fail('库定义缺 ' + db);
}
if (!script.includes('skills_db')) fail('建库脚本未纳管 skills_db');
if (!script.includes('ensureProps')) fail('建库脚本没有幂等补列——复用已有库时不补列正是本次事故根因');
pass('四库定义齐全，skills 已纳管，补列幂等');
console.log('OK ops-notion-schema-smoke passed');
"
