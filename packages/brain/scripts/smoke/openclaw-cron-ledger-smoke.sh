#!/usr/bin/env bash
# openclaw-cron-ledger-smoke.sh — OpenClaw cron 进排程台账（task 8fc40bfb）
#
# 验两件事（断言体在同目录的 openclaw-cron-ledger-check.mjs）：
#   ① 采集命令不写死落点，必须走 ssh 别名 —— 这条 bug 两度复发：
#      hk-vps→us-vps 坏一次、us-vps→MMV 又坏一次，每次都是把落点焊进代码。
#   ② parseOpenclawCrons 的结果真能落进真 PG 的 ops_schedule_entries 并读得回。
#      单测用 fakePool 只记 SQL 字符串，证明不了列类型/约束吃不吃得下这些值。
#
# 刻意不验的：不打真 OpenClaw。CI（real-env-smoke / Smoke Glob Runner）有真 PG，
# 但到不了 MMV —— 分清“能验的”和“验不了的”，不拿 mock 冒充真链路。
set -euo pipefail

# 四级：smoke → scripts → brain → packages → 仓库根（三级只到 packages/，别少一级）
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
cd "$ROOT"
PSQL_DB="${PGDATABASE:-cecelia_test}"
echo "▶️  openclaw-cron-ledger smoke — db=$PSQL_DB"

cleanup() {
  psql -d "$PSQL_DB" -q -c \
    "DELETE FROM ops_schedule_entries WHERE source='openclaw' AND host_alias='smoke-mmv'" \
    >/dev/null 2>&1 || true
}
trap cleanup EXIT
cleanup

node packages/brain/scripts/smoke/openclaw-cron-ledger-check.mjs

echo "✅ openclaw-cron-ledger smoke 通过"
