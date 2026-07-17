#!/usr/bin/env bash
# Smoke: MJ5 刀1 承诺地图账本落库——349 和解补齐 + 350 seed + 落账 API 结构校验
set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
cd "$ROOT_DIR"

# 1. 两个 migration 存在且编号唯一
[ -f "packages/brain/migrations/349_promise_map_reconcile.sql" ] \
  || { echo "FAIL: 349_promise_map_reconcile.sql 不存在"; exit 1; }
[ -f "packages/brain/migrations/350_seed_promise_map_two_domains.sql" ] \
  || { echo "FAIL: 350_seed_promise_map_two_domains.sql 不存在"; exit 1; }
echo "OK: 349/350 migration 存在"

# 2. 349 含格子模型关键改动：cell_key、双 partial unique、FK SET NULL、删旧 UNIQUE
grep -q "cell_key" packages/brain/migrations/349_promise_map_reconcile.sql \
  || { echo "FAIL: 349 缺 cell_key"; exit 1; }
grep -q "uq_jsl_membership" packages/brain/migrations/349_promise_map_reconcile.sql \
  || { echo "FAIL: 349 缺 uq_jsl_membership partial unique"; exit 1; }
grep -q "uq_jsl_cell" packages/brain/migrations/349_promise_map_reconcile.sql \
  || { echo "FAIL: 349 缺 uq_jsl_cell partial unique"; exit 1; }
grep -q "ON DELETE SET NULL" packages/brain/migrations/349_promise_map_reconcile.sql \
  || { echo "FAIL: 349 FK 未改 ON DELETE SET NULL"; exit 1; }
grep -q "DROP CONSTRAINT IF EXISTS journey_step_links_journey_id_step_id_key" \
  packages/brain/migrations/349_promise_map_reconcile.sql \
  || { echo "FAIL: 349 未删旧 UNIQUE"; exit 1; }
echo "OK: 349 格子模型五要件齐"

# 3. 350 seed 含两打样域锚点数据（GP-B 承诺原文 + CRM 底座 + 首次成功）
grep -q "GP-B 被动接待" packages/brain/migrations/350_seed_promise_map_two_domains.sql \
  || { echo "FAIL: 350 缺 GP-B"; exit 1; }
grep -q "客户发来的任何消息，系统数秒内看到，一条不漏、一条不重" \
  packages/brain/migrations/350_seed_promise_map_two_domains.sql \
  || { echo "FAIL: 350 缺 GP-B S1 承诺原文"; exit 1; }
grep -q "CRM 表底座" packages/brain/migrations/350_seed_promise_map_two_domains.sql \
  || { echo "FAIL: 350 缺 CRM 表底座"; exit 1; }
grep -q "6e63f204-e9fd-4a3b-b338-6b3616bfcc61" packages/brain/migrations/350_seed_promise_map_two_domains.sql \
  || { echo "FAIL: 350 缺首次成功 journey"; exit 1; }
echo "OK: 350 两域 seed 数据齐"

# 4. 路由：双通道 upsert + blast-radius + PATCH journeys
grep -q "ON CONFLICT (journey_id, step_id) WHERE cell_kind IS NULL" packages/brain/src/routes/journeys.js \
  || { echo "FAIL: legacy 通道未用 partial 冲突目标"; exit 1; }
grep -q "ON CONFLICT (step_id, cell_kind, cell_key) WHERE cell_kind IS NOT NULL" packages/brain/src/routes/journeys.js \
  || { echo "FAIL: cell 通道未用 partial 冲突目标"; exit 1; }
grep -q "journey_features/:id/blast-radius" packages/brain/src/routes/journeys.js \
  || { echo "FAIL: blast-radius 端点缺失"; exit 1; }
grep -q "router.patch('/journeys/:id'" packages/brain/src/routes/journeys.js \
  || { echo "FAIL: PATCH /journeys/:id 缺失"; exit 1; }
echo "OK: 落账 API 四要件齐"

# 5. Notion push 排除格子行
grep -q "cell_kind IS NULL" packages/brain/src/notion-push-sync.js \
  || { echo "FAIL: notion push 未排除格子行"; exit 1; }
echo "OK: notion push 格子过滤在位"

# 6. selfcheck 地板已推进到 350
grep -q "EXPECTED_SCHEMA_VERSION = '350'" packages/brain/src/selfcheck.js \
  || { echo "FAIL: EXPECTED_SCHEMA_VERSION 未推进到 350"; exit 1; }
echo "OK: schema 地板 350"

echo "PASS: promise-map-ledger smoke 全部通过"
