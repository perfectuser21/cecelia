#!/bin/bash
# 创建本地 cecelia_test DB + 跑全套 migrations。
# 幂等：DB 已存在则跳过 createdb，migrate.js 只跑未应用的 migration。
#
# 用途：防止本地跑 integration test 污染 cecelia 生产 DB。
#   昨晚 muted-toggle-e2e 本地跑时 DB_DEFAULTS fallback 到 cecelia，
#   beforeEach DELETE + INSERT 的最后一个 PATCH {enabled:false} 留在生产，
#   Brain 重启 initMutedGuard 读到 false → 恢复发飞书。
#   配合 db-config.js 的 NODE_ENV=test guard 使用。
#
# 使用：
#   bash packages/brain/scripts/setup-test-db.sh
# 先决条件：
#   - 本地 PostgreSQL 运行中
#   - 当前 shell 用户有 createdb 权限（或设置 PGUSER 指向 superuser）

set -euo pipefail

DB=cecelia_test
OWNER="${DB_USER:-cecelia}"

# 定位 repo 根（脚本位置 → 向上两层：scripts/ → brain/ → packages/ → repo root）
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BRAIN_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# 检查 DB 是否已存在（psql -lqt 输出每个 DB 一行，用 cut 取第一列）
if psql postgres -lqt 2>/dev/null | cut -d '|' -f 1 | tr -d ' ' | grep -qx "$DB"; then
  echo "[setup-test-db] $DB 已存在，跳过 createdb"
else
  echo "[setup-test-db] 创建 $DB（owner=$OWNER）"
  createdb -O "$OWNER" "$DB"
fi

echo "[setup-test-db] 跑 migrations（migrate.js 会跳过已应用的）"
DB_NAME="$DB" NODE_ENV=test node "$BRAIN_DIR/src/migrate.js"

echo "[setup-test-db] ✅ $DB 准备就绪。跑测试前请确保 export NODE_ENV=test（vitest 自动设 VITEST=true 也触发 guard）。"
