#!/bin/bash
# 幂等创建本地 cecelia_test DB + 跑全套 migrations
# 防测试污染生产。详见 docs/superpowers/specs/2026-04-22-test-db-isolation-design.md

set -e

# unset NODE_ENV/VITEST 避免父/子 env 污染（guard 误触发）
unset NODE_ENV VITEST

DB=cecelia_test

# 幂等 create
if ! psql postgres -lqt | cut -d\| -f1 | grep -qw "$DB"; then
  echo "创建 $DB"
  createdb -O cecelia "$DB"
else
  echo "$DB 已存在，跳过 create"
fi

# 跑 migrations（migrate.js 自己幂等）
DB_NAME="$DB" node "$(dirname "$0")/../src/migrate.js"
echo "✅ $DB 准备就绪"
