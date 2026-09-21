#!/usr/bin/env bash
# crontab-ledger-smoke.sh — us-vps 宿主 crontab 进排程台账（第四来源）
#
# 验三件事（断言体在同目录的 crontab-ledger-check.mjs）：
#   ① 取数命令是宿主 crontab -l，没把落点焊进代码（openclaw 腿因此坏过两次）
#   ② 三类行分清：活的 / 被注释掉的活（标 disabled）/ 纯说明注释
#   ③ 解析结果真能落进真 PG 的 ops_schedule_entries 并逐字段读回，
#      且同脚本多排期各占一行不互相覆盖（label 是唯一键的一部分）
#
# 刻意不验的：不读真 crontab。CI 有真 PG 但没有 us-vps 的那张表——
# 分清"能验的"和"验不了的"，不拿 mock 冒充真链路。
set -euo pipefail

# 四级：smoke → scripts → brain → packages → 仓库根
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
cd "$ROOT"
PSQL_DB="${PGDATABASE:-cecelia_test}"
echo "▶️  crontab-ledger smoke — db=$PSQL_DB"

cleanup() {
  psql -d "$PSQL_DB" -q -c \
    "DELETE FROM ops_schedule_entries WHERE source='crontab' AND host_alias='smoke-us-vps'" \
    >/dev/null 2>&1 || true
}
trap cleanup EXIT
cleanup

node packages/brain/scripts/smoke/crontab-ledger-check.mjs

echo "✅ crontab-ledger smoke 通过"
