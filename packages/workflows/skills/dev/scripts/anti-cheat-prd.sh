#!/usr/bin/env bash
# PRD 防篡改验证 - 10 层校验（复用 OKR stop-okr.sh 架构）
#
# 防止通过以下方式绕过验证：
# - 手动编辑分数
# - 删除报告文件
# - 环境变量绕过
# - SHA256 哈希不匹配
#
# 退出码：
#   0 - 全部检查通过
#   2 - 任意检查失败（阻断工作流，维持 Stop Hook 循环）

set -euo pipefail

PRD_FILE="${1:-.prd-*.md}"
REPORT_FILE=".prd-validation-report.json"

# 解析 glob 模式
PRD_FILE=$(ls $PRD_FILE 2>/dev/null | head -1 || echo "")

if [[ -z "$PRD_FILE" ]]; then
    echo "❌ 第 1 层失败：未找到 PRD 文件（模式：.prd-*.md）" >&2
    exit 2
fi

echo "🔒 PRD 防篡改：10 层校验"
echo ""

# ===== 第 1 层：文件存在 =====
echo "第 1 层：PRD 文件存在"
if [[ ! -f "$PRD_FILE" ]]; then
    echo "❌ 失败：$PRD_FILE 不存在" >&2
    exit 2
fi
echo "✅ 通过"

# ===== 第 2 层：文件非空 =====
echo "第 2 层：PRD 非空"
if [[ ! -s "$PRD_FILE" ]]; then
    echo "❌ 失败：$PRD_FILE 为空文件" >&2
    exit 2
fi
echo "✅ 通过"

# ===== 第 3 层：有 Frontmatter =====
echo "第 3 层：包含 frontmatter"
if ! head -1 "$PRD_FILE" | grep -q '^---$'; then
    echo "❌ 失败：缺少 YAML frontmatter" >&2
    exit 2
fi
echo "✅ 通过"

# ===== 第 4 层：验证报告存在 =====
echo "第 4 层：验证报告存在"
if [[ ! -f "$REPORT_FILE" ]]; then
    echo "❌ 失败：$REPORT_FILE 不存在" >&2
    echo "   运行：python skills/dev/scripts/validate-prd.py \"$PRD_FILE\"" >&2
    exit 2
fi
echo "✅ 通过"

# ===== 第 5 层：报告非空 =====
echo "第 5 层：验证报告非空"
if [[ ! -s "$REPORT_FILE" ]]; then
    echo "❌ 失败：$REPORT_FILE 为空文件" >&2
    exit 2
fi
echo "✅ 通过"

# ===== 第 6 层：报告为合法 JSON =====
echo "第 6 层：验证报告为合法 JSON"
if ! jq empty "$REPORT_FILE" 2>/dev/null; then
    echo "❌ 失败：$REPORT_FILE 不是合法的 JSON" >&2
    exit 2
fi
echo "✅ 通过"

# ===== 第 7 层：包含分数字段 =====
echo "第 7 层：报告包含分数字段"
FORM_SCORE=$(jq -r '.form_score // "null"' "$REPORT_FILE")
CONTENT_SCORE=$(jq -r '.content_score // "null"' "$REPORT_FILE")
TOTAL_SCORE=$(jq -r '.total_score // "null"' "$REPORT_FILE")

if [[ "$FORM_SCORE" == "null" ]] || [[ "$CONTENT_SCORE" == "null" ]] || [[ "$TOTAL_SCORE" == "null" ]]; then
    echo "❌ 失败：报告缺少分数字段" >&2
    echo "   格式分：$FORM_SCORE" >&2
    echo "   内容分：$CONTENT_SCORE" >&2
    echo "   总分：$TOTAL_SCORE" >&2
    exit 2
fi
echo "✅ 通过（格式: $FORM_SCORE, 内容: $CONTENT_SCORE, 总分: $TOTAL_SCORE）"

# ===== 第 8 层：SHA256 哈希匹配 =====
echo "第 8 层：SHA256 哈希匹配"
REPORT_SHA=$(jq -r '.content_sha256 // "null"' "$REPORT_FILE")
ACTUAL_SHA=$(sha256sum "$PRD_FILE" | awk '{print $1}')

if [[ "$REPORT_SHA" != "$ACTUAL_SHA" ]]; then
    echo "❌ 失败：SHA256 不匹配（验证后内容被修改）" >&2
    echo "   报告 SHA：$REPORT_SHA" >&2
    echo "   实际 SHA：$ACTUAL_SHA" >&2
    echo "   重新运行：python skills/dev/scripts/validate-prd.py \"$PRD_FILE\"" >&2
    exit 2
fi
echo "✅ 通过"

# ===== 第 9 层：总分 >= 90 =====
echo "第 9 层：总分 >= 90"
if (( TOTAL_SCORE < 90 )); then
    echo "❌ 失败：总分 $TOTAL_SCORE < 90" >&2
    echo "   请查阅验证报告了解需修复的问题" >&2
    exit 2
fi
echo "✅ 通过"

# ===== 第 10 层：无绕过环境变量 =====
echo "第 10 层：无绕过环境变量"
if [[ "${SKIP_VALIDATION:-false}" == "true" ]]; then
    echo "❌ 失败：检测到 SKIP_VALIDATION=true（不允许绕过）" >&2
    exit 2
fi
echo "✅ 通过"

echo ""
echo "🎉 全部 10 层通过 — PRD 质量已验证"
exit 0
