#!/usr/bin/env node
/**
 * notion-create-issue.js — 在 Notion Issues DB 创建 issue，自动填 Sub Area / Project。
 *
 * 用法：
 *   node scripts/notion-create-issue.js \
 *     --title "evaluator 幂等门缺失" \
 *     --priority P1 \
 *     --sub-area brain \
 *     --project cecelia \
 *     --body "问题描述..." \
 *     --pr-url "https://github.com/..."
 *
 * Sub Area 关键词（--sub-area）：
 *   brain | engine | cecelia | dashboard | zenithjoy | multi-agent | geo | investment
 *
 * Project 关键词（--project）：
 *   cecelia | zenithjoy | dashboard | brain | engine | multi-agent
 *
 * 文件路径自动推断（可选，当不传 --sub-area 时从 git diff 推断）：
 *   packages/brain/      → brain
 *   packages/engine/     → engine
 *   apps/dashboard/      → dashboard
 *   apps/api/            → zenithjoy
 */

const fs = require('fs');
const path = require('path');

// ── Notion IDs ──────────────────────────────────────────────────────────────
const ISSUES_DB = 'a17c40c2-ba63-82fb-9888-8152cefe29ec';

const SUB_AREAS = {
  brain:         '5c0c40c2-ba63-8347-9334-01a0129a015a',
  engine:        '64bc40c2-ba63-8212-ab62-012912749a71',
  cecelia:       '7e7c40c2-ba63-839d-b0bc-017f1cc7d49d',
  'multi-agent': '8acc40c2-ba63-8373-8281-0151470389d1',
  zenithjoy:     'cf5c40c2-ba63-82c8-a00a-015c593f6268',
  dashboard:     'a17c40c2-ba63-83e2-b922-8197b09af030',
  geo:           '8d0c40c2-ba63-83c4-b775-011c3768fef0',
  investment:    '8c2c40c2-ba63-820c-a22a-8141950bda50',
};

const PROJECTS = {
  cecelia:       '9b2c40c2-ba63-8216-ba5b-01f844bb46c9',
  brain:         '9b2c40c2-ba63-8216-ba5b-01f844bb46c9', // same as cecelia
  engine:        '9b2c40c2-ba63-8216-ba5b-01f844bb46c9', // same as cecelia
  'multi-agent': '8acc40c2-ba63-8373-8281-0151470389d1',
  zenithjoy:     'bb6c40c2-ba63-8368-ba10-01ad11ff799d',
  dashboard:     'e64c40c2-ba63-8343-aa5a-816d8313d376',
};

// 从 git diff 文件路径推断 sub-area
const PATH_TO_SUB_AREA = [
  [/packages\/brain/, 'brain'],
  [/packages\/engine/, 'engine'],
  [/apps\/dashboard/, 'dashboard'],
  [/apps\/api/, 'zenithjoy'],
  [/packages\/workflows/, 'multi-agent'],
];

// ── 参数解析 ─────────────────────────────────────────────────────────────────
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

// ── Notion API ───────────────────────────────────────────────────────────────
function loadNotionKey() {
  const credPath = path.join(process.env.HOME, '.credentials', 'notion.env');
  const env = {};
  fs.readFileSync(credPath, 'utf8').split('\n')
    .forEach(l => { const m = l.match(/^([^=]+)=(.+)/); if (m) env[m[1]] = m[2]; });
  if (!env.NOTION_API_KEY) throw new Error('NOTION_API_KEY not found in ~/.credentials/notion.env');
  return env.NOTION_API_KEY;
}

async function notionReq(method, endpoint, body, apiKey) {
  const r = await fetch('https://api.notion.com/v1' + endpoint, {
    method,
    headers: {
      'Authorization': 'Bearer ' + apiKey,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json();
  if (!r.ok) throw new Error(`Notion API ${r.status}: ${JSON.stringify(data)}`);
  return data;
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const args = parseArgs(process.argv);

  if (!args.title) {
    console.error('Usage: node scripts/notion-create-issue.js --title "..." [--priority P1] [--sub-area brain] [--project cecelia] [--body "..."] [--pr-url "..."]');
    process.exit(1);
  }

  const priority = args.priority || 'P2';
  const subAreaKey = (args['sub-area'] || inferSubAreaFromGit() || 'cecelia').toLowerCase();
  const projectKey = (args.project || subAreaKey).toLowerCase();
  const body = args.body || '';
  const prUrl = args['pr-url'] || '';

  const subAreaId = SUB_AREAS[subAreaKey];
  const projectId = PROJECTS[projectKey] || PROJECTS.cecelia;

  if (!subAreaId) {
    console.error(`Unknown sub-area: ${subAreaKey}. Valid: ${Object.keys(SUB_AREAS).join(', ')}`);
    process.exit(1);
  }

  const apiKey = loadNotionKey();

  const properties = {
    'Issue': { title: [{ text: { content: args.title } }] },
    'Priority': { select: { name: priority } },
    'Status': { status: { name: 'In progress' } },
    'Sub Area': { relation: [{ id: subAreaId }] },
    'Projects': { relation: [{ id: projectId }] },
  };

  const children = [];
  if (body) {
    children.push(
      { object: 'block', type: 'heading_2', heading_2: { rich_text: [{ text: { content: '问题描述' } }] } },
      { object: 'block', type: 'paragraph', paragraph: { rich_text: [{ text: { content: body } }] } },
    );
  }
  if (prUrl) {
    children.push(
      { object: 'block', type: 'heading_2', heading_2: { rich_text: [{ text: { content: '修复 PR' } }] } },
      { object: 'block', type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content: prUrl, link: { url: prUrl } } }] } },
    );
  }

  const page = await notionReq('POST', '/pages', { parent: { database_id: ISSUES_DB }, properties, children }, apiKey);
  console.log(page.url);
}

main().catch(e => { console.error(e.message); process.exit(1); });
