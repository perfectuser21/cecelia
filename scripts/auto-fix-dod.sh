#!/usr/bin/env bash
# 自动修复 DoD 格式错误

set -e

if [[ ! -f ".dod.md" ]]; then
    echo "⚠️  .dod.md 不存在，跳过"
    exit 0
fi

FIXED=false

# 检查是否包含 QA 引用
if ! grep -q "^QA:" .dod.md; then
    echo "❌ .dod.md 缺少 QA 引用"

    # 在第一行标题后插入 QA 引用
    sed -i '/^# DoD/a \nQA: docs/QA-DECISION.md' .dod.md
    echo "✅ 已添加 QA 引用"
    FIXED=true
fi

# 检查是否包含验收标准
if ! grep -q "## 验收标准" .dod.md; then
    echo "❌ .dod.md 缺少验收标准章节"
    echo -e "\n## 验收标准\n\n### 功能验收\n\n### 测试验收\n" >> .dod.md
    echo "✅ 已添加验收标准章节"
    FIXED=true
fi

# 检查 Test 字段格式（每个 checkbox 后应该有 Test: 行）
if grep -A1 "^- \[" .dod.md | grep -v "Test:" | grep -v "^--$" | grep -q "^- \["; then
    echo "⚠️  部分 DoD 条目缺少 Test 字段，请手动检查"
fi

if [[ "$FIXED" == "true" ]]; then
    echo "✅ DoD 格式已修复"
else
    echo "✅ DoD 格式正确"
fi
