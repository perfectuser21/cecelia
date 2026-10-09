#!/usr/bin/env bash
# Smoke: backbone-contract-sync — 主干活动契约 git→Brain→Notion（决策 0834e2fb / 92f6226b，任务 2fdd5f12）
# 验证（不连真库、不发网络；固定合法契约 + 事务pool走同步全链）：
#   1. 同步：仓库哈希变 → 拉 YAML → journey_steps 写契约副本 + 钉 commit 的正本链接；哈希不变仍验证同commit全量YAML；定义幂等
#   2. Notion 属性：正本只读链接 / 契约哈希 / 后置条件探针 / 步骤清单齐
#   3. 接线：scheduler JOBS 挂 backbone-contract-sync 且在 scheduler-liveness 之前；迁移 482 + 回滚存在；smoke 登记 allowlist
set -euo pipefail
cd "$(dirname "$0")/../.."

echo "[backbone-contract-sync-smoke] 1. 同步/事务/投影永久回归（固定合法digest + 登记workflow）"
# 复用永久测试的事务pool与固定commit契约，避免smoke另造过期假数据。
# 含完整同commit验证、失败零写入、回滚/归还连接、30分钟gate、漂移告警、Notion失败非阻断。
# 真实PG原子性/8+8共享7/HTTP验收由同一smoke目录的shared-activities-smoke.sh负责。
node ../../node_modules/vitest/vitest.mjs run \
  src/__tests__/activity-contract-sync.test.js \
  src/__tests__/shared-activity-sync.test.js \
  src/lib/__tests__/activity-contract-loader.test.js \
  src/lib/__tests__/activity-contract-store.test.js \
  --maxWorkers=1 --minWorkers=1

echo "[backbone-contract-sync-smoke] 2. 接线"
grep -q "name: 'backbone-contract-sync'" src/scheduler-jobs.js || { echo "FAIL JOBS 未挂 backbone-contract-sync"; exit 1; }
node --input-type=module -e "
import { readFileSync } from 'node:fs';
const s = readFileSync('src/scheduler-jobs.js', 'utf8');
if (s.indexOf(\"name: 'backbone-contract-sync'\") > s.indexOf(\"name: 'scheduler-liveness'\")) { console.error('FAIL scheduler-liveness 必须排最后'); process.exit(1); }
"
test -f migrations/482_backbone_activity_contracts.sql || { echo "FAIL 缺迁移 482"; exit 1; }
test -f migrations/rollback/482_backbone_activity_contracts.down.sql || { echo "FAIL 缺回滚 482"; exit 1; }
grep -q "backbone-contract-sync-smoke.sh" ../quality/smoke-allowlist.txt || { echo "FAIL smoke 未登记 allowlist"; exit 1; }
echo "[backbone-contract-sync-smoke] PASS"
