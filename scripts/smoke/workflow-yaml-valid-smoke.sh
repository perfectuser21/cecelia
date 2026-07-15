#!/usr/bin/env bash
# workflow-yaml-valid-smoke.sh — GitHub Actions workflow YAML 可解析守卫
#
# 守的病：run:| shell block 内嵌多行 python3 -c heredoc 时，若 python 代码顶格（0 缩进）写，
#   会破坏 YAML block scalar → GitHub 每次校验 startup_failure（0s failure，jobs=0）→
#   scheduled/dispatch run 全部起不来。heartbeat-sentinel + sentinel-active 曾双双中招，
#   自创建起从没真正跑过（假 active）。GitHub 只在 push 时静默标红，本地无守卫时不可见。
#
# 断言：.github/workflows/ 下每个 *.yml/*.yaml 都能被 YAML 解析器解析。
#   任一解析失败 → 报红 + 打印文件与错误行（顶格坑会指向 "could not find expected ':'"）。
#
# 用法： bash scripts/smoke/workflow-yaml-valid-smoke.sh
# 退出码： 0=全部可解析  1=有文件解析失败

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
WF_DIR="$ROOT_DIR/.github/workflows"

GREEN='\033[0;32m'; RED='\033[0;31m'; NC='\033[0m'
FAILED=0
pass() { echo -e "${GREEN}[OK]${NC} $1"; }
fail() { echo -e "${RED}[X]${NC} $1"; FAILED=$((FAILED + 1)); }

echo "=== workflow YAML 可解析守卫 ==="
echo ""

# 确保 pyyaml 可用（CI ubuntu 自带 python3，pyyaml 现装；本地一般已有）
if ! python3 -c "import yaml" 2>/dev/null; then
  echo "  安装 pyyaml..."
  pip3 install --quiet pyyaml 2>/dev/null || pip install --quiet pyyaml 2>/dev/null || {
    echo -e "${RED}[X]${NC} pyyaml 装不上，无法校验"; exit 1; }
fi

if [[ ! -d "$WF_DIR" ]]; then
  fail "找不到 .github/workflows 目录"
  exit 1
fi

shopt -s nullglob 2>/dev/null || true
COUNT=0
for f in "$WF_DIR"/*.yml "$WF_DIR"/*.yaml; do
  [[ -e "$f" ]] || continue
  COUNT=$((COUNT + 1))
  ERR=$(python3 -c "import yaml,sys; yaml.safe_load(open(sys.argv[1]))" "$f" 2>&1)
  if [[ $? -eq 0 ]]; then
    pass "$(basename "$f")"
  else
    fail "$(basename "$f") 解析失败"
    echo "$ERR" | grep -E "could not find|line [0-9]+|Error" | head -3 | sed 's/^/      /'
  fi
done

echo ""
if [[ "$COUNT" -eq 0 ]]; then
  fail "workflows 目录为空（守卫无对象，疑似路径错）"
fi

echo "========================================"
if [[ "$FAILED" -eq 0 ]]; then
  echo -e "${GREEN}WORKFLOW_YAML_VALID_OK${NC} — $COUNT 个 workflow 全部可解析"
  exit 0
else
  echo -e "${RED}WORKFLOW_YAML_VALID_FAIL${NC} — $FAILED 个 workflow 解析失败"
  exit 1
fi
