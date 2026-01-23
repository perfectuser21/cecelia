---
id: skill-assurance
version: 1.0.0
created: 2026-01-23
updated: 2026-01-23
changelog:
  - 1.0.0: 初始版本
---

# /assurance – 全仓库质量与检查体系统一规范（RADNA 体系）

本 Skill 是 **检查系统（Gate）与业务系统（Regression）** 的唯一协调者。
负责判断 PR 的改动性质、更新对应契约（Contract）、并生成 QA 与 Audit 产物。

---

## 🧩 体系总览（固定 4 层，禁止再加新名词）

### L0 – Rules（规则层 / 宪法）

仓库的根本规则，例如：
- P0/P1 定义
- 必须产物要求（QA-DECISION.md、AUDIT-REPORT.md）
- Gate/Regression 的边界定义

**文件**: `docs/policy/ASSURANCE-POLICY.md`

### L1 – Contracts（契约层 / 要求是什么）

只允许两份契约：

#### 🔒 Gate Contract（GCI）

确保"不发生灾难级误放行"。

**文件**: `contracts/gate-contract.yaml`

#### 📘 Regression Contract（RCI）

确保"业务功能不回归"。

**文件**: `contracts/regression-contract.yaml`

**红线**: GCI 和 RCI 禁止混入，互不交叉。

### L2 – Executors（执行层 / 怎么检查）

- `scripts/run-gate-tests.sh`
- `scripts/run-regression.sh`

### L3 – Evidence（证据层 / 检查后的产物）

- `artifacts/QA-DECISION.md`
- `artifacts/AUDIT-REPORT.md`

---

## 🧭 /assurance Skill 的职责（固定 4 条）

### 1. 判断 PR 改动属于 Gate 还是 Business

根据 PR 的文件 diff 进行分类：

#### 属于 Gate（安全边界）

以下路径/文件任意变化都归为 Gate：

```
hooks/*
scripts/run-gate-tests.sh
scripts/devgate/*
.github/workflows/ci.yml
tests/gate/*
contracts/gate-contract.yaml
```

#### 属于 Business

以下路径变化归为 Business：

```
src/**
skills/dev/**
skills/qa/**
skills/audit/**
templates/**
contracts/regression-contract.yaml
```

#### 属于 Both（混合）

如果 Gate + Business 都变 → 两个 Contract 都要更新。

---

### 2. 更新对应 Contract（GCI / RCI）

**如果是 Gate 改动**:
- 运行 `node scripts/devgate/draft-gci.cjs --output artifacts/gci-draft.yaml`
- 审核草稿，确认后合并到 `contracts/gate-contract.yaml`
- 标识格式：`G1-xxx`, `G2-xxx`, ...

**如果是业务改动**:
- 在 `contracts/regression-contract.yaml` 中新增或更新一个契约条目
- 标识格式：`C1-xxx`, `C2-xxx`, ...

**自动化工具** (v9.1+):
- `scripts/devgate/draft-gci.cjs` - 自动生成 GCI 草稿
- 用法: `node scripts/devgate/draft-gci.cjs [--base <branch>] [--output <file>]`
- 输出: YAML 格式的契约草稿

**禁止行为**（/assurance 自动阻止）:
- Gate 改动不能写 RCI
- Business 改动不能写 GCI

---

### 3. 生成 QA-DECISION.md

模板：

```markdown
# QA Decision

## 本次变更类型
- Gate / Regression / Both

## 风险等级
- High / Medium / Low

## 本次验证的契约条目
- Gate: [G3-001, G3-004]
- Regression: [C1-002]

## 结论
PASS / FAIL

## 说明
（按实际内容生成）
```

---

### 4. 生成 AUDIT-REPORT.md

模板：

```markdown
# Audit Report

## 变更范围
- File changes:
  - hooks/pr-gate-v2.sh
  - src/index.ts
  ...

## Contract 更新情况
- Gate Contract: 更新 G5-002（npm 白名单）
- Regression Contract: 无

## Known Issues 检查
- B 级问题：保持不变
- C 级优化：跳过

## Gate Tests 结果
（从 scripts/run-gate-tests.sh 读取）

## Regression Tests 结果
（从 scripts/run-regression.sh 读取）

## 合规性结论
合规 / 需整改
```

---

## 🔍 /assurance Skill 的输入 → 输出

**输入**:
- PR diff + PR 描述 + 文件结构

**输出**:
- 正确分类（Gate / Regression / Both）
- 更新后的 GCI / RCI
- QA-DECISION.md
- AUDIT-REPORT.md

---

## 🧱 关键边界（写死，不允许变动）

### Gate Contract（GCI）职责

确保"不放错、不误删、不跳过、不误判"。

GCI 覆盖 6 大红线：
1. 空 DoD 不得通过
2. 空 QA-DECISION 不得通过
3. P0/P1 识别必须准确
4. PR to main 必须走 release-check
5. 白名单不可穿透（npm scripts）
6. cleanup.sh 不可删除未 checkout 的分支

**GCI 永远保持少量（<20）红线条目。**

---

### Regression Contract（RCI）职责

保持业务能力的"可回归性"。

RCI 覆盖：
- 工作流定义（/dev 流程）
- 核心脚本功能
- API 行为
- 用户行为路径
- 重要体验流

**RCI 可增长，但要结构化（C1/C2/C3/...）。**

---

## 🚫 反模式（/assurance 自动阻止）

1. Gate 条目写进 RCI
2. 新建 Contract3、Contract4（禁止）
3. 增加 Meta 层名词（禁止）
4. QA/Audit 当 Contract（禁止）
5. Gate Test Suite 回归污染 RCI（禁止）

---

## 🎯 /assurance 的终极目标

**终结死循环**：任何改动只需要更新对应契约；不会出现"写了一堆最后没改 RCI 白写"的情况。

```
Gate → 改 GCI
业务 → 改 RCI
两个一起 → 两个都改
绝不交叉
```

**QA 与 Audit 永远自动生成，不由人手写。**

---

## 📁 目录结构

```
zenithjoy-engine/
├── docs/policy/
│   └── ASSURANCE-POLICY.md      # L0 Rules
├── contracts/
│   ├── gate-contract.yaml       # L1 GCI
│   └── regression-contract.yaml # L1 RCI
├── scripts/
│   ├── run-gate-tests.sh        # L2 Executor
│   ├── run-regression.sh        # L2 Executor
│   └── devgate/
│       └── draft-gci.cjs        # GCI 草稿自动生成 (v9.1)
├── artifacts/                   # L3 Evidence
│   ├── QA-DECISION.md
│   ├── AUDIT-REPORT.md
│   └── gci-draft.yaml           # GCI 草稿（临时）
└── skills/
    └── assurance/SKILL.md       # 本文件
```
