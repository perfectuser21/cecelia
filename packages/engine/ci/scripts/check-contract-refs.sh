#!/usr/bin/env bash
# check-contract-refs.sh — 验证 regression-contract.yaml 中引用的测试文件实际存在
# 在 CI engine-tests job 中运行，防止幽灵引用积累
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENGINE_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
CONTRACT="$ENGINE_DIR/regression-contract.yaml"

if [[ ! -f "$CONTRACT" ]]; then
    echo "❌ regression-contract.yaml 不存在: $CONTRACT"
    exit 1
fi

MISSING=0
CHECKED=0

while IFS= read -r path; do
    CHECKED=$((CHECKED + 1))
    if [[ ! -f "$ENGINE_DIR/$path" ]]; then
        echo "❌ MISSING: $path"
        MISSING=$((MISSING + 1))
    fi
done < <(grep -E '^\s+test: "tests/' "$CONTRACT" | sed 's/.*test: "//; s/".*//' | sort -u)

echo ""
echo "Contract Refs Check: 检查 $CHECKED 个测试引用"

if [[ $MISSING -gt 0 ]]; then
    echo "❌ 发现 $MISSING 个幽灵引用（文件不存在）"
    echo "   请删除 regression-contract.yaml 中的这些引用，或补齐对应的测试文件"
    exit 1
fi

echo "✅ 全部 $CHECKED 个引用有效"
