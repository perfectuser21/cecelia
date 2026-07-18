#!/usr/bin/env bash
# main-repo-sentinel.test.sh — 主仓哨兵测试(临时 git 仓 fixture,零副作用)
# 使用方式:bash scripts/__tests__/main-repo-sentinel.test.sh
set -uo pipefail
ERRORS=0; PASS=0
pass() { echo "✅ $1"; PASS=$((PASS+1)); }
fail() { echo "❌ $1"; ERRORS=$((ERRORS+1)); }

REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
SCRIPT="$REPO_ROOT/scripts/patrol/main-repo-sentinel.sh"
TMPD=$(mktemp -d -t sentinel-test.XXXXXX)
trap 'rm -rf "$TMPD"' EXIT
NOTIFY_LOG="$TMPD/notify.log"
NOTIFY_STUB="$TMPD/notify.sh"; printf '#!/usr/bin/env bash\necho "$1" >> "%s"\n' "$NOTIFY_LOG" > "$NOTIFY_STUB"; chmod +x "$NOTIFY_STUB"
GH_MERGED="$TMPD/gh-merged.sh"; printf '#!/usr/bin/env bash\necho 1\n' > "$GH_MERGED"; chmod +x "$GH_MERGED"
GH_NONE="$TMPD/gh-none.sh"; printf '#!/usr/bin/env bash\necho 0\n' > "$GH_NONE"; chmod +x "$GH_NONE"

echo "=== main-repo-sentinel 测试 ==="

# fixture:origin 裸仓 + 工作仓
ORIGIN="$TMPD/origin.git"; WORK="$TMPD/work"
git init -q --bare "$ORIGIN"
git init -q -b main "$WORK"
mkdir -p "$TMPD/nohooks"
(cd "$WORK" && git config core.hooksPath "$TMPD/nohooks" && git config user.email t@t && git config user.name t \
  && echo a > f.txt && git add . && git commit -qm init \
  && git remote add origin "$ORIGIN" && git push -qu origin main)

# 1 main+净 → exit 0 无输出
OUT=$(SENTINEL_REPO_DIR="$WORK" SENTINEL_GH_CMD="$GH_NONE" SENTINEL_NOTIFY_CMD="$NOTIFY_STUB" bash "$SCRIPT" 2>&1); RC=$?
if [[ $RC -eq 0 && -z "$OUT" ]]; then pass "main+净:静默 exit 0"; else fail "main+净异常(rc=$RC out=$OUT)"; fi

# 2 被霸在已合并分支 → 自动救回 main
(cd "$WORK" && git switch -qc cp-hijack && echo dirty > drop.txt)
OUT=$(SENTINEL_REPO_DIR="$WORK" SENTINEL_GH_CMD="$GH_MERGED" SENTINEL_NOTIFY_CMD="$NOTIFY_STUB" bash "$SCRIPT" 2>&1); RC=$?
BR=$(cd "$WORK" && git branch --show-current)
if [[ $RC -eq 0 && "$BR" == "main" && "$OUT" == RESCUED* ]]; then pass "已合并分支:自动救回 main"; else fail "救回异常(rc=$RC br=$BR out=$OUT)"; fi

# 3 被霸在未合并分支 → 不动+告警 exit 1
(cd "$WORK" && git switch -qc cp-unmerged)
RC=0; OUT=$(SENTINEL_REPO_DIR="$WORK" SENTINEL_GH_CMD="$GH_NONE" SENTINEL_NOTIFY_CMD="$NOTIFY_STUB" bash "$SCRIPT" 2>&1) || RC=$?
BR=$(cd "$WORK" && git branch --show-current)
if [[ $RC -eq 1 && "$BR" == "cp-unmerged" && "$OUT" == ALERT* ]] && /usr/bin/grep -q "未合并" "$NOTIFY_LOG"; then
  pass "未合并分支:不动+告警 exit 1"
else fail "未合并分支路径异常(rc=$RC br=$BR)"; fi

# 4 main 但脏 → WARN 不动 exit 0
(cd "$WORK" && git switch -q main && echo x >> f.txt)
RC=0; OUT=$(SENTINEL_REPO_DIR="$WORK" SENTINEL_GH_CMD="$GH_NONE" SENTINEL_NOTIFY_CMD="$NOTIFY_STUB" bash "$SCRIPT" 2>&1) || RC=$?
if [[ $RC -eq 0 && "$OUT" == WARN* ]]; then pass "main 脏:只警不动"; else fail "main 脏路径异常(rc=$RC out=$OUT)"; fi

echo ""; echo "结果: PASS=$PASS FAIL=$ERRORS"
[[ $ERRORS -eq 0 ]] || exit 1
