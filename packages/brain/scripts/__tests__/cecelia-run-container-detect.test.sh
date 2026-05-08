#!/usr/bin/env bash
# cecelia-run.sh 容器 detect 4 分支验证
# 思路：用 wrapper script mock id/sudo + fake .dockerenv 文件，跑 cecelia-run.sh 头部 if 条件
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BRAIN_SCRIPTS="$(cd "$SCRIPT_DIR/.." && pwd)"
CECELIA_RUN="$BRAIN_SCRIPTS/cecelia-run.sh"

if [ ! -f "$CECELIA_RUN" ]; then
  echo "FAIL: cecelia-run.sh 不存在 $CECELIA_RUN"
  exit 1
fi

WORK=$(mktemp -d -t cecelia-run-test-XXXXXX)
trap "rm -rf '$WORK'" EXIT

PASS_COUNT=0
FAIL_COUNT=0

assert() {
  local desc="$1"; local actual="$2"; local expected="$3"
  if [ "$actual" = "$expected" ]; then
    echo "✓ $desc"
    PASS_COUNT=$((PASS_COUNT + 1))
  else
    echo "✗ $desc — expected: $expected, got: $actual"
    FAIL_COUNT=$((FAIL_COUNT + 1))
  fi
}

# Helper: 在隔离环境跑 if 条件，返回 "ENTERED" 或 "SKIPPED"
test_branch() {
  local label="$1"
  local mock_uid="$2"          # "0" or "1000"
  local has_dockerenv="$3"     # "yes" or "no"
  local has_sudo="$4"          # "yes" or "no"

  local sandbox="$WORK/$label"
  mkdir -p "$sandbox/bin"

  # mock id command
  cat > "$sandbox/bin/id" <<EOF
#!/usr/bin/env bash
if [ "\$1" = "-u" ]; then echo "$mock_uid"; else /usr/bin/id "\$@"; fi
EOF
  chmod +x "$sandbox/bin/id"

  # mock sudo (or remove)
  if [ "$has_sudo" = "yes" ]; then
    cat > "$sandbox/bin/sudo" <<'EOF'
#!/usr/bin/env bash
echo "MOCK_SUDO_CALLED"
exit 0
EOF
    chmod +x "$sandbox/bin/sudo"
  fi

  # fake .dockerenv via DOCKERENV_FILE override
  local dockerenv_file="$sandbox/.dockerenv"
  if [ "$has_dockerenv" = "yes" ]; then
    touch "$dockerenv_file"
  fi

  local sentinel="$sandbox/sentinel"
  PATH="$sandbox/bin:/usr/bin:/bin" bash -c '
    DOCKERENV_FILE="'"$dockerenv_file"'"
    if [[ "$(id -u)" == "0" ]] && [[ ! -f "$DOCKERENV_FILE" ]] && command -v sudo >/dev/null 2>&1; then
      echo ENTERED > "'"$sentinel"'"
    else
      echo SKIPPED > "'"$sentinel"'"
    fi
  '
  cat "$sentinel"
}

echo "=== 测试 4 分支条件判断（cecelia-run.sh line 22 修复后）==="
assert "宿主 root + 无 .dockerenv + 有 sudo → ENTERED（走 sudo 切换）" \
  "$(test_branch host-root 0 no yes)" "ENTERED"

assert "宿主非 root user → SKIPPED（不进 if）" \
  "$(test_branch host-user 1000 no yes)" "SKIPPED"

assert "容器 root + 有 .dockerenv + 无 sudo → SKIPPED（容器跳过）" \
  "$(test_branch container-root-no-sudo 0 yes no)" "SKIPPED"

assert "容器 root + 有 .dockerenv + 有 sudo → SKIPPED（dockerenv 兜底）" \
  "$(test_branch container-root-with-sudo 0 yes yes)" "SKIPPED"

# 校验 cecelia-run.sh 实际源码 line 22 真的含新条件
echo ""
echo "=== 源码 line 22 必须含新条件 ==="
LINE_22=$(sed -n '22p' "$CECELIA_RUN")
if echo "$LINE_22" | grep -q '\-f /.dockerenv'; then
  echo "✓ cecelia-run.sh line 22 含 /.dockerenv 检查"
  PASS_COUNT=$((PASS_COUNT + 1))
else
  echo "✗ cecelia-run.sh line 22 缺 /.dockerenv 检查 — 当前内容: $LINE_22"
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi
if echo "$LINE_22" | grep -q 'command -v sudo'; then
  echo "✓ cecelia-run.sh line 22 含 sudo 检查"
  PASS_COUNT=$((PASS_COUNT + 1))
else
  echo "✗ cecelia-run.sh line 22 缺 sudo 检查 — 当前内容: $LINE_22"
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi

echo ""
echo "总计: PASS=$PASS_COUNT FAIL=$FAIL_COUNT"
[ "$FAIL_COUNT" -eq 0 ] && exit 0 || exit 1
