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
# L3 fix: 使用 printf 替代 echo -n 提高兼容性
printf "  证据文件... "
CHECKED=$((CHECKED + 1))
if [[ -f "$L2_EVIDENCE_FILE" ]]; then
    echo "[OK]"
else
    echo "[FAIL] (.layer2-evidence.md 不存在)"
    echo "    -> 请创建 .layer2-evidence.md 记录截图和 curl 验证"
    FAILED=1
fi

# 如果证据文件存在，检查内容
if [[ -f "$L2_EVIDENCE_FILE" ]]; then
    # L2 fix: 使用兼容 macOS 的正则 (替换 grep -P)
    # 提取所有截图 ID（S1, S2, ...）
    SCREENSHOT_IDS=$(grep -o '###[[:space:]]*S[0-9]*' "$L2_EVIDENCE_FILE" 2>/dev/null | grep -o 'S[0-9]*' || echo "")

    if [[ -n "$SCREENSHOT_IDS" ]]; then
        for SID in $SCREENSHOT_IDS; do
            # 查找对应的文件路径 (兼容 macOS)
            FILE_PATH=$(grep -A5 "### $SID:" "$L2_EVIDENCE_FILE" 2>/dev/null | sed -n 's/.*文件:[[:space:]]*`\([^`]*\)`.*/\1/p' | head -1 || echo "")

            if [[ -n "$FILE_PATH" ]]; then
                # 转换相对路径为绝对路径
                if [[ "$FILE_PATH" == ./* ]]; then
                    FULL_PATH="$PROJECT_ROOT/${FILE_PATH#./}"
                else
                    FULL_PATH="$PROJECT_ROOT/$FILE_PATH"
                fi

                # L2 fix: 兼容 macOS 的路径规范化 (替换 realpath -m)
                # 使用 cd + pwd 组合来规范化路径
                normalize_path() {
                    local path="$1"
                    local dir
                    dir=$(dirname "$path")
                    local base
                    base=$(basename "$path")
                    if [[ -d "$dir" ]]; then
                        echo "$(cd "$dir" && pwd)/$base"
                    else
                        # 目录不存在时，手动处理 ..
                        echo "$path" | sed 's|/\./|/|g; s|[^/]*/\.\./||g'
                    fi
                }
                REAL_PATH=$(normalize_path "$FULL_PATH")

                # 安全检查：防止路径遍历
                if [[ -z "$REAL_PATH" || ! "$REAL_PATH" =~ ^"$PROJECT_ROOT" ]]; then
                    echo "  截图 $SID... [FAIL] (路径超出项目范围: $FILE_PATH)" >&2
                    FAILED=1
                    continue
                fi

                printf "  截图 $SID... "
                CHECKED=$((CHECKED + 1))
                if [[ -f "$FULL_PATH" ]]; then
                    echo "[OK]"
                else
                    echo "[FAIL] (文件不存在: $FILE_PATH)"
                    FAILED=1
                fi
            fi
        done
    fi

    # 检查 curl 证据 - 使用行号方法提取块（更可移植）
    CURL_IDS=$(grep -o '###[[:space:]]*C[0-9]*' "$L2_EVIDENCE_FILE" 2>/dev/null | grep -o 'C[0-9]*' || echo "")

    if [[ -n "$CURL_IDS" ]]; then
        # 获取文件总行数
        TOTAL_LINES=$(wc -l < "$L2_EVIDENCE_FILE" 2>/dev/null || echo "0")

        for CID in $CURL_IDS; do
            # 找到当前块的起始行号
            START_LINE=$(grep -n "^### ${CID}:" "$L2_EVIDENCE_FILE" 2>/dev/null | head -1 | cut -d: -f1)

            if [[ -z "$START_LINE" ]]; then
                printf "  curl $CID... "
                echo "[FAIL] (块不存在)"
                FAILED=1
                continue
            fi

            # 找到下一个 ### 的行号（作为结束）
            # 注意：grep 无匹配时返回 exit 1，需要 || true 防止 set -e 退出
            END_LINE=$(tail -n +$((START_LINE + 1)) "$L2_EVIDENCE_FILE" 2>/dev/null | grep -n "^### " | head -1 | cut -d: -f1 || true)

            if [[ -n "$END_LINE" ]]; then
                # 有下一个块，计算实际结束行
                END_LINE=$((START_LINE + END_LINE - 1))
            else
                # 没有下一个块，取到文件末尾
                END_LINE=$TOTAL_LINES
            fi

            # 提取块内容
            CURL_BLOCK=$(sed -n "${START_LINE},${END_LINE}p" "$L2_EVIDENCE_FILE" 2>/dev/null)

            printf "  curl $CID... "
            CHECKED=$((CHECKED + 1))
            if echo "$CURL_BLOCK" | grep -qE "HTTP_STATUS:[[:space:]]*[0-9]+" 2>/dev/null; then
                echo "[OK]"
            else
                echo "[FAIL] (缺少 HTTP_STATUS: xxx)"
                FAILED=1
            fi
        done
    fi

    # 如果没有任何截图和 curl 证据
    if [[ -z "$SCREENSHOT_IDS" && -z "$CURL_IDS" ]]; then
        echo "  [WARN] 证据文件为空（没有 S* 或 C* 条目）"
        echo "    -> 请添加截图或 curl 验证证据"
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
printf "  DoD 文件... "
CHECKED=$((CHECKED + 1))
if [[ -f "$DOD_FILE" ]]; then
    echo "[OK]"
else
    echo "[FAIL] (.dod.md 不存在)"
    echo "    -> 请创建 .dod.md 记录 DoD 清单"
    FAILED=1
fi

# 如果 DoD 文件存在，检查内容
if [[ -f "$DOD_FILE" ]]; then
    # 检查是否所有 checkbox 都打勾
    # P2 修复: 确保变量有默认值，避免算术比较失败
    UNCHECKED=$(grep -c '\- \[ \]' "$DOD_FILE" 2>/dev/null) || true
    CHECKED_BOXES=$(grep -c '\- \[x\]' "$DOD_FILE" 2>/dev/null) || true
    UNCHECKED=${UNCHECKED:-0}
    CHECKED_BOXES=${CHECKED_BOXES:-0}

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
    echo "  ❌ Release 检查失败"
    echo ""
    echo "  请补充证据："
    echo "    1. 创建/更新 .layer2-evidence.md（截图/curl 证据）"
    echo "    2. 创建/更新 .dod.md（DoD 清单，全勾）"
    echo "    3. 确保 DoD 每项有 Evidence 引用"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    exit 1
fi

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  ✅ Release 检查通过 ($CHECKED 项)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

exit 0
