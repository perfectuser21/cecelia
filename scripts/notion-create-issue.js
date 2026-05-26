#!/usr/bin/env node
/**
 * notion-create-issue.js — 在 Brain DB 创建 issue（Brain-first），Brain tick 推送 Notion。
 *
 * 用法：
 *   node scripts/notion-create-issue.js \
 *     --title "evaluator 幂等门缺失" \
 *     --priority P1 \
 *     --sub-area brain \
 *     --body "问题描述..." \
 *     --pr-url "https://github.com/..."
 */

const path = require('path');

const PATH_TO_SUB_AREA = [
  [/packages\/brain/, 'brain'],
  [/packages\/engine/, 'engine'],
  [/apps\/dashboard/, 'dashboard'],
  [/apps\/api/, 'zenithjoy'],
  [/packages\/workflows/, 'multi-agent'],
];

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

function inferSubAreaFromGit() {
  try {
    const { execFileSync } = require('child_process');
    const diff = execFileSync('git', ['diff', '--name-only', 'HEAD'], { encoding: 'utf8' });
    const staged = execFileSync('git', ['diff', '--name-only', '--cached'], { encoding: 'utf8' });
    const files = (diff + staged).split('\n');
    for (const [pattern, area] of PATH_TO_SUB_AREA) {
      if (files.some(f => pattern.test(f))) return area;
    }
  } catch {}
  return null;
}

async function main() {
  const args = parseArgs(process.argv);

  if (!args.title) {
    console.error('Usage: node scripts/notion-create-issue.js --title "..." [--priority P1] [--sub-area brain] [--body "..."] [--pr-url "..."]');
    process.exit(1);
  }

  const BRAIN_URL = process.env.BRAIN_URL || 'http://localhost:5221';
  const priority = args.priority || 'P2';
  const subArea = (args['sub-area'] || inferSubAreaFromGit() || null);
  const body = args.body || '';
  const prUrl = args['pr-url'] || '';

  const resp = await fetch(`${BRAIN_URL}/api/brain/issues`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: args.title,
      priority,
      sub_area: subArea,
      body: body || null,
      pr_url: prUrl || null,
    }),
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    console.error(`Brain API 错误 ${resp.status}: ${err.error || resp.statusText}`);
    process.exit(1);
  }

  const issue = await resp.json();
  console.log('✅ Issue 已写入 Brain DB');
  console.log('  ID:', issue.id);
  console.log('  标题:', issue.title, ', 优先级:', issue.priority);
  console.log('  Notion 同步: 待 Brain tick 推送');
}

main().catch(e => { console.error(e.message); process.exit(1); });
