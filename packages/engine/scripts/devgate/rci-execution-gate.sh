#!/bin/bash
# RCI Execution Gate — 执行 regression-contract 中的 P0 test_command
#
# 功能：
# - 扫描 packages/quality/contracts/cecelia-quality.regression-contract.yaml
# - 提取 priority: P0 条目的 test_command 和 test_file
# - 执行前检查 test_file 是否存在（不存在则 DEFERRED）
# - 检测需要运行时服务的命令（后台进程、网络服务等），标记为 DEFERRED
# - 执行可以在 CI 中运行的测试命令
#
# 输出格式：
#   ✅ C-DB-INIT-001: pass
#   ❌ C-GATEWAY-HTTP-001: failed
#   ⏭️  C-DB-INIT-001: DEFERRED (test_file not found)
#   ⏭️  C-GATEWAY-HTTP-001: DEFERRED (requires runtime)
#
# 使用方式：
#   bash packages/engine/scripts/devgate/rci-execution-gate.sh
#   bash packages/engine/scripts/devgate/rci-execution-gate.sh --contract path/to/contract.yaml

set -euo pipefail

# ─── 颜色 ────────────────────────────────────────────────────────────────────
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
NC='\033[0m'

# ─── 路径解析 ─────────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# 从 packages/engine/scripts/devgate 往上找仓库根目录
REPO_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
QUALITY_DIR="$REPO_ROOT/packages/quality"

# ─── 参数解析 ─────────────────────────────────────────────────────────────────
CONTRACT_FILE=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --contract)
      CONTRACT_FILE="$2"
      shift 2
      ;;
    *)
      shift
      ;;
  esac
done

# 默认只扫描 cecelia-quality（包含 test_command 字段的合约）
if [ -z "$CONTRACT_FILE" ]; then
  CONTRACT_FILE="$REPO_ROOT/packages/quality/contracts/cecelia-quality.regression-contract.yaml"
fi

# ─── 前置检查 ─────────────────────────────────────────────────────────────────
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  RCI Execution Gate (P0 contracts)"
echo "  Contract: $(basename "$CONTRACT_FILE")"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

if [ ! -f "$CONTRACT_FILE" ]; then
  echo "WARNING: Contract file not found: $CONTRACT_FILE"
  echo "  Skipping RCI execution gate"
  exit 0
fi

# 检查解析工具（优先用 python3）
if ! command -v python3 &>/dev/null; then
  echo "WARNING: python3 not found — skipping RCI execution gate"
  exit 0
fi

# ─── 检测运行时依赖（需要后台服务的命令）────────────────────────────────────
# 如果 test_command 中包含以下模式，则标记为 requires-runtime
requires_runtime() {
  local cmd="$1"
  # 启动后台服务进程（带 &）
  if echo "$cmd" | grep -qE '&\s*$'; then
    return 0
  fi
  # 显式需要网络服务（curl localhost/http）
  if echo "$cmd" | grep -qE 'curl.*(localhost|127\.0\.0\.1)'; then
    return 0
  fi
  # 启动 HTTP/gateway/server 文件（包含启动服务器逻辑）
  if echo "$cmd" | grep -qE '(gateway-http|gateway\.sh|server\.js)'; then
    return 0
  fi
  return 1
}

# ─── 解析并执行 P0 条目 ───────────────────────────────────────────────────────
PASS=0
FAIL=0
DEFERRED=0
FAIL_IDS=()

# 使用 python3 解析 YAML（避免 yq 依赖）
P0_ENTRIES=$(python3 - "$CONTRACT_FILE" <<'PYEOF'
import sys
import re

contract_file = sys.argv[1]

with open(contract_file, 'r', encoding='utf-8') as f:
    content = f.read()

# 简单的 YAML 解析：找到每个条目（以 "  - id:" 开头）
# 格式：
#   - id: C-DB-INIT-001
#     priority: P0
#     test_command: bash tests/test-db-init.sh
#     test_file: tests/test-db-init.sh

# 分割条目（以 "  - id:" 开头）
entries = re.split(r'\n(?=  - id:)', content)

for entry in entries:
    # 提取字段
    id_match = re.search(r'^\s*-?\s*id:\s*(.+)$', entry, re.MULTILINE)
    priority_match = re.search(r'^\s*priority:\s*(.+)$', entry, re.MULTILINE)
    test_cmd_match = re.search(r'^\s*test_command:\s*(.+)$', entry, re.MULTILINE)
    test_file_match = re.search(r'^\s*test_file:\s*(.+)$', entry, re.MULTILINE)

    if not id_match or not priority_match or not test_cmd_match:
        continue

    rci_id = id_match.group(1).strip()
    priority = priority_match.group(1).strip()
    test_cmd = test_cmd_match.group(1).strip()
    test_file = test_file_match.group(1).strip() if test_file_match else ""

    ci_runnable_match = re.search(r'^\s*ci_runnable:\s*(.+)$', entry, re.MULTILINE)
    ci_runnable = ci_runnable_match.group(1).strip().lower() if ci_runnable_match else "true"

    if priority == "P0":
        print(f"{rci_id}|{test_cmd}|{test_file}|{ci_runnable}")
PYEOF
)

if [ -z "$P0_ENTRIES" ]; then
  echo "INFO: No P0 entries found in contract"
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  RCI Execution Gate PASSED (no P0 entries)"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  exit 0
fi

while IFS='|' read -r rci_id test_cmd test_file ci_runnable; do
  [ -z "$rci_id" ] && continue

  # 0. 检查 ci_runnable 标记（false = 不在 CI 中运行）
  if [ "${ci_runnable:-true}" = "false" ]; then
    echo -e "${YELLOW}DEFERRED  $rci_id: ci_runnable=false (需要外部服务，不在 CI 中运行)${NC}"
    DEFERRED=$((DEFERRED + 1))
    continue
  fi

  # 1. 检查 test_file 是否存在
  if [ -n "$test_file" ]; then
    FULL_TEST_FILE="$QUALITY_DIR/$test_file"
    if [ ! -f "$FULL_TEST_FILE" ]; then
      echo -e "${YELLOW}DEFERRED  $rci_id: test_file not found ($test_file)${NC}"
      DEFERRED=$((DEFERRED + 1))
      continue
    fi
  fi

  # 2. 检查是否需要运行时服务
  if requires_runtime "$test_cmd"; then
    echo -e "${YELLOW}DEFERRED  $rci_id: requires runtime${NC}"
    DEFERRED=$((DEFERRED + 1))
    continue
  fi

  # 3. 执行测试命令（在 quality 目录下执行）
  echo -e "${CYAN}RUNNING   $rci_id: $test_cmd${NC}"
  if (cd "$QUALITY_DIR" && eval "$test_cmd" 2>&1 | sed 's/^/  /'); then
    echo -e "${GREEN}PASS      $rci_id${NC}"
    PASS=$((PASS + 1))
  else
    echo -e "${RED}FAIL      $rci_id${NC}"
    FAIL=$((FAIL + 1))
    FAIL_IDS+=("$rci_id")
  fi
  echo ""

done <<< "$P0_ENTRIES"

# ─── 汇总报告 ─────────────────────────────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  RCI Execution Gate Summary"
echo "  Pass: $PASS | Fail: $FAIL | Deferred: $DEFERRED"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if [ "$FAIL" -gt 0 ]; then
  echo ""
  echo "  RCI Execution Gate FAILED"
  echo ""
  echo "  Failed contracts:"
  for id in "${FAIL_IDS[@]}"; do
    echo "    - $id"
  done
  echo ""
  echo "  以上 P0 回归契约测试失败，必须修复后才能合并。"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  exit 1
fi

echo ""
echo "  RCI Execution Gate PASSED"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
