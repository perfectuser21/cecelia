#!/usr/bin/env bash
# preview-reaper.test.sh — reaper 逻辑单元自测
# 用 mock 覆盖 gh/psql/dropdb/lsof/git，验证三源收集 + 路由决策

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REAPER="${SCRIPT_DIR}/../preview-reaper.sh"
PASS=0; FAIL=0

pass() { echo "  PASS: $1"; PASS=$((PASS + 1)); }
fail() { echo "  FAIL: $1 — $2"; FAIL=$((FAIL + 1)); }

setup() {
  TMP=$(mktemp -d)
  PREVIEW_BASE_DIR="$TMP/previews"
  mkdir -p "$PREVIEW_BASE_DIR"
  BIN="$TMP/bin"
  mkdir -p "$BIN"
  # mock git（使用独立 bin，不调用真实 git）
  cat >"$BIN/git" <<'SH'
#!/bin/bash
# 只拦截 remote get-url 和 worktree remove
if [[ "${*}" == *"remote get-url"* ]]; then
  echo "git@github.com:owner/repo.git"
elif [[ "${*}" == *"worktree remove"* ]]; then
  exit 0
fi
SH
  chmod +x "$BIN/git"
  # mock lsof：默认无进程
  printf '#!/bin/bash\necho ""\n' >"$BIN/lsof"; chmod +x "$BIN/lsof"
  # mock dropdb
  printf '#!/bin/bash\nexit 0\n' >"$BIN/dropdb"; chmod +x "$BIN/dropdb"
  export PATH="$BIN:$PATH"
  export PREVIEW_BASE_DIR
  export REPO_ROOT="$TMP/repo"
  export DB_HOST="testhost" DB_USER="testuser" DB_PASSWORD="testpw"
  export GH_REPO="owner/repo"
  mkdir -p "$TMP/repo/.git"
}

teardown() { rm -rf "$TMP"; }

# spawn 一个真实后台进程，cmdline 由脚本路径携带（用于 kill 真验，不 mock kill）
spawn_target() {
  local name="$1" s
  s="$TMP/$name"
  printf '#!/bin/bash\nwhile :; do sleep 0.3; done\n' >"$s"
  chmod +x "$s"
  # 关键：把子进程 fd 重定向掉，否则它会一直占着 $() 命令替换的 stdout 管道 → 命令替换永不返回
  bash "$s" >/dev/null 2>&1 &
  echo $!
}
alive() { kill -0 "$1" 2>/dev/null; }

# ── 测试 1：目录孤儿 + MERGED → 回收 ──────────────────────────────────────────
setup
mkdir -p "$PREVIEW_BASE_DIR/preview-101"

# psql：源B/C 均无数据；源D 无端口
cat >"$BIN/psql" <<'SH'
#!/bin/bash
# 根据 SQL 内容决定返回值
if [[ "$*" == *"pg_database"* && "$*" == *"cecelia_preview"* ]]; then
  echo ""
elif [[ "$*" == *"preview_environments"* && "$*" == *"pr_number"* && "$*" != *"port"* ]]; then
  echo ""
elif [[ "$*" == *"port"* ]]; then
  echo ""
else
  echo ""
fi
SH
chmod +x "$BIN/psql"

cat >"$BIN/gh" <<'SH'
#!/bin/bash
echo "MERGED"
SH
chmod +x "$BIN/gh"

OUT=$(bash "$REAPER" 2>&1)
if echo "$OUT" | grep -q "回收 1"; then
  pass "MERGED PR 目录孤儿被回收"
else
  fail "MERGED PR 目录孤儿未被回收" "output=$OUT"
fi
teardown

# ── 测试 2：CLOSED PR → 回收 ──────────────────────────────────────────────────
setup
mkdir -p "$PREVIEW_BASE_DIR/preview-102"
printf '#!/bin/bash\necho ""\n' >"$BIN/psql"; chmod +x "$BIN/psql"
printf '#!/bin/bash\necho "CLOSED"\n' >"$BIN/gh"; chmod +x "$BIN/gh"

OUT=$(bash "$REAPER" 2>&1)
if echo "$OUT" | grep -q "回收 1"; then
  pass "CLOSED PR 被回收"
else
  fail "CLOSED PR 未被回收" "output=$OUT"
fi
teardown

# ── 测试 3：OPEN PR → 跳过 ────────────────────────────────────────────────────
setup
mkdir -p "$PREVIEW_BASE_DIR/preview-103"
printf '#!/bin/bash\necho ""\n' >"$BIN/psql"; chmod +x "$BIN/psql"
printf '#!/bin/bash\necho "OPEN"\n' >"$BIN/gh"; chmod +x "$BIN/gh"

OUT=$(bash "$REAPER" 2>&1)
if echo "$OUT" | grep -q "跳过 1"; then
  pass "OPEN PR 被正确跳过"
else
  fail "OPEN PR 未被跳过" "output=$OUT"
fi
teardown

# ── 测试 4：gh 查询失败 → 保守跳过 ───────────────────────────────────────────
setup
mkdir -p "$PREVIEW_BASE_DIR/preview-104"
printf '#!/bin/bash\necho ""\n' >"$BIN/psql"; chmod +x "$BIN/psql"
printf '#!/bin/bash\nexit 1\n' >"$BIN/gh"; chmod +x "$BIN/gh"

OUT=$(bash "$REAPER" 2>&1)
if echo "$OUT" | grep -q "状态查询失败"; then
  pass "gh 失败时保守跳过"
else
  fail "gh 失败时未保守跳过" "output=$OUT"
fi
teardown

# ── 测试 5：--dry-run 不执行 dropdb ───────────────────────────────────────────
setup
mkdir -p "$PREVIEW_BASE_DIR/preview-105"
printf '#!/bin/bash\necho ""\n' >"$BIN/psql"; chmod +x "$BIN/psql"
printf '#!/bin/bash\necho "MERGED"\n' >"$BIN/gh"; chmod +x "$BIN/gh"
DROPDB_FLAG="$TMP/dropdb_called"
cat >"$BIN/dropdb" <<SH
#!/bin/bash
touch "$DROPDB_FLAG"
exit 0
SH
chmod +x "$BIN/dropdb"

bash "$REAPER" --dry-run 2>&1 >/dev/null
if [ ! -f "$DROPDB_FLAG" ]; then
  pass "--dry-run 不执行 dropdb"
else
  fail "--dry-run 仍执行了 dropdb" ""
fi
teardown

# ── 测试 6：空目录 → 无 PR，早退 ─────────────────────────────────────────────
setup
printf '#!/bin/bash\necho ""\n' >"$BIN/psql"; chmod +x "$BIN/psql"
printf '#!/bin/bash\nexit 0\n' >"$BIN/gh"; chmod +x "$BIN/gh"

OUT=$(bash "$REAPER" 2>&1)
if echo "$OUT" | grep -q "没有找到任何预览环境"; then
  pass "空环境早退"
else
  fail "空环境未早退" "output=$OUT"
fi
teardown

# ── 测试 7：DB 孤儿（无目录）→ 从源 B 发现并回收 ─────────────────────────────
setup
# 源A 无目录；源B 返回 cecelia_preview_106
cat >"$BIN/psql" <<'SH'
#!/bin/bash
if [[ "$*" == *"pg_database"* ]]; then
  echo "cecelia_preview_106"
else
  echo ""
fi
SH
chmod +x "$BIN/psql"
printf '#!/bin/bash\necho "MERGED"\n' >"$BIN/gh"; chmod +x "$BIN/gh"

OUT=$(bash "$REAPER" 2>&1)
if echo "$OUT" | grep -q "回收 1"; then
  pass "DB 孤儿（源B）被回收"
else
  fail "DB 孤儿（源B）未被回收" "output=$OUT"
fi
teardown

# ── 测试 8：cron 裸 PATH 环境接缝 ────────────────────────────────────────────
# 2026-07-20 事故根因：以上 1-7 全部在 setup() 里把 mock 塞进 PATH 最前面，
# 从未模拟过 cron 真实的裸 PATH（/usr/bin:/bin），导致 gh/psql/dropdb 在 cron
# 下 100% 找不到（都装在 /opt/homebrew/bin），dropdb 从建库以来从未被真正执行过。
# 这条不 mock，直接检查脚本自身有没有显式导出 PATH 覆盖 /opt/homebrew/bin，
# 并在真实裸 PATH 环境下验证脚本的导出行确实能让这些二进制被找到。
echo ""
echo "── 测试 8：cron 裸 PATH 环境接缝 ──"
if grep -q 'export PATH=.*opt/homebrew/bin' "$REAPER"; then
  pass "脚本顶部有显式 PATH 导出覆盖 /opt/homebrew/bin"
else
  fail "脚本没有显式 PATH 导出" "cron 默认 PATH（/usr/bin:/bin）下 gh/psql/dropdb 必然找不到，dropdb 步骤永远不会被触发"
fi

PATH_LINE=$(grep -m1 '^export PATH=' "$REAPER" || echo "")
if [ -n "$PATH_LINE" ]; then
  MISSING=""
  for bin in gh psql dropdb; do
    real_path=$(env -i HOME="$HOME" PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin" bash -c "command -v ${bin}" 2>/dev/null)
    [ -z "$real_path" ] && continue  # 本机没装，跳过该项
    found=$(env -i HOME="$HOME" PATH="/usr/bin:/bin" bash -c "$PATH_LINE; command -v ${bin}" 2>/dev/null)
    [ -z "$found" ] && MISSING="$MISSING $bin"
  done
  if [ -z "$MISSING" ]; then
    pass "脚本的 PATH 导出行能让裸 cron 环境找到 gh/psql/dropdb"
  else
    fail "脚本的 PATH 导出行仍找不到:$MISSING" "裸 cron 环境下这些工具不可用"
  fi
else
  fail "跳过二进制查找测试" "脚本没有 PATH 导出行"
fi

# ── 测试 9：PR npm cache 也是对账源，终态 PR 必须回收 ────────────────────────
setup
mkdir -p "$PREVIEW_BASE_DIR/.npm-cache-preview-107/_cacache"
printf 'cache-data' >"$PREVIEW_BASE_DIR/.npm-cache-preview-107/_cacache/index"
printf '#!/bin/bash\necho ""\n' >"$BIN/psql"; chmod +x "$BIN/psql"
printf '#!/bin/bash\necho "MERGED"\n' >"$BIN/gh"; chmod +x "$BIN/gh"

OUT=$(bash "$REAPER" 2>&1)
if [ ! -d "$PREVIEW_BASE_DIR/.npm-cache-preview-107" ] \
  && echo "$OUT" | grep -q "npm cache.*已删除"; then
  pass "MERGED PR 的独立 npm cache 被发现并回收"
else
  fail "MERGED PR 的独立 npm cache 泄漏" "output=$OUT"
fi
teardown

# ══════════════════════════════════════════════════════════════════════════════
# OrbStack 误杀根因修复（2026-08）：reaper 停止按端口持有者 kill，改读 PID 文件
# 并做身份校验 + 基础设施红线。以下用真实后台进程验 kill 真效果（不 mock kill）。
# ══════════════════════════════════════════════════════════════════════════════

echo ""
echo "── 测试 10：正常路径 — pid 文件 cmdline 含 preview-<pr> → 进程被终止 + DB inactive + npm 清理 ──"
setup
PR=108
mkdir -p "$PREVIEW_BASE_DIR/preview-$PR"
mkdir -p "$PREVIEW_BASE_DIR/.npm-cache-preview-$PR/_cacache"
# port 查询返回空：确保旧「lsof 杀端口」路径不会误判为通过（对旧码此测试应为红）
printf '#!/bin/bash\necho ""\n' >"$BIN/psql"; chmod +x "$BIN/psql"
printf '#!/bin/bash\necho "MERGED"\n' >"$BIN/gh"; chmod +x "$BIN/gh"
TGT=$(spawn_target "preview-$PR-brain.sh")
echo "$TGT" >"/tmp/preview-$PR.pid"
OUT=$(bash "$REAPER" 2>&1)
sleep 0.2
if ! alive "$TGT" \
  && echo "$OUT" | grep -q "已终止" \
  && echo "$OUT" | grep -q "inactive" \
  && [ ! -d "$PREVIEW_BASE_DIR/.npm-cache-preview-$PR" ]; then
  pass "正常路径：pid 文件命中 → 进程终止 + DB inactive + npm 清理"
else
  fail "正常路径未按预期回收" "alive=$(alive "$TGT" && echo Y || echo N) out=$OUT"
fi
kill -9 "$TGT" 2>/dev/null || true
rm -f "/tmp/preview-$PR.pid"
teardown

echo ""
echo "── 测试 11：身份不符 — pid 指向的进程 cmdline 不含 PR 号 → 不 kill + 日志含跳过原因 ──"
setup
PR=109
mkdir -p "$PREVIEW_BASE_DIR/preview-$PR"
cat >"$BIN/psql" <<'SH'
#!/bin/bash
if [[ "$*" == *"SELECT port"* ]]; then echo "5300"; else echo ""; fi
SH
chmod +x "$BIN/psql"
printf '#!/bin/bash\necho "MERGED"\n' >"$BIN/gh"; chmod +x "$BIN/gh"
TGT=$(spawn_target "unrelated-daemon.sh")
# lsof 返回 TGT：旧码会据此 kill（对旧码此测试应为红）
cat >"$BIN/lsof" <<SH
#!/bin/bash
echo "$TGT"
SH
chmod +x "$BIN/lsof"
echo "$TGT" >"/tmp/preview-$PR.pid"
OUT=$(bash "$REAPER" 2>&1)
sleep 0.2
if alive "$TGT" && echo "$OUT" | grep -qE "身份校验|跳过 kill|未含"; then
  pass "身份不符：cmdline 不含 preview-<pr> → 不 kill 且日志含跳过原因"
else
  fail "身份不符仍被 kill 或无跳过日志" "alive=$(alive "$TGT" && echo Y || echo N) out=$OUT"
fi
kill -9 "$TGT" 2>/dev/null || true
rm -f "/tmp/preview-$PR.pid"
teardown

echo ""
echo "── 测试 12（红线）：pid/端口指向 OrbStack Helper → 不 kill 且告警，执行了 kill 即失败 ──"
setup
PR=110
mkdir -p "$PREVIEW_BASE_DIR/preview-$PR"
cat >"$BIN/psql" <<'SH'
#!/bin/bash
if [[ "$*" == *"SELECT port"* ]]; then echo "5301"; else echo ""; fi
SH
chmod +x "$BIN/psql"
printf '#!/bin/bash\necho "MERGED"\n' >"$BIN/gh"; chmod +x "$BIN/gh"
TGT=$(spawn_target "preview-$PR-brain.sh")
# mock ps：把该 PID 的 cmdline 报成 OrbStack Helper（vmgr）
cat >"$BIN/ps" <<'SH'
#!/bin/bash
echo "/Applications/OrbStack.app/Contents/Frameworks/OrbStack Helper (vmgr).app/Contents/MacOS/OrbStack Helper (vmgr)"
SH
chmod +x "$BIN/ps"
cat >"$BIN/lsof" <<SH
#!/bin/bash
echo "$TGT"
SH
chmod +x "$BIN/lsof"
echo "$TGT" >"/tmp/preview-$PR.pid"
OUT=$(bash "$REAPER" 2>&1)
sleep 0.2
if alive "$TGT" && echo "$OUT" | grep -qE "基础设施|OrbStack|拒绝 kill|🚨"; then
  pass "红线：命中 OrbStack 基础设施进程 → 不 kill 且告警"
else
  fail "红线失败：OrbStack 进程被 kill 或无告警" "alive=$(alive "$TGT" && echo Y || echo N) out=$OUT"
fi
kill -9 "$TGT" 2>/dev/null || true
rm -f "/tmp/preview-$PR.pid"
teardown

echo ""
echo "── 测试 13：pid 文件缺失 → 不调用 lsof、不 kill，走降级分支 ──"
setup
PR=111
mkdir -p "$PREVIEW_BASE_DIR/preview-$PR"
cat >"$BIN/psql" <<'SH'
#!/bin/bash
if [[ "$*" == *"SELECT port"* ]]; then echo "5302"; else echo ""; fi
SH
chmod +x "$BIN/psql"
printf '#!/bin/bash\necho "MERGED"\n' >"$BIN/gh"; chmod +x "$BIN/gh"
LSOF_FLAG="$TMP/lsof_called"
cat >"$BIN/lsof" <<SH
#!/bin/bash
touch "$LSOF_FLAG"
echo ""
SH
chmod +x "$BIN/lsof"
rm -f "/tmp/preview-$PR.pid"
OUT=$(bash "$REAPER" 2>&1)
if [ ! -f "$LSOF_FLAG" ] && echo "$OUT" | grep -qE "PID 文件.*缺失|降级"; then
  pass "pid 文件缺失 → 不调用 lsof，走降级分支"
else
  fail "pid 缺失仍调用 lsof 或未降级" "lsof_called=$([ -f "$LSOF_FLAG" ] && echo Y || echo N) out=$OUT"
fi
teardown

echo ""
echo "── 测试 14（回归）：真实预览端口段 dry-run 回收，OrbStack vmgr 进程 PID 不变 ──"
setup
PR=112
mkdir -p "$PREVIEW_BASE_DIR/preview-$PR"
cat >"$BIN/psql" <<'SH'
#!/bin/bash
if [[ "$*" == *"SELECT port"* ]]; then echo "5300"; else echo ""; fi
SH
chmod +x "$BIN/psql"
printf '#!/bin/bash\necho "MERGED"\n' >"$BIN/gh"; chmod +x "$BIN/gh"
VMGR=$(spawn_target "orbstack-vmgr-standin.sh")
cat >"$BIN/lsof" <<SH
#!/bin/bash
echo "$VMGR"
SH
chmod +x "$BIN/lsof"
echo "$VMGR" >"/tmp/preview-$PR.pid"
bash "$REAPER" --dry-run >/dev/null 2>&1
sleep 0.2
if alive "$VMGR"; then
  pass "回归：dry-run 回收后 vmgr 进程 PID 不变（未被杀）"
else
  fail "回归：dry-run 竟杀了 vmgr 进程" ""
fi
kill -9 "$VMGR" 2>/dev/null || true
rm -f "/tmp/preview-$PR.pid"
teardown

# ── 总结 ──────────────────────────────────────────────────────────────────────
echo ""
echo "结果: PASS=${PASS}, FAIL=${FAIL}"
[ "$FAIL" -eq 0 ] || exit 1
