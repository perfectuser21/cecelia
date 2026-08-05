#!/usr/bin/env bash
# notion-capture-ingest smoke — 验证 Notion Inbox 增量采集 MVP DoD
# 1. 已挂 scheduler-jobs（name: 'notion-capture-ingest'）
# 2. 凭据从 process.env 读取（无硬编码 token）
# 3. dedupe_key 使用 'notion:inbox:' 前缀（幂等锚）
# 4. migration 388 含 notion_page_id 字段
set -euo pipefail

echo "[notion-capture-ingest-smoke] 1. scheduler 挂载"
node -e "
const fs = require('fs');
const sched = fs.readFileSync('packages/brain/src/scheduler-jobs.js', 'utf8');
if (!sched.includes(\"name: 'notion-capture-ingest'\")) {
  console.error('FAIL: scheduler-jobs 缺 notion-capture-ingest 挂载');
  process.exit(1);
}
console.log('scheduler 挂载 ✓');
"

echo "[notion-capture-ingest-smoke] 2. 凭据从 process.env 读取"
node -e "
const fs = require('fs');
const src = fs.readFileSync('packages/brain/src/notion-capture-ingest.js', 'utf8');
if (!src.includes('NOTION_INBOX_TOKEN') || !src.includes('NOTION_INBOX_DB_ID')) {
  console.error('FAIL: 缺 NOTION_INBOX_TOKEN / NOTION_INBOX_DB_ID 环境变量引用');
  process.exit(1);
}
if (!src.includes('process.env')) {
  console.error('FAIL: 未从 process.env 读取凭据');
  process.exit(1);
}
console.log('凭据 env 读取 ✓');
"

echo "[notion-capture-ingest-smoke] 3. dedupe_key 幂等锚"
node -e "
const fs = require('fs');
const src = fs.readFileSync('packages/brain/src/notion-capture-ingest.js', 'utf8');
if (!src.includes(\"notion:inbox:\")) {
  console.error('FAIL: dedupe_key 缺 notion:inbox: 前缀');
  process.exit(1);
}
console.log('dedupe_key 幂等锚 ✓');
"

echo "[notion-capture-ingest-smoke] 4. migration 388 含 notion_page_id"
node -e "
const fs = require('fs');
const path = require('path');
const migDir = 'packages/brain/migrations';
const migFile = path.join(migDir, '388_captures_notion_page_id.sql');
if (!fs.existsSync(migFile)) {
  console.error('FAIL: migration 388_captures_notion_page_id.sql 不存在');
  process.exit(1);
}
const sql = fs.readFileSync(migFile, 'utf8');
if (!sql.includes('notion_page_id')) {
  console.error('FAIL: migration 388 未含 notion_page_id 字段');
  process.exit(1);
}
console.log('migration 388 ✓');
"

echo "[notion-capture-ingest-smoke] 全部通过 ✅"
