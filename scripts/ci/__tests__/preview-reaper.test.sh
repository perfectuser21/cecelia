#!/usr/bin/env bash
# preview-reaper.test.sh — preview-reaper 对账回收器测试（自洽沙箱）
# 背景：preview-cleanup.yml 单发 webhook 在 Brain 不可达窗口丢失且无重试，
# 2026-07-15 实测泄漏 23G worktree + 19 孤儿 DB 致宿主盘满、OrbStack 宕机。
# 5 用例：closed 三源回收 / open 不动 / gh 失败 fail-safe / 表行标 inactive / dry-run。
# mock 约定：每个 mock 把 "$@" 追加写入 $MOCK_LOG_DIR/<cmd>.log 供断言；
# gh 按参数里的 PR 号查环境变量 GH_STATE_<PR> 返回 {"state":"XXX"}，未设置则 exit 1。
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
SUT="$REPO_ROOT/scripts/preview-reaper.sh"

FAILED=0
fail() { echo "  ❌ $*"; FAILED=1; }
pass() { echo "  ✅ $*"; }

# ── 沙箱与 mock 搭建 ─────────────────────────────────────────────────────────
setup() {
  SANDBOX="$(mktemp -d)"
  MOCK_BIN="$SANDBOX/bin"
  MOCK_LOG_DIR="$SANDBOX/logs"
  PREVIEW_BASE_DIR="$SANDBOX/previews"
  mkdir -p "$MOCK_BIN" "$MOCK_LOG_DIR" "$PREVIEW_BASE_DIR"

  # mock gh：按 PR 号查 GH_STATE_<PR>，未设置 → exit 1（模拟查询失败）
  cat > "$MOCK_BIN/gh" <<'MOCK'
#!/usr/bin/env bash
echo "$@" >> "$MOCK_LOG_DIR/gh.log"
pr=""
for a in "$@"; do
  if [[ "$a" =~ ^[0-9]+$ ]]; then pr="$a"; fi
done
var="GH_STATE_${pr}"
state="$(eval "echo \"\${${var}:-}\"")"
if [ -z "$state" ]; then
  echo "mock gh: query failed for PR $pr" >&2
  exit 1
fi
echo "{\"state\":\"$state\"}"
MOCK

  # mock psql：pg_database 查询 → $PSQL_DATNAMES；preview_environments 查询 → $PSQL_TABLE_ROWS
  cat > "$MOCK_BIN/psql" <<'MOCK'
#!/usr/bin/env bash
echo "$@" >> "$MOCK_LOG_DIR/psql.log"
joined="$*"
case "$joined" in
  *pg_database*)
    if [ -n "${PSQL_DATNAMES:-}" ]; then printf '%s\n' "$PSQL_DATNAMES"; fi ;;
  *"FROM preview_environments"*)
    if [ -n "${PSQL_TABLE_ROWS:-}" ]; then printf '%s\n' "$PSQL_TABLE_ROWS"; fi ;;
esac
exit 0
MOCK

  # mock dropdb / lsof：只记录调用
  cat > "$MOCK_BIN/dropdb" <<'MOCK'
#!/usr/bin/env bash
echo "$@" >> "$MOCK_LOG_DIR/dropdb.log"
exit 0
MOCK
  cat > "$MOCK_BIN/lsof" <<'MOCK'
#!/usr/bin/env bash
echo "$@" >> "$MOCK_LOG_DIR/lsof.log"
exit 1
MOCK
  chmod +x "$MOCK_BIN"/gh "$MOCK_BIN"/psql "$MOCK_BIN"/dropdb "$MOCK_BIN"/lsof
}

teardown() { rm -rf "$SANDBOX"; }

# run_reaper VAR=val ... — 沙箱环境里跑 SUT，stdout/stderr 落沙箱文件
run_reaper() {
  env PATH="$MOCK_BIN:$PATH" \
      MOCK_LOG_DIR="$MOCK_LOG_DIR" \
      PREVIEW_BASE_DIR="$PREVIEW_BASE_DIR" \
      GH_BIN="gh" \
      "$@" \
      bash "$SUT" > "$SANDBOX/stdout" 2> "$SANDBOX/stderr"
  REAPER_EXIT=$?
}

dropdb_called_with() { [ -f "$MOCK_LOG_DIR/dropdb.log" ] && grep -q "$1" "$MOCK_LOG_DIR/dropdb.log"; }
dropdb_not_called()  { [ ! -s "$MOCK_LOG_DIR/dropdb.log" ]; }

# ── 用例 1：closed PR 的目录+DB 被清 ─────────────────────────────────────────
echo "用例 1: closed PR 的目录+DB 被清"
setup
mkdir -p "$PREVIEW_BASE_DIR/preview-101"
run_reaper GH_STATE_101=MERGED PSQL_DATNAMES="cecelia_preview_101" PSQL_TABLE_ROWS=""
if [ ! -d "$PREVIEW_BASE_DIR/preview-101" ]; then pass "目录已删"; else fail "目录 preview-101 未被删除"; fi
if dropdb_called_with "cecelia_preview_101"; then pass "dropdb 被调（cecelia_preview_101）"; else fail "dropdb 未被调用 cecelia_preview_101"; fi
teardown

# ── 用例 2：open PR 不动 ─────────────────────────────────────────────────────
echo "用例 2: open PR 不动"
setup
mkdir -p "$PREVIEW_BASE_DIR/preview-102"
run_reaper GH_STATE_102=OPEN PSQL_DATNAMES="" PSQL_TABLE_ROWS=""
if [ -d "$PREVIEW_BASE_DIR/preview-102" ]; then pass "目录保留"; else fail "open PR 的目录被误删"; fi
if dropdb_not_called; then pass "dropdb 未被调"; else fail "open PR 却调用了 dropdb"; fi
teardown

# ── 用例 3：gh 查询失败不动（fail-safe） ─────────────────────────────────────
echo "用例 3: gh 查询失败不动（fail-safe）"
setup
mkdir -p "$PREVIEW_BASE_DIR/preview-103"
run_reaper PSQL_DATNAMES="" PSQL_TABLE_ROWS=""   # GH_STATE_103 未设置 → mock gh exit 1
if [ -d "$PREVIEW_BASE_DIR/preview-103" ]; then pass "目录保留"; else fail "状态未知却删了目录"; fi
if dropdb_not_called; then pass "dropdb 未被调"; else fail "状态未知却调用了 dropdb"; fi
if grep -q "WARN" "$SANDBOX/stderr"; then pass "stderr 有 WARN"; else fail "stderr 缺 WARN（fail-safe 提示）"; fi
teardown

# ── 用例 4：表行 status!=inactive 且 PR closed → 标 inactive ─────────────────
echo "用例 4: 表行 status!=inactive 且 PR closed → 标 inactive"
setup
run_reaper GH_STATE_104=CLOSED PSQL_DATNAMES="" PSQL_TABLE_ROWS="104|5301|cecelia_preview_104"
if [ -f "$MOCK_LOG_DIR/psql.log" ] \
   && grep -q "UPDATE preview_environments" "$MOCK_LOG_DIR/psql.log" \
   && grep "UPDATE preview_environments" "$MOCK_LOG_DIR/psql.log" | grep -q "inactive" \
   && grep "UPDATE preview_environments" "$MOCK_LOG_DIR/psql.log" | grep -q "104"; then
  pass "psql 收到 UPDATE preview_environments...inactive...104"
else
  fail "缺 UPDATE preview_environments SET status='inactive' ... 104 调用"
fi
teardown

# ── 用例 5：DRY_RUN=1 只报告不动手 ───────────────────────────────────────────
echo "用例 5: DRY_RUN=1 只报告不动手"
setup
mkdir -p "$PREVIEW_BASE_DIR/preview-101"
run_reaper GH_STATE_101=MERGED PSQL_DATNAMES="cecelia_preview_101" PSQL_TABLE_ROWS="" DRY_RUN=1
if [ -d "$PREVIEW_BASE_DIR/preview-101" ]; then pass "目录保留"; else fail "dry-run 却删了目录"; fi
if dropdb_not_called; then pass "dropdb 未被调"; else fail "dry-run 却调用了 dropdb"; fi
if grep -q "\[dry-run\]" "$SANDBOX/stdout"; then pass "stdout 有 [dry-run]"; else fail "stdout 缺 [dry-run] 报告"; fi
teardown

if [ "$FAILED" = 0 ]; then
  echo "preview-reaper.test.sh: OK"
else
  echo "preview-reaper.test.sh: FAILED"
  exit 1
fi
