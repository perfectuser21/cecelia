---
id: three-layer-systems
version: 1.0.0
created: 2026-01-26
updated: 2026-01-26
changelog:
  - 1.0.0: 初始版本 - 三组分层系统完整对照表
---

# 三组分层系统对照表

> **最容易混淆的点 - 一次讲清楚**

---

## 🚨 核心问题

Cecelia Quality Platform 涉及**三组不同的分层概念**，它们各有用途，互不冲突：

1. **测试覆盖度** - Meta / Unit / E2E
2. **问题严重性** - L1 / L2 / L3 / L4（审计）
3. **质检流程** - L1 / L2A / L2B / L3（流程）

**你之所以混淆，是因为它们都用了"层"的概念，但实际上是三个完全独立的维度！**

---

## 📊 三组分层对照表

| 分层系统 | 用途 | 层级 | 定义位置 | 使用场景 |
|---------|------|------|----------|----------|
| **测试覆盖度** | QA 审计 | Meta / Unit / E2E | /qa SKILL.md 模式5 | QA 成熟度审计 |
| **问题严重性** | 代码审计 | L1 阻塞 / L2 功能 / L3 最佳实践 / L4 过度优化 | /audit SKILL.md | 代码审计分层 |
| **质检流程** | PR/Release 检查 | L1 自动测试 / L2A 审计 / L2B 证据 / L3 验收 | /dev 流程 | PR 质检门禁 |

---

## 1️⃣ 测试覆盖度（Meta / Unit / E2E）

### 用途

**QA 成熟度审计** - 用于评估一个仓库的测试体系完整性

### 层级定义

```
Meta Layer（元测试层）
  ├─ regression-contract.yaml（回归契约定义）
  ├─ hooks/（钩子系统）
  ├─ gates/（门禁系统）
  └─ .github/workflows/ci.yml（CI 配置）

Unit Layer（单元测试层）
  ├─ tests/（单元测试）
  ├─ vitest.config.ts
  └─ npm test（测试命令）

E2E Layer（端到端测试层）
  ├─ golden_paths/（Golden Paths 定义）
  ├─ tests/e2e/（E2E 测试脚本）
  └─ 完整链路验证
```

### 使用场景

当 `/qa` Skill 的**模式 5（QA 审计模式）**被触发时：

```
用户：审计 QA 体系

/qa → 模式 5 → 输出：

[QA Audit Report]

RepoType: Engine

Meta Layer:  80% (有 regression-contract, hooks, gates, ci)
Unit Layer:  60% (tests/ 存在，vitest 配置缺失)
E2E Layer:   40% (golden_paths 未定义，E2E 脚本缺失)

Missing:
  - [ ] golden_paths 未定义
  - [ ] E2E 脚本缺失
  - [ ] vitest.config.ts 缺失

Recommendations:
  1. 补充 golden_paths
  2. 添加 E2E 脚本
  3. 配置 vitest
```

### 评分标准

| Layer | 评分标准 | 满分条件 |
|-------|---------|---------|
| **Meta** | 40% | regression-contract + hooks + gates + ci 全部存在 |
| **Unit** | 30% | tests/ 存在 + vitest/jest 配置 + npm test 可执行 |
| **E2E** | 30% | golden_paths 定义 + E2E 脚本存在 + 可执行 |

### 关键点

- ✅ 这是**横向维度**（测试体系的完整性）
- ✅ 不是质量门禁，是审计工具
- ✅ 用于发现测试体系的缺失部分

---

## 2️⃣ 问题严重性（L1 / L2 / L3 / L4 审计）

### 用途

**代码审计分层** - 用于 `/audit` Skill 判定问题严重性和修复优先级

### 层级定义

| Layer | 名称 | 描述 | 完成标准 | 示例 |
|-------|------|------|----------|------|
| **L1** | 阻塞性 | 功能不工作、崩溃、数据丢失 | 必须修 | 代码语法错误、空指针异常、安全漏洞 |
| **L2** | 功能性 | 边界条件、错误处理、edge case | 建议修 | 缺少错误处理、边界条件未考虑 |
| **L3** | 最佳实践 | 代码风格、一致性、可读性 | 可选 | 命名不规范、注释缺失 |
| **L4** | 过度优化 | 理论边界、极端情况、性能微调 | 不修 | 理论上的性能优化、极端边界情况 |

### 使用场景

当 `/audit` Skill 被调用时：

```
用户：/audit --target-level=L2

/audit → 输出：

[Audit Report]

Branch: cp-xxx
Date: 2026-01-26
Target Level: L2

Summary:
  L1: 0  ✅
  L2: 0  ✅
  L3: 3  ⚠️（可选）
  L4: 2  ℹ️（不修）

Decision: PASS

Findings:
  - id: A3-001
    layer: L3
    file: src/utils.ts
    issue: "函数命名不规范"
    fix: "建议改为 camelCase"
    status: pending
```

### 完成标准

- **PR 模式**：L1 + L2 清零（L3/L4 可选）
- **Release 模式**：L1 + L2 + L3 清零（L4 可选）

### 关键点

- ✅ 这是**纵向维度**（问题严重程度）
- ✅ 有明确边界（L2 清零即可合并 PR）
- ✅ 防止无限深挖

---

## 3️⃣ 质检流程（L1 / L2A / L2B / L3 流程）

### 用途

**PR/Release 质检流程** - 用于 `/dev` Skill 和 `pr-gate-v2.sh` 的质检门禁

### 层级定义

| Layer | 名称 | 内容 | 检查工具 | 阻塞 |
|-------|------|------|----------|------|
| **L1** | 自动化测试 | npm run qa | CI | ✅ |
| **L2A** | 代码审计 | /audit Skill | pr-gate-v2.sh | ✅ |
| **L2B** | 证据收集 | 截图/curl 验证 | l2b-check.sh | ✅（Release） |
| **L3** | 验收 | DoD 全勾 | check-dod-mapping.cjs | ✅ |

### 使用场景

#### PR 模式

```
pr-gate-v2.sh → PR 模式检查：

✅ L1: npm run qa 通过
✅ L2A: AUDIT-REPORT.md 存在，L1+L2 清零
❌ L2B: 跳过（PR 不需要）
✅ L3: DoD 全勾，QA-DECISION.md 存在

→ 允许合并 PR
```

#### Release 模式

```
pr-gate-v2.sh → Release 模式检查：

✅ L1: npm run qa 通过
✅ L2A: AUDIT-REPORT.md 存在，L1+L2 清零
✅ L2B: .layer2-evidence.md 存在，截图/命令验证完成
✅ L3: DoD 全勾，QA-DECISION.md 存在

→ 允许合并到 main
```

### 流程图

```
┌─────────────┐
│   用户提交   │
└──────┬──────┘
       │
       ▼
┌─────────────────┐
│ L1: 自动化测试  │ ← npm run qa
└──────┬──────────┘
       │ ✅
       ▼
┌─────────────────┐
│ L2A: 代码审计   │ ← /audit → AUDIT-REPORT.md
└──────┬──────────┘
       │ ✅
       ▼
┌─────────────────┐
│ L2B: 证据收集   │ ← 截图/curl → .layer2-evidence.md
│  (Release only) │
└──────┬──────────┘
       │ ✅
       ▼
┌─────────────────┐
│ L3: 验收        │ ← DoD 全勾 + QA-DECISION.md
└──────┬──────────┘
       │ ✅
       ▼
┌─────────────────┐
│   合并 PR       │
└─────────────────┘
```

### 关键点

- ✅ 这是**流程维度**（质检步骤）
- ✅ 有 PR/Release 两种模式
- ✅ L2B 只在 Release 模式需要

---

## 🎯 三组分层对比总结

### 核心区别

| 维度 | 测试覆盖度 | 问题严重性 | 质检流程 |
|------|-----------|-----------|---------|
| **概念** | Meta/Unit/E2E | L1/L2/L3/L4 | L1/L2A/L2B/L3 |
| **维度** | 横向（测试体系完整性） | 纵向（问题严重程度） | 流程（质检步骤） |
| **工具** | /qa 模式5 | /audit | pr-gate-v2.sh |
| **输出** | QA Audit Report | AUDIT-REPORT.md | 门禁通过/失败 |
| **用途** | 审计 | 审计 | 门禁 |
| **频率** | 按需（QA 审计） | 每个 PR | 每个 PR |

### 何时使用哪个？

| 场景 | 使用哪个分层 | 说明 |
|------|-------------|------|
| **"这个 repo 测试体系完整吗？"** | 测试覆盖度（Meta/Unit/E2E） | /qa 模式5 审计 |
| **"这段代码有什么问题？"** | 问题严重性（L1/L2/L3/L4） | /audit 审计 |
| **"PR 能不能合并？"** | 质检流程（L1/L2A/L2B/L3） | pr-gate-v2.sh 检查 |

---

## 🧩 实际使用示例

### 示例 1：QA 审计

```
用户："审计一下这个仓库的 QA 成熟度"

使用：测试覆盖度（Meta/Unit/E2E）

命令：/qa

输出：
  Meta Layer:  80%
  Unit Layer:  60%
  E2E Layer:   40%

  Missing:
    - golden_paths 未定义
    - E2E 脚本缺失
```

### 示例 2：代码审计

```
用户："审计这段代码"

使用：问题严重性（L1/L2/L3/L4）

命令：/audit --target-level=L2

输出：
  Summary:
    L1: 0 ✅
    L2: 0 ✅
    L3: 3 ⚠️
    L4: 2 ℹ️

  Decision: PASS（L1+L2 清零）
```

### 示例 3：PR 质检

```
用户："检查 PR 能不能合并"

使用：质检流程（L1/L2A/L2B/L3）

命令：bash hooks/pr-gate-v2.sh

输出：
  ✅ L1: npm run qa 通过
  ✅ L2A: AUDIT-REPORT.md 存在
  ❌ L2B: 跳过（PR 模式）
  ✅ L3: DoD 全勾

  → 允许合并
```

---

## 🎓 记忆口诀

**测试覆盖度 = 横向完整性（Meta/Unit/E2E）**
- 问："测试体系完整吗？"
- 答："Meta 80%, Unit 60%, E2E 40%"

**问题严重性 = 纵向严重度（L1/L2/L3/L4）**
- 问："代码问题严重吗？"
- 答："L1 阻塞 0，L2 功能 0，可以合并"

**质检流程 = 流程步骤（L1/L2A/L2B/L3）**
- 问："PR 走到哪一步了？"
- 答："L1 通过，L2A 通过，L3 通过，可以合并"

---

## 📚 相关文档

**核心文档**：
- [质量体系白皮书](./QUALITY-SYSTEM-WHITEPAPER.md) - 四层模型（L1-L4）是指 Syntax/Rules/RCI/GoldenPath
- [QA 稳定契约矩阵](./QA-STABILITY-MATRIX.md) - Engine vs Autopilot vs App 完整对比
- [Feature 归类指南](./FEATURE-CLASSIFICATION-GUIDE.md) - H/W/C/B 分类体系
- [可视化架构图](./QUALITY-LAYERS-VISUAL.md) - 一图胜千言

**Skills 文档**：
- [QA Skill](../skills/qa/SKILL.md) - 测试覆盖度（Meta/Unit/E2E）定义
- [Audit Skill](../skills/audit/SKILL.md) - 问题严重性（L1/L2/L3/L4）定义

**实现文档**：
- [PR Gate Hook](../hooks/pr-gate-v2.sh) - 质检流程（L1/L2A/L2B/L3）实现

---

**Version**: 1.0.0
**Last Updated**: 2026-01-26
