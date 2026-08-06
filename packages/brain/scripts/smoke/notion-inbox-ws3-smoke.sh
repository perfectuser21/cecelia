#!/usr/bin/env bash
# notion-inbox-ws3-smoke.sh — WS3 成品呈报 + 裁决窄口 Notion Inbox 接缝验证
# task: 58e146e1-ff3a-4e4d-89de-17721a0ade6b
# 验证: FR-1 notion-inbox-push.js / FR-2 notion-verdict-ingest.js / FR-3 scheduler-jobs.js 注册
set -euo pipefail

BRAIN_SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../src" && pwd)"

echo "=== WS3 smoke: notion-inbox-push.js 文件接缝 ==="
node -e "
const fs = require('fs');
const c = fs.readFileSync('${BRAIN_SRC}/notion-inbox-push.js', 'utf8');
if (!c.includes('pushProductToNotionInbox')) { console.error('FAIL: 函数不存在'); process.exit(1); }
if (!c.includes('notion:product:')) { console.error('FAIL: 幂等键前缀缺失'); process.exit(1); }
['proposal','morning_summary','acceptance_receipt'].forEach(t => {
  if (!c.includes(t)) { console.error('FAIL: 白名单类型缺失: '+t); process.exit(1); }
});
if (!c.includes('notion_page_id')) { console.error('FAIL: notion_page_id 回写逻辑缺失'); process.exit(1); }
console.log('OK: notion-inbox-push.js 接缝全通');
"

echo "=== WS3 smoke: notion-verdict-ingest.js 文件接缝 ==="
node -e "
const fs = require('fs');
const c = fs.readFileSync('${BRAIN_SRC}/notion-verdict-ingest.js', 'utf8');
if (!c.includes('consumeVerdictFromNotion')) { console.error('FAIL: 函数不存在'); process.exit(1); }
if (!c.includes('already_consumed')) { console.error('FAIL: 幂等锚点 already_consumed 缺失'); process.exit(1); }
if (!c.includes('not_configured')) { console.error('FAIL: not_configured 凭据处理缺失'); process.exit(1); }
if (!c.includes('completed')) { console.error('FAIL: status=completed 逻辑缺失'); process.exit(1); }
if (!c.includes('decisions')) { console.error('FAIL: decisions 写库逻辑缺失'); process.exit(1); }
console.log('OK: notion-verdict-ingest.js 接缝全通');
"

echo "=== WS3 smoke: scheduler-jobs.js 注册接缝 ==="
node -e "
const fs = require('fs');
const c = fs.readFileSync('${BRAIN_SRC}/scheduler-jobs.js', 'utf8');
if (!c.includes('notion-product-push')) { console.error('FAIL: notion-product-push job 未注册'); process.exit(1); }
if (!c.includes('notion-verdict-ingest')) { console.error('FAIL: notion-verdict-ingest job 未注册'); process.exit(1); }
console.log('OK: scheduler-jobs.js 两个 WS3 job 已注册');
"

echo "=== WS3 smoke: 全部接缝验证通过 ==="
