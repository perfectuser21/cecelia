#!/usr/bin/env bash
# Test: Anti-cheat mechanisms

set -e

TEST_DIR="$(mktemp -d)"
cd "$TEST_DIR"

echo "=== Test: Anti-Cheat Verification ==="
echo ""

# Create a valid PRD
cat > test.md << 'EOF'
---
id: test
version: 1.0.0
---

# PRD: Test Feature

## 需求来源

用户需求，明确的场景描述，详细说明为什么需要这个功能。
这是一个典型的用户故事，用户在特定场景下需要此功能。

## 功能描述

详细的功能描述，完整的用户故事。功能需要实现以下核心能力：
1. 用户可以执行操作 A
2. 系统自动处理任务 B
3. 结果展示给用户

## 涉及文件

- `src/file1.py` - 主要实现代码
- `src/file2.js` - 前端模块
- `tests/test_feature.py` - 测试文件

## 成功标准

- [x] 功能测试通过，验证所有核心功能
- [x] 性能测试达标，检查响应时间
- [x] 验证用户场景完整覆盖

## 技术方案

实现方案使用以下架构：
1. 代码模块设计 - 采用模块化架构
2. 函数实现 - 核心函数使用 Python 实现
3. 文件组织 - 按功能模块组织文件结构

技术栈：Python 3.8+, JavaScript ES6, pytest 测试框架

## 边界条件

限制条件和假设：
1. 用户已登录系统
2. 数据量不超过 1000 条
3. 仅支持特定格式输入

## 风险评估

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| 性能问题 | 高 | 添加缓存机制 |
| 数据损坏 | 中 | 定期备份 |
| 兼容性 | 低 | 多环境测试 |
EOF

# Generate valid report
python3 /home/xx/perfect21/cecelia/engine/skills/dev/scripts/validate-prd.py test.md >/dev/null

# Test 1: Valid case should pass
echo "Test 1: Valid PRD and report"
if bash /home/xx/perfect21/cecelia/engine/skills/dev/scripts/anti-cheat-prd.sh test.md 2>&1 | grep -q "All 10 layers passed"; then
    echo "✅ PASS: Anti-cheat passes valid case"
else
    echo "❌ FAIL: Anti-cheat should pass valid case" >&2
    rm -rf "$TEST_DIR"
    exit 1
fi

# Test 2: Modified content (SHA256 mismatch)
echo ""
echo "Test 2: SHA256 mismatch detection"

# Save original content
cp test.md test.md.backup

# Modify content
echo "extra line" >> test.md

if bash /home/xx/perfect21/cecelia/engine/skills/dev/scripts/anti-cheat-prd.sh test.md 2>&1 | grep -q "SHA256 mismatch"; then
    echo "✅ PASS: SHA256 mismatch detected"
else
    echo "❌ FAIL: Should detect SHA256 mismatch" >&2
    rm -rf "$TEST_DIR"
    exit 1
fi

# Restore file
mv test.md.backup test.md

# Re-generate valid report for next test
python3 /home/xx/perfect21/cecelia/engine/skills/dev/scripts/validate-prd.py test.md >/dev/null

# Test 3: Environment variable bypass attempt
echo ""
echo "Test 3: Environment variable bypass detection"
if SKIP_VALIDATION=true bash /home/xx/perfect21/cecelia/engine/skills/dev/scripts/anti-cheat-prd.sh test.md 2>&1 | grep -q "SKIP_VALIDATION=true detected"; then
    echo "✅ PASS: Bypass attempt detected"
else
    echo "❌ FAIL: Should detect bypass attempt" >&2
    rm -rf "$TEST_DIR"
    exit 1
fi

rm -rf "$TEST_DIR"
echo ""
echo "✅ All anti-cheat tests passed"
