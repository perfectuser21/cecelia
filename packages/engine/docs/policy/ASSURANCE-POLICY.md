---
id: assurance-policy
version: 1.0.0
created: 2026-01-23
updated: 2026-01-23
changelog:
  - 1.0.0: 初始版本
---

# Assurance Policy（质量保证政策）

本文档是 ZenithJoy Engine 的**根本规则**（L0 Rules / 宪法）。

---

## 1. 优先级定义

| 优先级 | 名称 | 定义 | 响应要求 |
|--------|------|------|----------|
| P0 | Critical | 灾难级问题，导致误放行/数据丢失/安全穿透 | 立即修复，阻塞发布 |
| P1 | High | 重要问题，影响核心功能 | 本次 PR 必须修复 |
| P2 | Medium | 一般问题，影响用户体验 | 计划修复 |
| P3 | Low | 轻微问题，优化建议 | 视情况修复 |

### 优先级检测规则

- `CRITICAL` 关键字 → P0
- `HIGH` 关键字 → P1
- `security:` 或 `security(` 前缀 → P0
- `P0`/`P1`/`P2`/`P3` 标签 → 对应优先级

---

## 2. 必须产物

每个 PR 合并前**必须**存在以下产物：

| 产物 | 位置 | 说明 |
|------|------|------|
| PRD | `.prd.md` | 需求定义 |
| DoD | `.dod.md` | 验收清单（至少 1 个 checkbox） |
| QA Decision | `docs/QA-DECISION.md` | 质量结论（必须有 Decision 字段） |
| Audit Report | `docs/AUDIT-REPORT.md` | 审计记录 |

---

## 3. Gate / Regression 边界定义

### Gate（检查系统）

**定义**: 保护"检查系统不会放错行"的机制。

**范围**:
- Hook 脚本（branch-protect, pr-gate）
- CI 配置
- DevGate 脚本
- Gate 测试

**契约文件**: `contracts/gate-contract.yaml`

### Regression（业务系统）

**定义**: 保护"业务功能不会回归坏掉"的机制。

**范围**:
- 工作流定义（/dev 流程）
- 核心脚本功能
- 用户路径
- API 行为

**契约文件**: `contracts/regression-contract.yaml`

---

## 4. 铁律

1. **Gate 改动必须更新 GCI，禁止进入 RCI**
2. **业务改动必须更新 RCI，禁止进入 GCI**
3. **P0/P1 修复必须更新对应契约**
4. **空 DoD（无 checkbox）不得通过**
5. **空 QA-DECISION（无 Decision 字段）不得通过**

---

## 5. 放行规则

### PR to develop

必须通过：
- [ ] 类型检查（typecheck）
- [ ] 单元测试（test）
- [ ] Shell 语法检查
- [ ] DoD 完成度（所有 checkbox 勾选）
- [ ] QA-DECISION 有效
- [ ] Audit Report 存在

### PR to main

在 PR to develop 基础上，额外要求：
- [ ] Release Check（L3 回归测试）
- [ ] 版本号递增
- [ ] CHANGELOG 更新

---

## 6. RADNA 体系

| 层级 | 名称 | 职责 | 文件 |
|------|------|------|------|
| L0 | Rules | 宪法（本文档） | `docs/policy/ASSURANCE-POLICY.md` |
| L1 | Contracts | 契约（GCI + RCI） | `contracts/*.yaml` |
| L2 | Executors | 执行器 | `scripts/run-*.sh` |
| L3 | Evidence | 证据（QA/Audit） | `artifacts/*.md` |

**禁止新增层级或名词。**

---

## 7. 版本管理

- 本文档变更需要 PR review
- 变更频率应极低（改一次要很慎重）
- 版本号遵循语义化版本（SemVer）
