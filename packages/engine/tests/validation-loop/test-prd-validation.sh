#!/usr/bin/env bash
# Test: PRD validation scoring

set -e

TEST_DIR="$(mktemp -d)"
cd "$TEST_DIR"

echo "=== Test: PRD Validation Scoring ==="
echo ""

# Test 1: High-quality PRD (should pass >= 90)
echo "Test 1: High-quality PRD"
cat > test-prd-good.md << 'EOF'
---
id: test
version: 1.0.0
---

# PRD: Test Feature

## 需求来源

用户需求，场景描述，为什么需要这个功能。

## 功能描述

详细的功能描述，用户故事。

## 涉及文件

- file1.py
- file2.js
- module/core.ts

## 成功标准

- [x] 测试通过
- [x] 验证完成
- [x] 检查达标

## 技术方案

实现方案使用以下架构：代码模块设计、函数实现、文件组织。

## 边界条件

限制和假设条件说明。

## 风险评估

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| 风险1 | 高 | 应对方案 |
EOF

if python3 /home/xx/perfect21/cecelia/engine/skills/dev/scripts/validate-prd.py test-prd-good.md; then
    echo "✅ PASS: High-quality PRD passes validation"
else
    echo "❌ FAIL: High-quality PRD should pass" >&2
    rm -rf "$TEST_DIR"
    exit 1
fi

# Test 2: Low-quality PRD (should fail < 90)
echo ""
echo "Test 2: Low-quality PRD"
cat > test-prd-bad.md << 'EOF'
---
id: test
---

# PRD

Some text.
EOF

if python3 /home/xx/perfect21/cecelia/engine/skills/dev/scripts/validate-prd.py test-prd-bad.md; then
    echo "❌ FAIL: Low-quality PRD should not pass" >&2
    rm -rf "$TEST_DIR"
    exit 1
else
    echo "✅ PASS: Low-quality PRD correctly fails validation"
fi

# Test 3: Report generation
echo ""
echo "Test 3: Report file generation"
if [[ -f ".prd-validation-report.json" ]]; then
    TOTAL_SCORE=$(jq -r '.total_score' .prd-validation-report.json)
    echo "✅ PASS: Report generated with score $TOTAL_SCORE"
else
    echo "❌ FAIL: Report file not created" >&2
    rm -rf "$TEST_DIR"
    exit 1
fi

rm -rf "$TEST_DIR"
echo ""
echo "✅ All PRD validation tests passed"
