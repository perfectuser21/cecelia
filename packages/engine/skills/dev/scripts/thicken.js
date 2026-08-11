#!/usr/bin/env node
// thicken.js — 升级 Feature thickness (Brain-first)
// 用法：node thicken.js --feature-id "<id>" --to "medium" \
//                       --reason "升级证据" \
//                       --replaces-old-thin "apps/api/src/mocks/X.ts"

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

const required = ['feature-id', 'to', 'reason', 'replaces-old-thin'];
for (const r of required) {
  if (!args[r]) { console.error(`MISSING: --${r}`); process.exit(1); }
}

if (args.reason.length < 20) {
  console.error('--reason 必须至少 20 字符，描述升级的真实证据（不是空话）');
  process.exit(1);
}

const replaces = args['replaces-old-thin'].trim();
if (replaces.length < 5 || /^(none|n\/a|nothing|tbd|todo|无)$/i.test(replaces)) {
  console.error('--replaces-old-thin 不能空 / "none" / "无"。');
  console.error('加厚 = 先删旧再写新（减肥后增肌）。必须列出要删除的旧实现具体路径或函数名。');
  process.exit(1);
}
const fakeKeywords = /(_legacy|_old|TODO|todo|稍后删|后续删|will remove)/;
if (fakeKeywords.test(replaces)) {
  console.error(`--replaces-old-thin 含可疑关键字（${replaces.match(fakeKeywords)[0]}）。`);
  console.error('改名 / TODO 注释不算删除。请提供真删除的路径（git rm 后的文件）。');
  process.exit(1);
}

const BRAIN_URL = process.env.BRAIN_URL || 'http://localhost:5221';
const order = ['thin', 'medium', 'thick', 'mature'];

(async () => {
  const toIdx = order.indexOf(args.to);
  if (toIdx === -1) {
    console.error(`Invalid --to: ${args.to}. Must be: ${order.join(', ')}`);
    process.exit(1);
  }

  const resp = await fetch(`${BRAIN_URL}/api/brain/journey_features/${args['feature-id']}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...brainInternalAuthHeaders() },
    body: JSON.stringify({ thickness: args.to }),
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    console.error(`Brain API 错误 ${resp.status}: ${err.error || resp.statusText}`);
    process.exit(1);
  }

  const feature = await resp.json();
  console.log('✅ Feature thickness 升级成功');
  console.log('  Feature ID:', feature.id);
  console.log('  Thickness:', feature.thickness);
  console.log('  Notion 同步: 待 Brain tick 重推（notion_synced_at=null）');
  console.log('  Old implementation removed:', replaces);
  console.log('');
  console.log('下一步建议：');
  console.log('  1. 验证 git 历史里有两段式 commit（commit 1 删旧 / commit 2 写新）');
  console.log('  2. 检查 Journey Maturity 是否可升级（用 status.js 看整体进度）');
})().catch(e => { console.error(e.message); process.exit(1); });
