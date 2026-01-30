# Audit Report: CI 硬化

Branch: cp-0130-ci-hardening
Date: 2026-01-30
Scope: ci/scripts/, scripts/devgate/, .github/workflows/ci.yml
Target Level: L2

## Summary

| Layer | Count | Status |
|-------|-------|--------|
| L1 | 4 | PASS |
| L2 | 3 | PASS |
| L3 | 0 | - |
| L4 | 0 | - |

Decision: PASS

## 审计范围

| 文件 | 变更类型 | 风险等级 |
|------|---------|---------|
| ci/scripts/generate-evidence.sh | 完全重写 | P0 |
| ci/scripts/evidence-gate.sh | 完全重写 | P0 |
| ci/scripts/write-check-result.sh | 新增 | P0 |
| ci/scripts/add-manual-verification.sh | 新增 | P0 |
| .github/workflows/ci.yml | 重构 | P0 |
| scripts/devgate/check-dod-mapping.cjs | 修复 | P0 |
| scripts/devgate/l2a-check.sh | 增强 | P1 |
| scripts/devgate/l2b-check.sh | 增强 | P1 |
| scripts/devgate/scan-rci-coverage.cjs | 修复 | P1 |

## L1 检查（阻塞性）

| 项目 | 状态 | 说明 |
|------|------|------|
| Shell 语法 | PASS | 所有 .sh 文件通过 bash -n |
| TypeScript 编译 | PASS | tsc --noEmit 通过 |
| JSON 格式 | PASS | jq 验证通过 |
| 测试通过 | PASS | 249 tests passed |

## L2 检查（功能性）

| 项目 | 状态 | 说明 |
|------|------|------|
| P0-1 Evidence 真实结果 | PASS | 从 checks JSON 汇总，不再硬编码 |
| P0-2 manual: 后门封堵 | PASS | 需要 manual_verifications 记录 |
| P1-1 L2A/L2B 内容验证 | PASS | 结构+密度检查 |
| P1-2 RCI 精确匹配 | PASS | 移除 includes 误判 |

## P0 安全修复详情

### P0-1: Evidence 真实结果

**问题**: `generate-evidence.sh` 硬编码 `qa_gate_passed: true`

**修复**:
- CI 每步输出 check JSON 到 `ci/out/checks/`
- `generate-evidence.sh` 汇总计算 qa_gate_passed
- `evidence-gate.sh` 验证事实（存在、通过、hash）

### P0-2: manual: 后门封堵

**问题**: `manual:` 直接返回 `{valid: true}`

**修复**:
- 必须在 evidence 中有 `manual_verifications` 数组
- 每条记录包含 actor/timestamp/evidence

## 测试覆盖

| 测试文件 | 测试数 | 状态 |
|---------|--------|------|
| tests/ci/evidence.test.ts | 12 | ✅ |
| tests/gate/scan-rci-coverage.test.ts | 16 | ✅ |
| tests/devgate/l2a-check.test.ts | 11 | ✅ |

## Blockers

None

## Conclusion

所有 P0 安全漏洞已修复，P1 增强已完成。测试全部通过。
