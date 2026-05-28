#!/usr/bin/env node
// init-journey.js — 创建一条新 Journey (Brain-first)
// 用法：node init-journey.js --name "X" --area "ZenithJoy" --type "user_facing" --description "..." --e2e-path "..." --steps "step1|step2|step3"

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

const required = ['name', 'type'];
for (const r of required) {
  if (!args[r]) { console.error(`MISSING: --${r}`); process.exit(1); }
}

const validTypes = ['user_facing', 'autonomous', 'dev_pipeline', 'agent_remote'];
if (!validTypes.includes(args.type)) {
  console.error(`Invalid --type. Must be one of: ${validTypes.join(', ')}`);
  process.exit(1);
}

const BRAIN_URL = process.env.BRAIN_URL || 'http://localhost:5221';

(async () => {
  const steps = args.steps ? args.steps.split('|').map(s => s.trim()).filter(Boolean) : [];

  const resp = await fetch(`${BRAIN_URL}/api/brain/journeys`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: args.name,
      journey_type: args.type,
      description: args.description || '',
      area: args.area || null,
      e2e_test_path: args['e2e-path'] || '',
      steps,
    }),
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    console.error(`Brain API 错误 ${resp.status}: ${err.error || resp.statusText}`);
    process.exit(1);
  }

  const journey = await resp.json();
  console.log('✅ Journey 已写入 Brain DB');
  console.log('  ID:', journey.id);
  console.log('  名称:', journey.name);
  console.log('  Notion 同步: 待 Brain tick 推送（notion_synced_at=null）');
  console.log('');
  console.log('下一步：用 add-feature.js 给每个 step 挂第一个 thin Feature');
  console.log(`  node add-feature.js --name "..." --journey-id "${journey.id}" --area "${args.area || ''}"`);
})().catch(e => { console.error(e.message); process.exit(1); });
