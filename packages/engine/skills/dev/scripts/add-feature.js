#!/usr/bin/env node
// add-feature.js — 挂一个 Feature 到指定 Journey (Brain-first)
// 用法：node add-feature.js --name "X" --journey-id "<id>" --area "ZenithJoy" [--thickness thin] [--unit-test-path "..."] [--reason "为何不是 thin"]

import { brainInternalAuthHeaders } from './brain-auth.js';

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      args[key] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
    }
  }
  return args;
}
const args = parseArgs(process.argv);

const required = ['name'];
for (const r of required) {
  if (!args[r]) { console.error(`MISSING: --${r}`); process.exit(1); }
}

const thickness = args.thickness || 'thin';
const validThickness = ['thin', 'medium', 'thick', 'mature'];
if (!validThickness.includes(thickness)) {
  console.error(`Invalid --thickness. Must be: ${validThickness.join(', ')}`);
  process.exit(1);
}

if (thickness !== 'thin' && !args.reason) {
  console.error(`新 Feature 默认 thin。要直接建 ${thickness} 必须给 --reason "理由"`);
  console.error(`Walking Skeleton 纪律：第一刀骨架必须 thin 优先，跳级是反模式。`);
  process.exit(1);
}

const BRAIN_URL = process.env.BRAIN_URL || 'http://localhost:5221';

(async () => {
  const resp = await fetch(`${BRAIN_URL}/api/brain/journey_features`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...brainInternalAuthHeaders() },
    body: JSON.stringify({
      name: args.name,
      journey_id: args['journey-id'] || null,
      thickness,
      area: args.area || null,
      unit_test_path: args['unit-test-path'] || null,
      workflow_ref: args['workflow-ref'] || null,
      guard_ref: args['guard-ref'] || null,
    }),
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    console.error(`Brain API 错误 ${resp.status}: ${err.error || resp.statusText}`);
    process.exit(1);
  }

  const feature = await resp.json();
  console.log('✅ Feature 已写入 Brain DB');
  console.log('  ID:', feature.id);
  console.log('  名称:', feature.name, ', thickness:', feature.thickness);
  console.log('  Notion 同步: 待 Brain tick 推送');
})().catch(e => { console.error(e.message); process.exit(1); });
