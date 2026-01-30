# Audit Report: 测试清理（第二批）

Branch: cp-0130-test-cleanup
Date: 2026-01-30
Scope: tests/hooks/detect-priority.test.ts, tests/hooks/pr-gate-phase1.test.ts
Target Level: L2

## Summary

| Layer | Count | Status |
|-------|-------|--------|
| L1 | 0 | PASS |
| L2 | 0 | PASS |
| L3 | 0 | - |
| L4 | 0 | - |

Decision: PASS

## 审计范围

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| tests/hooks/detect-priority.test.ts | 测试清理 | 删除 17 个无效 skip 测试 |
| tests/hooks/pr-gate-phase1.test.ts | 测试清理 | 删除 3 个无效 skip 测试 |

## L1 检查（阻塞性）

| 项目 | 状态 | 说明 |
|------|------|------|
| TypeScript 语法 | PASS | vitest 测试文件语法正确 |
| 测试通过 | PASS | 252 tests passed, 2 skipped |
| 功能覆盖 | PASS | 保留测试覆盖仍在使用的功能 |

## L2 检查（功能性）

| 项目 | 状态 | 说明 |
|------|------|------|
| 注释说明 | PASS | 删除的测试有明确注释说明原因 |
| 测试完整性 | PASS | label/env 检测仍有测试覆盖 |
| 文档一致性 | PASS | detect-priority.cjs L265-266 已说明功能移除 |

## 清理详情

### detect-priority.test.ts

**删除的 describe blocks**:
- `describe.skip("CRITICAL → P0 映射")` - 4 个测试
- `describe.skip("HIGH → P1 映射")` - 3 个测试
- `describe.skip("security 前缀 → P0 映射")` - 4 个测试

**删除的 it.skip**:
- "P0/P1/P2/P3 直接映射" 中 4 个测试
- "优先级检测顺序" 中 2 个测试

**保留的测试**:
- label 检测（CRITICAL/HIGH/priority:Px）
- env 变量检测（PR_PRIORITY）
- unknown 默认值测试

### pr-gate-phase1.test.ts

**删除的测试**:
- "should detect P0 from env variable" - QA-DECISION.md 优先
- "should detect P1 from PR title" - PR_TITLE 检测已移除
- "should output JSON with --json flag" - 同上

**保留的测试**:
- check-dod-mapping.cjs 所有测试
- detect-priority.cjs 基本测试
- require-rci-update-if-p0p1.sh 所有测试

## Blockers

None

## Conclusion

测试清理完成。删除的 20 个 skip 测试均为已移除功能（PR_TITLE 检测），保留的测试仍覆盖有效功能。
