#!/usr/bin/env bash
# ============================================================================
# Release Check: L2B + L3 证据链校验
# ============================================================================
#
# 用途：develop → main 发版前的硬门禁
# 职责：校验证据是否齐全、格式正确、引用有效
#
# 检查项：
#   L2B - Evidence 校验：
#     - .layer2-evidence.md 存在
#     - 截图 ID (S1, S2) 对应文件存在
#     - curl 输出包含 HTTP_STATUS
#
#   L3 - Acceptance 校验：
#     - .dod.md 存在
#     - 所有 checkbox 打勾 [x]
#     - 每项有 Evidence 引用
#     - 引用的 ID 在 .layer2-evidence.md 中存在
#
# ============================================================================

set -euo pipefail

PROJECT_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
cd "$PROJECT_ROOT"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Release Check: L2B + L3 证据链校验"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

FAILED=0
CHECKED=0

# ============================================================================
# L2B - Evidence 校验
# ============================================================================
echo "  [L2B: Evidence 校验]"

L2_EVIDENCE_FILE="$PROJECT_ROOT/.layer2-evidence.md"

# 检查 .layer2-evidence.md 是否存在
echo -n "  证据文件... "
CHECKED=$((CHECKED + 1))
if [[ -f "$L2_EVIDENCE_FILE" ]]; then
    echo "✅"
else
    echo "❌ (.layer2-evidence.md 不存在)"
    echo "    → 请创建 .layer2-evidence.md 记录截图和 curl 验证"
    FAILED=1
fi

# 如果证据文件存在，检查内容
if [[ -f "$L2_EVIDENCE_FILE" ]]; then
    # 提取所有截图 ID（S1, S2, ...）
    SCREENSHOT_IDS=$(grep -oP '###\s+S\d+' "$L2_EVIDENCE_FILE" 2>/dev/null | grep -oP 'S\d+' || echo "")

    if [[ -n "$SCREENSHOT_IDS" ]]; then
        for SID in $SCREENSHOT_IDS; do
            # 查找对应的文件路径
            FILE_PATH=$(grep -A5 "### $SID:" "$L2_EVIDENCE_FILE" 2>/dev/null | grep -oP '文件:\s*`\K[^`]+' || echo "")

            if [[ -n "$FILE_PATH" ]]; then
                # 转换相对路径为绝对路径
                if [[ "$FILE_PATH" == ./* ]]; then
                    FULL_PATH="$PROJECT_ROOT/${FILE_PATH#./}"
                else
                    FULL_PATH="$PROJECT_ROOT/$FILE_PATH"
                fi

                echo -n "  截图 $SID... "
                CHECKED=$((CHECKED + 1))
                if [[ -f "$FULL_PATH" ]]; then
                    echo "✅"
                else
                    echo "❌ (文件不存在: $FILE_PATH)"
                    FAILED=1
                fi
            fi
        done
    fi

    # 检查 curl 证据
    CURL_IDS=$(grep -oP '###\s+C\d+' "$L2_EVIDENCE_FILE" 2>/dev/null | grep -oP 'C\d+' || echo "")

    if [[ -n "$CURL_IDS" ]]; then
        for CID in $CURL_IDS; do
            CURL_BLOCK=$(sed -n "/### $CID:/,/^###/p" "$L2_EVIDENCE_FILE" 2>/dev/null | head -n -1)

            echo -n "  curl $CID... "
            CHECKED=$((CHECKED + 1))
            if echo "$CURL_BLOCK" | grep -qE "HTTP_STATUS:\s*[0-9]+" 2>/dev/null; then
                echo "✅"
            else
                echo "❌ (缺少 HTTP_STATUS: xxx)"
                FAILED=1
            fi
        done
    fi

    # 如果没有任何截图和 curl 证据
    if [[ -z "$SCREENSHOT_IDS" && -z "$CURL_IDS" ]]; then
        echo "  ⚠️  证据文件为空（没有 S* 或 C* 条目）"
        echo "    → 请添加截图或 curl 验证证据"
        FAILED=1
    fi
fi

# ============================================================================
# L3 - Acceptance 校验
# ============================================================================
echo ""
echo "  [L3: Acceptance 校验]"

DOD_FILE="$PROJECT_ROOT/.dod.md"

# 检查 .dod.md 是否存在
echo -n "  DoD 文件... "
CHECKED=$((CHECKED + 1))
if [[ -f "$DOD_FILE" ]]; then
    echo "✅"
else
    echo "❌ (.dod.md 不存在)"
    echo "    → 请创建 .dod.md 记录 DoD 清单"
    FAILED=1
fi

# 如果 DoD 文件存在，检查内容
if [[ -f "$DOD_FILE" ]]; then
    # 检查是否所有 checkbox 都打勾
    UNCHECKED=$(grep -c '\- \[ \]' "$DOD_FILE" 2>/dev/null) || true
    CHECKED_BOXES=$(grep -c '\- \[x\]' "$DOD_FILE" 2>/dev/null) || true

    echo -n "  验收项... "
    CHECKED=$((CHECKED + 1))
    if [[ "$UNCHECKED" -eq 0 && "$CHECKED_BOXES" -gt 0 ]]; then
        echo "✅ ($CHECKED_BOXES 项全部完成)"
    elif [[ "$CHECKED_BOXES" -eq 0 ]]; then
        echo "❌ (没有验收项)"
        echo "    → 请在 .dod.md 添加 - [x] 验收项"
        FAILED=1
    else
        echo "❌ ($UNCHECKED 项未完成)"
        echo "    → 请完成所有验收项后再提交"
        FAILED=1
    fi

    # 检查 Evidence 引用
    echo -n "  Evidence 引用... "
    CHECKED=$((CHECKED + 1))

    EVIDENCE_REFS=$(grep -oP 'Evidence:\s*`\K[^`]+' "$DOD_FILE" 2>/dev/null || echo "")

    if [[ -z "$EVIDENCE_REFS" ]]; then
        echo "❌ (没有 Evidence 引用)"
        echo "    → 每个 DoD 项必须有 Evidence: \`S1\` 或 \`C1\` 引用"
        FAILED=1
    else
        # 验证每个引用在 .layer2-evidence.md 中存在
        INVALID_EVIDENCE=0
        if [[ -f "$L2_EVIDENCE_FILE" ]]; then
            for REF in $EVIDENCE_REFS; do
                if ! grep -q "### $REF:" "$L2_EVIDENCE_FILE" 2>/dev/null; then
                    echo "❌ (引用 $REF 在证据文件中不存在)"
                    INVALID_EVIDENCE=1
                    FAILED=1
                fi
            done

            if [[ $INVALID_EVIDENCE -eq 0 ]]; then
                REF_COUNT=$(echo "$EVIDENCE_REFS" | wc -w)
                echo "✅ ($REF_COUNT 个引用有效)"
            fi
        else
            echo "❌ (无法验证，.layer2-evidence.md 不存在)"
            FAILED=1
        fi
    fi
fi

# ============================================================================
# 结果输出
# ============================================================================
echo ""

if [[ $FAILED -eq 1 ]]; then
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "  ❌ Release Check 失败"
    echo ""
    echo "  请补充证据："
    echo "    1. 创建/更新 .layer2-evidence.md（截图/curl 证据）"
    echo "    2. 创建/更新 .dod.md（DoD 清单，全勾）"
    echo "    3. 确保 DoD 每项有 Evidence 引用"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    exit 1
fi

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  ✅ Release Check 通过 ($CHECKED 项)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

exit 0
