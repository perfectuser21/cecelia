# Audit Report

> P0 级优先级检测 Bug 修复

## 基本信息

| 字段 | 值 |
|------|-----|
| Branch | `cp-fix-priority-detection-and-rci` |
| Date | 2026-01-23 |
| Scope | scripts/devgate/detect-priority.cjs, regression-contract.yaml, skills/qa/SKILL.md, skills/audit/SKILL.md |
| Target Level | L2 |

## 审计结果

### 统计

| 层级 | 数量 | 状态 |
|------|------|------|
| L1 (阻塞性) | 1 | FIXED |
| L2 (功能性) | 0 | - |
| L3 (最佳实践) | 0 | - |
| L4 (过度优化) | 0 | - |

### 修复列表

| ID | 文件 | 问题 | 状态 |
|----|------|------|------|
| B1 | scripts/devgate/detect-priority.cjs:33 | 缺少 CRITICAL/HIGH/security 关键字映射 | FIXED |

### 修复详情

#### B1: 优先级检测 Bug

**问题**:
- `extractPriority()` 函数只检测 P0/P1/P2/P3 关键字
- 不识别 CRITICAL/HIGH 审计严重性关键字
- 不识别 `security:` 前缀
- 导致 v8.24.0 的 13 个 CRITICAL 安全修复绕过了 P0 RCI 检查

**影响**:
- P0/P1 级修复没有触发 RCI 更新检查
- 安全修复没有对应的回归契约条目
- 潜在的安全回归风险

**修复**:
```javascript
// CRITICAL → P0
if (/\bCRITICAL\b/i.test(text)) return "P0";

// HIGH → P1
if (/\bHIGH\b/i.test(text)) return "P1";

// security 前缀 → P0
if (/^security[:(]/i.test(text)) return "P0";
```

**测试覆盖**:
- 21 个新增单元测试
- 覆盖 CRITICAL、HIGH、security 关键字
- 覆盖大小写、位置、组合场景

### 补充的 RCI 条目

为 v8.24.0 安全修复补充 8 个 RCI：

| RCI ID | 描述 |
|--------|------|
| H1-010 | JSON 预验证防注入 (branch-protect) |
| H1-011 | 路径遍历检查 (branch-protect) |
| H2-011 | JSON 预验证防注入 (pr-gate) |
| H2-012 | sed 注入防护 (pr-gate) |
| H2-013 | CRITICAL/HIGH 优先级映射 |
| H4-003 | RCI ID 格式白名单 (run-regression) |
| C1-002 | CI Job 权限最小化 |
| C1-003 | curl JSON 安全生成 |

## 结论

Decision: **PASS**

### PASS 条件
- [x] L1 问题：1 个，已 FIXED
- [x] L2 问题：0 个
- [x] 单元测试：21 个全绿
- [x] npm run qa：134 个测试通过

---

**审计完成时间**: 2026-01-23 12:30
