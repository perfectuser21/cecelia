#!/usr/bin/env bash
# preview-env-start.test.sh — 验证 preview 启动的进程顺序与分支依赖隔离
#
# 根因（PR#4176 CI 实测复现，2026-07-21）：re-push 间隔 <3 分钟时，上一轮 preview-env-start.sh
# 启动的常驻 Brain 子进程仍然存活、仍连着同名预览 DB。旧代码把"杀死旧进程"放在 Step5（DB 克隆
# 之后），导致 Step4 的 dropdb 报 "is being accessed by other users"，createdb 因库已存在报错，
# 脚本 exit 1，Brain API status 永远停留 starting，GHA 傻等 720s(600s轮询+120s健康检查) 超时。
#
# 用 mock 覆盖 git/npm/node/curl/pg_dump/pg_restore/createdb/psql，直接验证两条行为：
# 1. dropdb 调用时 PID_FILE 记录的旧进程已经死亡；
# 2. PR 根 lock 与镜像指纹不同时，按根 workspace 安装分支 Brain 生产依赖且不建旧依赖 symlink。
# 都是能直接证伪真实故障的行为断言，不是脆弱的源码字符串位置断言。

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET="${SCRIPT_DIR}/../preview-env-start.sh"
PASS=0; FAIL=0

pass() { echo "  PASS: $1"; PASS=$((PASS + 1)); }
fail() { echo "  FAIL: $1 — $2"; FAIL=$((FAIL + 1)); }

PR_NUMBER=900001
LOG_FILE="/tmp/preview-${PR_NUMBER}.log"
PID_FILE="/tmp/preview-${PR_NUMBER}.pid"
SCRIPT_LOCK="/tmp/preview-script-lock-${PR_NUMBER}"

setup() {
  TMP=$(mktemp -d)
  PREVIEW_BASE_DIR="$TMP/previews"
  mkdir -p "$PREVIEW_BASE_DIR"
  REPO_ROOT="$TMP/repo"
  mkdir -p "$REPO_ROOT/node_modules" "$REPO_ROOT/packages/brain/node_modules"
  printf '%s\n' "${IMAGE_ROOT_LOCK_CONTENT:-image-lock-v1}" > "$REPO_ROOT/package-lock.json"
  BIN="$TMP/bin"
  mkdir -p "$BIN"
  DROPDB_MARKER="$TMP/dropdb_saw_old_pid_status"
  NPM_MARKER="$TMP/npm_calls"
  PSQL_MARKER="$TMP/psql_calls"
  : > "$PSQL_MARKER"
  BRAIN_NM_TARGET="$REPO_ROOT/node_modules"
  BRAIN_BRAIN_NM_TARGET="$REPO_ROOT/packages/brain/node_modules"
  BRAIN_LOCK_TARGET="$REPO_ROOT/package-lock.json"

  # 真实起一个长驻"旧进程"，模拟上一轮遗留的常驻 Brain 子进程
  sleep 300 &
  OLD_PID=$!
  echo "$OLD_PID" > "$PID_FILE"

  # mock git：worktree add 建目录即可（倒数第二个参数是目标目录：worktree add <dir> <ref>）
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
  printf '%s\n' "${BRANCH_ROOT_LOCK_CONTENT:-image-lock-v1}" > "$target_dir/package-lock.json"
  exit 0
fi
exit 0
SH
  chmod +x "$BIN/git"

  cat >"$BIN/npm" <<'SH'
#!/bin/bash
printf '%s|%s\n' "$PWD" "$*" >> "$NPM_MARKER"
if [[ "$PWD" == */preview-900001 ]] && [[ "$*" == *"--workspace=packages/brain"* ]]; then
  mkdir -p node_modules
fi
exit 0
SH
  chmod +x "$BIN/npm"

  # mock node：起一个假的新 Brain 常驻进程（真实 sleep，验证 BRAIN_PID 被正确捕获即可）
  cat >"$BIN/node" <<'SH'
#!/bin/bash
exec sleep 300
SH
  chmod +x "$BIN/node"

  # mock curl：健康检查直接返回 running，Step6 立即通过，不用真等
  cat >"$BIN/curl" <<'SH'
#!/bin/bash
echo '{"status":"running"}'
SH
  chmod +x "$BIN/curl"

  printf '#!/bin/bash\nexit 0\n' >"$BIN/pg_dump"; chmod +x "$BIN/pg_dump"
  printf '#!/bin/bash\ncat >/dev/null\nexit 0\n' >"$BIN/pg_restore"; chmod +x "$BIN/pg_restore"
  printf '#!/bin/bash\nexit 0\n' >"$BIN/createdb"; chmod +x "$BIN/createdb"
  cat >"$BIN/psql" <<'SH'
#!/bin/bash
printf '%s\n' "$*" >> "${PSQL_MARKER:?}"
exit 0
SH
  chmod +x "$BIN/psql"

  # mock dropdb：调用发生的那一刻，记录 PID_FILE 里的旧进程是否还活着
  cat >"$BIN/dropdb" <<SH
#!/bin/bash
if kill -0 "$OLD_PID" 2>/dev/null; then
  echo "ALIVE" > "$DROPDB_MARKER"
else
  echo "DEAD" > "$DROPDB_MARKER"
fi
exit 0
SH
  chmod +x "$BIN/dropdb"

  export PATH="$BIN:$PATH"
  export REPO_ROOT PREVIEW_BASE_DIR NPM_MARKER PSQL_MARKER BRANCH_ROOT_LOCK_CONTENT
  export BRAIN_NM_TARGET BRAIN_BRAIN_NM_TARGET BRAIN_LOCK_TARGET
}

teardown() {
  kill -9 "$OLD_PID" 2>/dev/null || true
  [ -n "${OLD_SCRIPT_PID:-}" ] && kill -9 "$OLD_SCRIPT_PID" 2>/dev/null || true
  [ -n "${OLD_SCRIPT_CHILD_PID:-}" ] && kill -9 "$OLD_SCRIPT_CHILD_PID" 2>/dev/null || true
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

# ── 测试：dropdb 执行时，PID_FILE 记录的旧进程必须已经死亡 ──────────────────────
setup
DB_HOST="testhost" DB_USER="testuser" DB_PASSWORD="testpw" \
  bash "$TARGET" "$PR_NUMBER" "test-branch" "59999" "cecelia_preview_test900001" \
  > "$TMP/stdout.log" 2>&1
RC=$?

if [ ! -f "$DROPDB_MARKER" ]; then
  fail "dropdb 从未被调用" "脚本可能提前失败退出，见 $TMP/stdout.log: $(cat "$TMP/stdout.log" 2>/dev/null | tail -20)"
elif [ "$(cat "$DROPDB_MARKER")" = "DEAD" ]; then
  pass "dropdb 执行前，上一轮遗留 Brain 进程已被杀死"
else
  fail "dropdb 执行时上一轮遗留 Brain 进程仍存活" "PID=$OLD_PID 未被及时清理，会导致 dropdb 报 is-being-accessed-by-other-users，进而 createdb 因库已存在报错、脚本 exit 1（PR#4176 CI 实测根因）"
fi

if [ "${RC:-1}" -eq 0 ]; then
  pass "脚本正常完成（exit 0）"
else
  fail "脚本非正常退出" "exit code=${RC:-unknown}，见 $TMP/stdout.log"
fi

# ── 断言：克隆完成后必须灭活预览库里的 harness 任务（2026-08-05 preview-4643 事故）──
# 预览库是生产整库快照，携带 in_progress/queued 的 harness_initiative 任务；预览 Brain
# startup-sync 会把它们当孤儿重点火，与生产 Brain 争抢同一 fleet-worker/run。灭活 UPDATE
# 必须打在预览库（-d ${DB_NAME}）上，绝不允许打在生产库 cecelia 上。
NEUTRALIZE_CALL=$(grep -E "harness_initiative" "$PSQL_MARKER" 2>/dev/null | grep -E "UPDATE tasks" | head -1)
if [ -z "$NEUTRALIZE_CALL" ]; then
  fail "克隆后未灭活预览库 harness 任务" "psql 调用记录无 harness_initiative UPDATE: $(tr '\n' ';' < "$PSQL_MARKER" 2>/dev/null)"
elif echo "$NEUTRALIZE_CALL" | grep -q -- "-d cecelia_preview_test900001"; then
  pass "克隆后已对预览库执行 harness 任务灭活 UPDATE"
else
  fail "灭活 UPDATE 未指向预览库" "实际调用: $NEUTRALIZE_CALL"
fi
teardown

# ── 测试：接管同 PR 启动锁时必须终止旧脚本的完整子进程树 ─────────────────────
# 旧脚本可能正阻塞在 npm ci。只 kill Bash 父进程会让 npm 子进程变成孤儿，随后新
# 实例删除同一 worktree，两个流程互相破坏并产生 ENOENT/package.json。
setup
OLD_SCRIPT_CHILD_FILE="$TMP/old-script-child.pid"
bash -c 'sleep 300 & echo $! >"$1"; wait' _ "$OLD_SCRIPT_CHILD_FILE" &
OLD_SCRIPT_PID=$!
for _wait_child in 1 2 3 4 5 6 7 8 9 10; do
  [ -s "$OLD_SCRIPT_CHILD_FILE" ] && break
  sleep 0.1
done
OLD_SCRIPT_CHILD_PID=$(cat "$OLD_SCRIPT_CHILD_FILE")
echo "$OLD_SCRIPT_PID" > "$SCRIPT_LOCK"

DB_HOST="testhost" DB_USER="testuser" DB_PASSWORD="testpw" \
  bash "$TARGET" "$PR_NUMBER" "test-branch" "59999" "cecelia_preview_test900001" \
  > "$TMP/stdout.log" 2>&1

if ! kill -0 "$OLD_SCRIPT_PID" 2>/dev/null && ! kill -0 "$OLD_SCRIPT_CHILD_PID" 2>/dev/null; then
  pass "同 PR 新实例接管前已终止旧脚本完整进程树"
else
  fail "同 PR 锁接管遗留了旧子进程" "parent=${OLD_SCRIPT_PID} child=${OLD_SCRIPT_CHILD_PID}；孤儿 npm 会继续写已被新实例删除的 worktree"
fi
teardown

# ── 测试：分支根 lock 变化时，不得复用镜像里的旧依赖 ────────────────────────
BRANCH_ROOT_LOCK_CONTENT="branch-lock-v2"
setup
DB_HOST="testhost" DB_USER="testuser" DB_PASSWORD="testpw" \
  bash "$TARGET" "$PR_NUMBER" "test-branch" "59999" "cecelia_preview_test900001" \
  > "$TMP/stdout.log" 2>&1
RC=$?

BRAIN_WORK_ROOT="${PREVIEW_BASE_DIR}/preview-${PR_NUMBER}"
if grep -Fq "${BRAIN_WORK_ROOT}|ci --workspace=packages/brain --omit=dev --omit=optional --ignore-scripts" "$NPM_MARKER" 2>/dev/null; then
  pass "根 lock 变化时按 workspace 安装分支声明的 Brain 生产依赖"
else
  fail "根 lock 变化时未安装分支 Brain 生产依赖" "npm 调用记录: $(tr '\n' ';' < "$NPM_MARKER" 2>/dev/null)"
fi

if [ -d "${BRAIN_WORK_ROOT}/node_modules" ] && [ ! -L "${BRAIN_WORK_ROOT}/node_modules" ] \
    && [ ! -L "${BRAIN_WORK_ROOT}/packages/brain/node_modules" ]; then
  pass "根 lock 变化时使用 worktree 独立 node_modules"
else
  fail "根 lock 变化时仍复用旧依赖" "worktree 根/Brain node_modules 不能是镜像 symlink"
fi

if [ "${RC:-1}" -eq 0 ]; then
  pass "依赖变化场景脚本正常完成（exit 0）"
else
  fail "依赖变化场景脚本非正常退出" "exit code=${RC:-unknown}，见 $TMP/stdout.log"
fi
teardown

# ── thin-clone 专项 Case：BEHAVIOR-01 / BEHAVIOR-02 ──────────────────────────
# 验证 pg_dump 含完整 7 张历史表的 --exclude-table-data 参数，且业务表不在排除名单中。
# 本 Case 对应合同测试 thin-clone-unit.test.sh（sprint 08110001-preview-thin-clone），
# 永久保留在 CI 里，禁止删除。

THIN_CLONE_TABLES=(
  memory_stream cecelia_events alertness_metrics
  checkpoint_writes checkpoint_blobs checkpoints captures
)
THIN_CLONE_BUSINESS_TABLES=(tasks journeys decisions journey_features golden_paths preview_environments)

# BEHAVIOR-01: 静态断言 — 脚本含 THIN_CLONE_EXCLUDE 数组且早于 pg_dump
ARRAY_LINE=$(grep -n 'THIN_CLONE_EXCLUDE' "$TARGET" | head -1 | cut -d: -f1 || true)
PGDUMP_LINE=$(grep -n 'pg_dump' "$TARGET" | head -1 | cut -d: -f1 || true)

if [ -z "$ARRAY_LINE" ]; then
  fail "thin-clone BEHAVIOR-01" "scripts/preview-env-start.sh 中未找到 THIN_CLONE_EXCLUDE 定义"
elif [ -n "$PGDUMP_LINE" ] && [ "$ARRAY_LINE" -lt "$PGDUMP_LINE" ]; then
  pass "thin-clone BEHAVIOR-01: THIN_CLONE_EXCLUDE 数组定义在 pg_dump 之前（${ARRAY_LINE} < ${PGDUMP_LINE}）"
else
  fail "thin-clone BEHAVIOR-01" "THIN_CLONE_EXCLUDE 定义行（${ARRAY_LINE}）不早于 pg_dump 行（${PGDUMP_LINE}）"
fi

for tbl in "${THIN_CLONE_TABLES[@]}"; do
  if grep -q "$tbl" "$TARGET"; then
    pass "thin-clone BEHAVIOR-01: 排除表 ${tbl} 出现在脚本中"
  else
    fail "thin-clone BEHAVIOR-01" "排除表 ${tbl} 未出现在脚本中"
  fi
done

# BEHAVIOR-02: unit mock — pg_dump 含完整 --exclude-table-data 参数
TC_PR=910002
TC_LOG="/tmp/preview-${TC_PR}.log"
TC_PID="/tmp/preview-${TC_PR}.pid"
TC_LOCK="/tmp/preview-script-lock-${TC_PR}"

TC_TMP=$(mktemp -d)
TC_PREVIEW_BASE="$TC_TMP/previews"
mkdir -p "$TC_PREVIEW_BASE"
TC_REPO="$TC_TMP/repo"
mkdir -p "$TC_REPO/node_modules" "$TC_REPO/packages/brain/node_modules"
printf '%s\n' "image-lock-v1" > "$TC_REPO/package-lock.json"
TC_BIN="$TC_TMP/bin"
mkdir -p "$TC_BIN"
TC_PGDUMP_ARGS="$TC_TMP/pgdump_args"
TC_PSQL="$TC_TMP/psql_calls"
: > "$TC_PGDUMP_ARGS"
: > "$TC_PSQL"
TC_STDOUT="$TC_TMP/stdout.log"

sleep 300 &
TC_OLD_PID=$!
echo "$TC_OLD_PID" > "$TC_PID"

cat >"$TC_BIN/git" <<'SH'
#!/bin/bash
if [[ "$*" == *"worktree list"* ]]; then exit 0
elif [[ "$*" == *"worktree remove"* ]]; then exit 0
elif [[ "$*" == *"worktree prune"* ]]; then exit 0
elif [[ "$*" == *"fetch"* ]]; then exit 0
elif [[ "$*" == *"worktree add"* ]]; then
  args=("$@"); n=${#args[@]}; target_dir="${args[$((n-2))]}"
  mkdir -p "$target_dir/apps/dashboard" "$target_dir/packages/brain"
  printf '%s\n' "image-lock-v1" > "$target_dir/package-lock.json"
  exit 0
fi
exit 0
SH
chmod +x "$TC_BIN/git"

cat >"$TC_BIN/npm" <<'SH'
#!/bin/bash
exit 0
SH
chmod +x "$TC_BIN/npm"

cat >"$TC_BIN/node" <<'SH'
#!/bin/bash
exec sleep 300
SH
chmod +x "$TC_BIN/node"

cat >"$TC_BIN/curl" <<'SH'
#!/bin/bash
echo '{"status":"running"}'
SH
chmod +x "$TC_BIN/curl"

cat >"$TC_BIN/pg_dump" <<SH
#!/bin/bash
printf '%s\n' "\$@" > "${TC_PGDUMP_ARGS}"
exit 0
SH
chmod +x "$TC_BIN/pg_dump"

printf '#!/bin/bash\ncat >/dev/null\nexit 0\n' >"$TC_BIN/pg_restore"; chmod +x "$TC_BIN/pg_restore"
printf '#!/bin/bash\nexit 0\n' >"$TC_BIN/createdb"; chmod +x "$TC_BIN/createdb"
printf '#!/bin/bash\nexit 0\n' >"$TC_BIN/dropdb"; chmod +x "$TC_BIN/dropdb"

cat >"$TC_BIN/psql" <<SH
#!/bin/bash
printf '%s\n' "\$@" >> "${TC_PSQL}"
echo "0"
exit 0
SH
chmod +x "$TC_BIN/psql"

TC_OLD_PATH="$PATH"
export PATH="$TC_BIN:$PATH"
export REPO_ROOT="$TC_REPO" PREVIEW_BASE_DIR="$TC_PREVIEW_BASE"
TC_NM="$TC_REPO/node_modules"
TC_BNM="$TC_REPO/packages/brain/node_modules"
TC_LOCK="$TC_REPO/package-lock.json"
export BRAIN_NM_TARGET="$TC_NM" BRAIN_BRAIN_NM_TARGET="$TC_BNM" BRAIN_LOCK_TARGET="$TC_LOCK"

DB_HOST="testhost" DB_USER="testuser" DB_PASSWORD="testpw" \
  bash "$TARGET" "$TC_PR" "thin-clone-unit-branch" "59997" "cecelia_preview_test910002" \
  > "$TC_STDOUT" 2>&1

if [ ! -s "$TC_PGDUMP_ARGS" ]; then
  fail "thin-clone BEHAVIOR-02" "pg_dump 未被调用，脚本可能提前失败: $(tail -5 "$TC_STDOUT" 2>/dev/null)"
else
  TC_PGDUMP_CONTENT=$(cat "$TC_PGDUMP_ARGS")
  for tbl in "${THIN_CLONE_TABLES[@]}"; do
    if echo "$TC_PGDUMP_CONTENT" | grep -q -- "--exclude-table-data=${tbl}"; then
      pass "thin-clone BEHAVIOR-02: pg_dump 含 --exclude-table-data=${tbl}"
    else
      fail "thin-clone BEHAVIOR-02" "pg_dump 参数缺 --exclude-table-data=${tbl} 实际: $(echo "$TC_PGDUMP_CONTENT" | tr '\n' ' ')"
    fi
  done
  for tbl in "${THIN_CLONE_BUSINESS_TABLES[@]}"; do
    if echo "$TC_PGDUMP_CONTENT" | grep -q -- "--exclude-table-data=${tbl}"; then
      fail "thin-clone BEHAVIOR-02" "业务表 ${tbl} 出现在排除参数中"
    else
      pass "thin-clone BEHAVIOR-02: 业务表 ${tbl} 不在排除参数中（正确）"
    fi
  done
fi

# 清理
export PATH="$TC_OLD_PATH"
kill -9 "$TC_OLD_PID" 2>/dev/null || true
TC_BRAIN_PID=$(cat "$TC_PID" 2>/dev/null || echo "")
[ -n "$TC_BRAIN_PID" ] && kill -9 "$TC_BRAIN_PID" 2>/dev/null || true
rm -f "$TC_LOG" "$TC_PID" "$TC_LOCK"
rm -rf "$TC_TMP"

# ── 总结 ──────────────────────────────────────────────────────────────────────
echo ""
echo "结果: PASS=${PASS}, FAIL=${FAIL}"
[ "$FAIL" -eq 0 ] || exit 1
