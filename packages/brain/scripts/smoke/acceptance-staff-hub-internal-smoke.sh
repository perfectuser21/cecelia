#!/usr/bin/env bash
# Smoke: acceptance-staff-hub-internal — 验收终局（决策 fc7b5dc0）Brain 内网端点扩展
# 验证：
#   1. 内网路由新增三端点：GET /pending、GET /runs（历史）、POST /results
#   2. 共享核心函数已抽取：submitAcceptanceResults / loadPendingRuns / loadRunsWithChecks
#   3. migration 380 存在，含 detail/submitted_by 列 + 驳回任务去重唯一索引
#   4. 并发安全防线都在：SELECT...FOR UPDATE 行锁 + SAVEPOINT 包裹驳回任务 INSERT
set -euo pipefail

echo "[acceptance-staff-hub-internal-smoke] 1. 内网 router 新增三端点"
node -e "
const fs = require('fs');
const src = fs.readFileSync('packages/brain/src/routes/acceptance.js', 'utf8');
const wants = [\"router.get\\\\('/pending'\", \"router.get\\\\('/runs'\", \"router.post\\\\('/results'\"];
const missing = wants.filter((w) => !new RegExp(w).test(src));
if (missing.length) { missing.forEach((m) => console.error('缺少路由: ' + m)); process.exit(1); }
console.log('三端点均已接线 ✓');
"

echo "[acceptance-staff-hub-internal-smoke] 2. 共享核心函数已抽取，公网/内网复用"
node -e "
const fs = require('fs');
const src = fs.readFileSync('packages/brain/src/routes/acceptance.js', 'utf8');
const wants = ['export async function submitAcceptanceResults', 'export async function loadPendingRuns', 'export async function loadRunsWithChecks', 'export class AcceptanceResultsError'];
const missing = wants.filter((w) => !src.includes(w));
if (missing.length) { missing.forEach((m) => console.error('缺少导出: ' + m)); process.exit(1); }
console.log('共享核心函数齐全 ✓');
"

echo "[acceptance-staff-hub-internal-smoke] 3. 并发安全防线：行锁 + SAVEPOINT"
node -e "
const fs = require('fs');
const src = fs.readFileSync('packages/brain/src/routes/acceptance.js', 'utf8');
if (!src.includes('FOR UPDATE')) { console.error('缺少 acceptance_runs 行锁'); process.exit(1); }
if (!src.includes('SAVEPOINT reject_task_insert')) { console.error('缺少驳回任务 INSERT 的 SAVEPOINT 隔离'); process.exit(1); }
console.log('行锁 + SAVEPOINT 均存在 ✓');
"

echo "[acceptance-staff-hub-internal-smoke] 4. migration 380 结构完整"
node -e "
const fs = require('fs');
const path = require('path');
const dir = 'packages/brain/migrations';
const file = fs.readdirSync(dir).find((f) => f.startsWith('380_'));
if (!file) { console.error('未找到 380 号 migration'); process.exit(1); }
const sql = fs.readFileSync(path.join(dir, file), 'utf8');
const wants = ['ADD COLUMN IF NOT EXISTS detail', 'ADD COLUMN IF NOT EXISTS submitted_by', 'uq_tasks_acceptance_rejection_open'];
const missing = wants.filter((w) => !sql.includes(w));
if (missing.length) { missing.forEach((m) => console.error('migration 380 缺少: ' + m)); process.exit(1); }
console.log('migration 380 结构完整 ✓');
"

echo "[acceptance-staff-hub-internal-smoke] 全部通过 ✅"
