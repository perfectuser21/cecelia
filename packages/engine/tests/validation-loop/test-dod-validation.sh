#!/usr/bin/env bash
# Test: DoD validation scoring

set -e

TEST_DIR="$(mktemp -d)"
cd "$TEST_DIR"

echo "=== Test: DoD Validation Scoring ==="
echo ""

# Test 1: High-quality DoD (should pass >= 90)
echo "Test 1: High-quality DoD"
cat > test-dod-good.md << 'EOF'
---
id: test
version: 1.0.0
---

# DoD: Test Feature

## 验收清单

- [ ] **功能实现完成**
  - Test: `bash test-feature.sh` 通过测试
  - 验证：功能正常运行，确保实现符合要求

- [ ] **测试覆盖**
  - Test: `npm run test` 所有单元测试通过
  - 验证：覆盖率 >= 80%，检查测试报告

- [ ] **性能达标**
  - Test: `time python benchmark.py` 执行时间 <5秒
  - 验证：性能符合要求，检查响应时间

- [ ] **文档完成**
  - Test: `grep -q "Feature" README.md` 找到 Feature 文档
  - 验证：文档清晰完整，包含使用说明

- [ ] **CI 通过**
  - Test: `gh run list --limit 1` 显示 success 状态
  - 验证：所有 CI 检查通过，DevGate 验证完成

- [ ] **代码质量**
  - Test: `bash scripts/check.sh` 代码检查通过
  - 验证：无 lint 错误，符合代码规范

## 备注

此 DoD 确保功能完整交付，测试覆盖全面，文档齐全。
EOF

if python3 /home/xx/perfect21/cecelia/engine/skills/dev/scripts/validate-dod.py test-dod-good.md; then
    echo "✅ PASS: High-quality DoD passes validation"
else
    echo "❌ FAIL: High-quality DoD should pass" >&2
    rm -rf "$TEST_DIR"
    exit 1
fi

# Test 2: Low-quality DoD (should fail < 90)
echo ""
echo "Test 2: Low-quality DoD"
cat > test-dod-bad.md << 'EOF'
---
id: test
---

# DoD

- [ ] Done
- [ ] Finished
EOF

if python3 /home/xx/perfect21/cecelia/engine/skills/dev/scripts/validate-dod.py test-dod-bad.md; then
    echo "❌ FAIL: Low-quality DoD should not pass" >&2
    rm -rf "$TEST_DIR"
    exit 1
else
    echo "✅ PASS: Low-quality DoD correctly fails validation"
fi

# Test 3: Report generation
echo ""
echo "Test 3: Report file generation"
if [[ -f ".dod-validation-report.json" ]]; then
    TOTAL_SCORE=$(jq -r '.total_score' .dod-validation-report.json)
    echo "✅ PASS: Report generated with score $TOTAL_SCORE"
else
    echo "❌ FAIL: Report file not created" >&2
    rm -rf "$TEST_DIR"
    exit 1
fi

rm -rf "$TEST_DIR"
echo ""
echo "✅ All DoD validation tests passed"
