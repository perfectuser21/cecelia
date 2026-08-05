#!/usr/bin/env bash
# Smoke: notion-inbox — F5 呈报+裁决窄口回读（决策 efa578b8 + 4c595c84）
# 1. notion-inbox-readback 挂载 scheduler-jobs
# 2. pushCapturesToNotionInbox 集成 notion-push-sync 管线
# 3. notion_inbox_items migration 388 存在
# 4. parseVerdictFromProps fail-closed：白名单外全拒
set -euo pipefail

echo "[notion-inbox-smoke] 1. scheduler-jobs 挂载"
node -e "
const fs = require('fs');
const sched = fs.readFileSync('packages/brain/src/scheduler-jobs.js', 'utf8');
if (!sched.includes(\"name: 'notion-inbox-readback'\")) { console.error('FAIL: scheduler-jobs 缺 notion-inbox-readback'); process.exit(1); }
if (!sched.includes('readNotionInboxVerdicts')) { console.error('FAIL: scheduler-jobs 缺 readNotionInboxVerdicts 引用'); process.exit(1); }
console.log('scheduler-jobs 挂载 ✓');
"

echo "[notion-inbox-smoke] 2. notion-push-sync 集成呈报"
node -e "
const fs = require('fs');
const sync = fs.readFileSync('packages/brain/src/notion-push-sync.js', 'utf8');
if (!sync.includes('pushCapturesToNotionInbox')) { console.error('FAIL: notion-push-sync 缺 pushCapturesToNotionInbox 调用'); process.exit(1); }
console.log('notion-push-sync 集成 ✓');
"

echo "[notion-inbox-smoke] 3. migration 388 存在"
node -e "
const fs = require('fs');
const mig = fs.readFileSync('packages/brain/migrations/388_notion_inbox_items.sql', 'utf8');
if (!mig.includes('notion_inbox_items')) { console.error('FAIL: migration 388 缺 notion_inbox_items 建表'); process.exit(1); }
if (!mig.includes('idempotency_key')) { console.error('FAIL: migration 388 缺幂等锚点字段'); process.exit(1); }
console.log('migration 388 ✓');
"

echo "[notion-inbox-smoke] 4. fail-closed 白名单守卫"
node --input-type=module << 'EOF'
import { parseVerdictFromProps, WHITELIST_VERDICTS } from './packages/brain/src/notion-inbox-push.js';
// 散文字段 → null
const textOnly = { 裁决: { type: 'rich_text', rich_text: [{ plain_text: '✅放行' }] } };
if (parseVerdictFromProps(textOnly) !== null) { console.error('FAIL: rich_text 裁决字段未被拦截'); process.exit(1); }
// 待裁决（默认值）→ null
const pending = { 裁决: { type: 'select', select: { name: '待裁决' } } };
if (parseVerdictFromProps(pending) !== null) { console.error('FAIL: 待裁决未被拦截'); process.exit(1); }
// ✅放行 → approve
const approve = { 裁决: { type: 'select', select: { name: '✅放行' } } };
const r = parseVerdictFromProps(approve);
if (!r || r.verdict !== 'approve') { console.error('FAIL: ✅放行 未返回 approve'); process.exit(1); }
// 白名单恰好 3 键
if (WHITELIST_VERDICTS.size !== 3) { console.error('FAIL: 白名单不等于 3 键'); process.exit(1); }
console.log('fail-closed 守卫 ✓');
EOF

echo "[notion-inbox-smoke] 全部通过 ✅"
