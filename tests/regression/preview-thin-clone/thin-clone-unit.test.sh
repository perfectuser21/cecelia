#!/usr/bin/env bash
# thin-clone-unit.test.sh — 验证 preview-env-start.sh 瘦克隆行为
#
# 覆盖 BEHAVIOR-01/02/10（static-assert + unit mock），以及
# BEHAVIOR-03/04 的集成层存根（真实 psql 在 CI local_api 环境运行）。
#
# 本测试为 sprint 08110001-preview-thin-clone 合同测试，
# 修复后永久保留在 CI 里作为回归测试，禁止删除。

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
TARGET="${REPO_ROOT}/scripts/preview-env-start.sh"
PASS=0; FAIL=0

pass() { echo "  PASS: $1"; PASS=$((PASS + 1)); }
fail() { echo "  FAIL: $1 — $2"; FAIL=$((FAIL + 1)); }

THIN_CLONE_TABLES=(
  memory_stream cecelia_events alertness_metrics
  checkpoint_writes checkpoint_blobs checkpoints captures
)
BUSINESS_TABLES=(tasks journeys decisions journey_features golden_paths preview_environments)

PR_NUMBER=910001
LOG_FILE="/tmp/preview-${PR_NUMBER}.log"
PID_FILE="/tmp/preview-${PR_NUMBER}.pid"
SCRIPT_LOCK="/tmp/preview-script-lock-${PR_NUMBER}"

# ─────────────────────────────────────────────────────────────────────────────
# BEHAVIOR-01：static-assert — 脚本顶部存在 THIN_CLONE_EXCLUDE 数组且早于 pg_dump
# ─────────────────────────────────────────────────────────────────────────────
echo ""
echo "=== BEHAVIOR-01: THIN_CLONE_EXCLUDE 数组静态检查 ==="

ARRAY_LINE=$(grep -n 'THIN_CLONE_EXCLUDE' "$TARGET" | head -1 | cut -d: -f1 || true)
PGDUMP_LINE=$(grep -n 'pg_dump' "$TARGET" | head -1 | cut -d: -f1 || true)

if [ -z "$ARRAY_LINE" ]; then
  fail "THIN_CLONE_EXCLUDE 数组不存在" "scripts/preview-env-start.sh 中未找到 THIN_CLONE_EXCLUDE 定义"
else
  pass "THIN_CLONE_EXCLUDE 数组已定义（第 ${ARRAY_LINE} 行）"

  if [ -z "$PGDUMP_LINE" ]; then
    fail "pg_dump 调用未找到" "无法验证数组定义在 pg_dump 之前"
  elif [ "$ARRAY_LINE" -lt "$PGDUMP_LINE" ]; then
    pass "THIN_CLONE_EXCLUDE 定义在 pg_dump 调用之前（${ARRAY_LINE} < ${PGDUMP_LINE}）"
  else
    fail "THIN_CLONE_EXCLUDE 定义晚于 pg_dump 调用" "数组第${ARRAY_LINE}行，pg_dump第${PGDUMP_LINE}行"
  fi
fi

# 验证 7 张历史表名都在脚本中
for tbl in "${THIN_CLONE_TABLES[@]}"; do
  if grep -q "$tbl" "$TARGET"; then
    pass "排除表 ${tbl} 出现在脚本中"
  else
    fail "排除表 ${tbl} 未出现在脚本中" "THIN_CLONE_EXCLUDE 名单可能不完整"
  fi
done

# 确认 --exclude-table（无-data后缀）不存在（防止误删 schema）
if grep -q -- '--exclude-table=' "$TARGET" && ! grep -q -- '--exclude-table-data=' "$TARGET"; then
  fail "发现 --exclude-table 而非 --exclude-table-data" "会导致排除表 schema 丢失，Brain 启动时 missing table 报错"
elif grep -q -- '--exclude-table=' "$TARGET" && grep -q -- '--exclude-table-data=' "$TARGET"; then
  # 两者都有，检查是否有裸 --exclude-table=（不带-data）
  BARE_EXCLUDE=$(grep -o -- '--exclude-table=[^-]' "$TARGET" 2>/dev/null | head -1 || true)
  if [ -n "$BARE_EXCLUDE" ]; then
    fail "发现裸 --exclude-table=（无-data后缀）" "实例: $BARE_EXCLUDE"
  else
    pass "--exclude-table-data 参数格式正确（无裸 --exclude-table）"
  fi
else
  pass "--exclude-table-data 参数格式正确（无裸 --exclude-table）"
fi

# ─────────────────────────────────────────────────────────────────────────────
# BEHAVIOR-02：unit mock — pg_dump 调用含完整排除参数
# ─────────────────────────────────────────────────────────────────────────────
echo ""
echo "=== BEHAVIOR-02: pg_dump 调用参数 mock 验证 ==="

setup_mock() {
  TMP=$(mktemp -d)
  PREVIEW_BASE_DIR="$TMP/previews"
  mkdir -p "$PREVIEW_BASE_DIR"
  REPO_ROOT_MOCK="$TMP/repo"
  mkdir -p "$REPO_ROOT_MOCK/node_modules" "$REPO_ROOT_MOCK/packages/brain/node_modules"
  printf '%s\n' "image-lock-v1" > "$REPO_ROOT_MOCK/package-lock.json"
  BIN="$TMP/bin"
  mkdir -p "$BIN"
  PGDUMP_ARGS_FILE="$TMP/pgdump_args"
  PSQL_MARKER="$TMP/psql_calls"
  NPM_MARKER="$TMP/npm_calls"
  STDOUT_LOG="$TMP/stdout.log"
  : > "$PGDUMP_ARGS_FILE"
  : > "$PSQL_MARKER"
  : > "$NPM_MARKER"

  # 真实起一个长驻"旧进程"
  sleep 300 &
  OLD_PID=$!
  echo "$OLD_PID" > "$PID_FILE"

  cat >"$BIN/git" <<'SH'
#!/bin/bash
if [[ "$*" == *"worktree list"* ]]; then exit 0
elif [[ "$*" == *"worktree remove"* ]]; then exit 0
elif [[ "$*" == *"worktree prune"* ]]; then exit 0
elif [[ "$*" == *"fetch"* ]]; then exit 0
elif [[ "$*" == *"worktree add"* ]]; then
  args=("$@")
  n=${#args[@]}
  target_dir="${args[$((n-2))]}"
  mkdir -p "$target_dir/apps/dashboard" "$target_dir/packages/brain"
  printf '%s\n' "image-lock-v1" > "$target_dir/package-lock.json"
  exit 0
fi
exit 0
SH
  chmod +x "$BIN/git"

  cat >"$BIN/npm" <<'SH'
#!/bin/bash
printf '%s|%s\n' "$PWD" "$*" >> "${NPM_MARKER:?}"
exit 0
SH
  chmod +x "$BIN/npm"

  cat >"$BIN/node" <<'SH'
#!/bin/bash
exec sleep 300
SH
  chmod +x "$BIN/node"

  cat >"$BIN/curl" <<'SH'
#!/bin/bash
echo '{"status":"running"}'
SH
  chmod +x "$BIN/curl"

  # mock pg_dump：记录完整参数列表
  cat >"$BIN/pg_dump" <<SH
#!/bin/bash
printf '%s\n' "\$@" > "${PGDUMP_ARGS_FILE}"
exit 0
SH
  chmod +x "$BIN/pg_dump"

  printf '#!/bin/bash\ncat >/dev/null\nexit 0\n' >"$BIN/pg_restore"; chmod +x "$BIN/pg_restore"
  printf '#!/bin/bash\nexit 0\n' >"$BIN/createdb"; chmod +x "$BIN/createdb"
  printf '#!/bin/bash\nexit 0\n' >"$BIN/dropdb"; chmod +x "$BIN/dropdb"

  cat >"$BIN/psql" <<'SH'
#!/bin/bash
printf '%s\n' "$*" >> "${PSQL_MARKER:?}"
# 为灭活任务断言返回 0
echo "0"
exit 0
SH
  chmod +x "$BIN/psql"

  export PATH="$BIN:$PATH"
  BRAIN_NM_TARGET="$REPO_ROOT_MOCK/node_modules"
  BRAIN_BRAIN_NM_TARGET="$REPO_ROOT_MOCK/packages/brain/node_modules"
  BRAIN_LOCK_TARGET="$REPO_ROOT_MOCK/package-lock.json"
  export REPO_ROOT="$REPO_ROOT_MOCK" PREVIEW_BASE_DIR NPM_MARKER PSQL_MARKER
  export BRAIN_NM_TARGET BRAIN_BRAIN_NM_TARGET BRAIN_LOCK_TARGET
}

teardown_mock() {
  kill -9 "$OLD_PID" 2>/dev/null || true
  BRAIN_PID_LEFTOVER=$(cat "$PID_FILE" 2>/dev/null || echo "")
  [ -n "$BRAIN_PID_LEFTOVER" ] && kill -9 "$BRAIN_PID_LEFTOVER" 2>/dev/null || true
  rm -f "$LOG_FILE" "$PID_FILE"
  if [ -d "$SCRIPT_LOCK" ]; then
    find "$SCRIPT_LOCK" -depth -delete
  else
    rm -f "$SCRIPT_LOCK"
  fi
  rm -rf "$TMP"
}

setup_mock

DB_HOST="testhost" DB_USER="testuser" DB_PASSWORD="testpw" \
  bash "$TARGET" "$PR_NUMBER" "thin-clone-test-branch" "59998" "cecelia_preview_test910001" \
  > "$STDOUT_LOG" 2>&1
RC=$?

if [ ! -s "$PGDUMP_ARGS_FILE" ]; then
  fail "pg_dump 从未被调用或参数未捕获" "脚本可能提前失败：$(tail -10 "$STDOUT_LOG" 2>/dev/null)"
else
  PGDUMP_ARGS=$(cat "$PGDUMP_ARGS_FILE")

  # 断言 7 张历史表的 --exclude-table-data 参数
  ALL_PRESENT=true
  for tbl in "${THIN_CLONE_TABLES[@]}"; do
    if echo "$PGDUMP_ARGS" | grep -q -- "--exclude-table-data=${tbl}"; then
      pass "pg_dump 参数含 --exclude-table-data=${tbl}"
    else
      fail "pg_dump 参数缺 --exclude-table-data=${tbl}" "实际参数: $(echo "$PGDUMP_ARGS" | tr '\n' ' ')"
      ALL_PRESENT=false
    fi
  done

  # 断言业务表不在排除名单
  for tbl in "${BUSINESS_TABLES[@]}"; do
    if echo "$PGDUMP_ARGS" | grep -q -- "--exclude-table-data=${tbl}"; then
      fail "业务表 ${tbl} 出现在排除参数中" "业务表数据必须完整克隆"
    else
      pass "业务表 ${tbl} 不在排除参数中（正确）"
    fi
  done

  # 断言无裸 --exclude-table=（无-data后缀）
  if echo "$PGDUMP_ARGS" | grep -Eq -- '--exclude-table=[^d]'; then
    fail "pg_dump 参数含裸 --exclude-table=（会丢失 schema）" "实际参数: $(echo "$PGDUMP_ARGS" | tr '\n' ' ')"
  else
    pass "pg_dump 参数无裸 --exclude-table=（schema 安全）"
  fi
fi

teardown_mock

# ─────────────────────────────────────────────────────────────────────────────
# BEHAVIOR-10：unit — 脚本输出含排除表日志
# ─────────────────────────────────────────────────────────────────────────────
echo ""
echo "=== BEHAVIOR-10: 排除操作日志验证 ==="

setup_mock

DB_HOST="testhost" DB_USER="testuser" DB_PASSWORD="testpw" \
  bash "$TARGET" "$PR_NUMBER" "thin-clone-test-branch" "59998" "cecelia_preview_test910001" \
  > "$STDOUT_LOG" 2>&1

# 检查 stdout 或 LOG_FILE 中是否含排除表相关日志
COMBINED_OUTPUT=$(cat "$STDOUT_LOG" 2>/dev/null; cat "$LOG_FILE" 2>/dev/null)

LOG_HAS_EXCLUDE=false
for tbl in memory_stream cecelia_events; do
  if echo "$COMBINED_OUTPUT" | grep -qi "$tbl"; then
    LOG_HAS_EXCLUDE=true
    break
  fi
done

if echo "$COMBINED_OUTPUT" | grep -qi 'THIN_CLONE_EXCLUDE\|thin.clone\|exclude'; then
  pass "脚本日志含排除相关输出（THIN_CLONE_EXCLUDE/thin-clone/exclude 关键词）"
elif [ "$LOG_HAS_EXCLUDE" = "true" ]; then
  pass "脚本日志含排除表名（memory_stream 等），可追溯"
else
  fail "脚本日志无排除操作记录" "应在 log 中输出排除表名单，便于回溯（FR-03）"
fi

teardown_mock

# ─────────────────────────────────────────────────────────────────────────────
# BEHAVIOR-03/04：集成层存根（需真实 psql，在 CI local_api 环境验证）
# ─────────────────────────────────────────────────────────────────────────────
echo ""
echo "=== BEHAVIOR-03/04: 集成层（schema 存在 + 数据为空）— CI 环境验证存根 ==="

# 在没有真实 DB 的环境下，打印待验证的 SQL 以供 CI 集成步骤使用
INTEGRATION_SQL_FILE="${SCRIPT_DIR}/integration-queries.sql"
cat > "$INTEGRATION_SQL_FILE" <<'SQL'
-- BEHAVIOR-03: 排除表 schema 必须存在（期望 count = 7）
SELECT count(*) AS schema_count
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN (
    'memory_stream', 'cecelia_events', 'alertness_metrics',
    'checkpoint_writes', 'checkpoint_blobs', 'checkpoints', 'captures'
  );

-- BEHAVIOR-04: 排除表数据必须为空（每张期望 count = 0）
SELECT count(*) FROM memory_stream;
SELECT count(*) FROM cecelia_events;
SELECT count(*) FROM alertness_metrics;
SELECT count(*) FROM checkpoint_writes;
SELECT count(*) FROM checkpoint_blobs;
SELECT count(*) FROM checkpoints;
SELECT count(*) FROM captures;
SQL

if [ -f "$INTEGRATION_SQL_FILE" ]; then
  pass "集成验证 SQL 已写入 ${INTEGRATION_SQL_FILE}（CI local_api 步骤使用）"
else
  fail "集成验证 SQL 写入失败" "请检查 sprint tests 目录权限"
fi

# ─────────────────────────────────────────────────────────────────────────────
# 总结
# ─────────────────────────────────────────────────────────────────────────────
echo ""
echo "结果: PASS=${PASS}, FAIL=${FAIL}"
[ "$FAIL" -eq 0 ] || exit 1
