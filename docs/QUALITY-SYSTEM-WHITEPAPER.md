---
id: quality-system-whitepaper
version: 1.0.0
created: 2026-01-26
updated: 2026-01-26
changelog:
  - 1.0.0: 初始版本 - Cecelia 质量体系完整全景图
---

# Cecelia 质量体系白皮书

> **一次讲透版** - 从混淆到清晰的完整指南

---

## 🎯 核心一句话

**整个质量体系只有四层：L1、L2、L3（系统 RCI）+ L4（e2e GoldenPath）**

---

## 🧠 最关键的三个认知

### ① RCI ≠ RepoType

- **RCI** = Stability Contract（稳定性契约）
- **RepoType** = 仓库类型（只有 Engine / Business）

**它们是两个维度的概念，不要混淆！**

### ② Autopilot 需要的是 Flow-RCI（业务级）

- **Engine RCI** = 系统级，能力跨版本不变
- **Autopilot RCI** = 业务能力级，Flow 的输入/输出契约

**不是同一种 RCI！**

### ③ 整个 QA 只有四层（L1-L4）

所有复杂性都可以放回这 4 层。

---

## 📐 四层模型（L1 ~ L4）

### 🔵 L1 – Syntax & Format（基础质量层）

**解决的问题**：
- 代码不能写错
- 文件不能乱格式
- 项目能正常构建

**包括**：
- ESLint
- Prettier
- Typecheck
- Build
- 基础错误（missing file, missing import）

**适用范围**：
- ✅ Engine
- ✅ Autopilot（Business）
- ✅ Console / App
- ✅ n8n flow / any code

**完成标准**：
- 所有文件能通过 `npm run lint`
- 所有文件能通过 `npm run typecheck`
- `npm run build` 成功

---

### 🟢 L2 – Static Rules & Business Logic（静态规则 + 业务契约）

**解决的问题**：
- 业务规则必须满足
- 必须更新 registry
- 必须补写 changelog
- 业务配置不能破坏
- Prompt 结构必须合法（对 Autopilot）

**分为两层**：

#### L2A 静态业务规则（格式/路径/描述/契约）
- 文件路径规范
- 命名规范
- 描述字段完整性
- 业务配置合法性

#### L2B 构建业务路径（Flow 构建、Prompt 模板检测）
- Flow JSON 必须合法
- Prompt Schema 必须合法
- Workflow 必须能编译

**适用范围**：
- ✅ Engine（严格）
- ✅ Autopilot（中等）

**Engine L2（严格）**：
- 文件必须注册到 Features Registry
- 改 Hooks/Skills 必须写 Impact
- 改系统能力必须写 Evidence

**Autopilot L2（中等）**：
- Flow JSON 必须合法
- Prompt Schema 必须合法
- Workflow 必须能编译

**完成标准**：
- 通过 `scripts/devgate/l2a-check.sh`
- 通过 `scripts/devgate/l2b-check.sh`

---

### 🔴 L3 – Regression Contract（RCI：不变性契约）

**这是最容易混淆的层！**

#### RCI 本质

**RCI = 能力"不可破坏"的契约**

#### 谁需要？

| RepoType | RCI 需求 | 级别 | 说明 |
|----------|----------|------|------|
| **Engine** | ✅ 强制 | 系统级 | 提供系统能力 → 必须保证能力跨版本不变 |
| **Autopilot** | ✅ 推荐 | 业务能力级 | 提供业务能力（flow） → 部分能力需要稳定 |
| **App/Console** | ❌ 不需要 | - | 不提供能力 → 无需 RCI |

#### Engine RCI（系统级）

**保证的是系统能力的不变性**：

- Hooks 入参/出参不能变
- Skills 行为不能漂移
- GoldenPath API 不能破坏
- 系统契约必须可持续执行

**示例**：
```yaml
# regression-contract.yaml
contracts:
  - id: H1-001
    name: "分支保护 Hook 触发"
    priority: P0
    trigger: [PR, Release]
    test: tests/hooks/test-branch-protect.sh
```

#### Autopilot RCI（业务能力级）

**保证的是业务能力的稳定性**：

- Flow1 的输入/输出不能被 Flow3 改坏
- 某个 Prompt 模板版本必须可复现
- 内容生成的 JSON contract 必须稳定

**示例**：
```yaml
# autopilot-regression-contract.yaml
contracts:
  - id: F1-001
    name: "ContentSeed Flow 输入输出契约"
    priority: P1
    trigger: [PR]
    test: tests/flows/test-content-seed.sh
```

**关键差异**：

| 维度 | Engine RCI | Autopilot RCI |
|------|------------|---------------|
| **级别** | 系统级 | 业务能力级 |
| **不变性** | 强（跨版本不变） | 中（可以随版本升级） |
| **影响范围** | 所有使用 Engine 的项目 | 当前业务流程 |
| **测试方式** | 系统集成测试 | Flow 单元测试 + E2E |

**完成标准**：
- P0/P1 修改必须更新 RCI（由 `require-rci-update-if-p0p1.sh` 检查）
- 所有 RCI 测试通过

---

### 🟣 L4 – GoldenPath（端到端验证）

**解决的问题**：
- 整个系统是否能完整跑通
- Engine 提供能力 → Autopilot 消费能力 → App 使用能力
- 这是最终 E2E 验证层

#### Engine GoldenPath

**验证的是完整开发流程**：

```
Hooks → Skills → Workflow → Output → PR → CI → Merge
```

**示例**：
```yaml
golden_paths:
  - id: GP-001
    name: "完整开发流程"
    rcis: [H1-001, H2-003, W1-001, C1-001]
    test: tests/e2e/test-full-dev-flow.sh
```

#### Autopilot GoldenPath

**验证的是业务关键路径**：

```
ContentSeed → DeepPost → ShortPost → Publish → Website
```

**示例**：
```yaml
golden_paths:
  - id: GP-A01
    name: "内容生成到发布完整链路"
    rcis: [F1-001, F2-001, F3-001]
    test: tests/e2e/test-content-pipeline.sh
```

#### App GoldenPath

**验证的是用户关键流程**：

```
UI → Backend → Data Flow → Website
```

**完成标准**：
- 所有 GoldenPath 测试通过
- 端到端链路可正常运行

---

## 🏗️ 质量金字塔

```
                    L4 GoldenPath
                    （端到端验证）
                         ▲
                    L3 RCI
                （回归契约）
                         ▲
                L2 Static Rules
            （静态规则 + 业务逻辑）
                         ▲
                 L1 Syntax & Format
                  （基础质量）
```

---

## 🧪 测试大类（Regression / Unit / E2E）

### 固定世界观（不可改）

**测试大类永远只有 3 类**：

1. **Regression** - 回归测试（保证能力不破坏）
2. **Unit** - 单元测试（保证函数/模块正确）
3. **E2E** - 端到端测试（保证链路可跑通）

### ECC 不是第 4 类测试

**ECC（Engine Compatibility Check）** = 业务 repo 升级 Engine 版本时触发的"兼容性检查"

```
ECC = 轻量 Regression + 轻量 E2E
```

**组成**：
- ✅ 运行部分 Regression（核心 RCI）
- ✅ 运行部分 E2E（关键 GoldenPath）
- ✅ 验证 API 契约未破坏

**示例**：

```bash
# Autopilot 升级 Engine v1.0.0 → v1.1.0 时
npm run ecc

# 实际执行：
# 1. Regression（轻量）
bash scripts/rc-filter.sh engine-upgrade

# 2. E2E（轻量）
bash tests/e2e/test-critical-paths.sh

# 3. API Contract Check
bash tests/engine-api-contract.sh
```

### 三大类测试对比

| 测试类型 | 目的 | 覆盖范围 | 频率 | 工具 |
|---------|------|---------|------|------|
| **Regression** | 保证能力不破坏 | RCI 契约 | 每次 PR + Release | regression-contract.yaml |
| **Unit** | 保证函数正确 | 函数/模块 | 每次 PR | vitest / jest |
| **E2E** | 保证链路可跑通 | GoldenPath | Release + Nightly | bash scripts |
| **ECC** | 保证引擎兼容 | 核心 RCI + 关键 GP | Engine 升级时 | ecc-contract.yaml |

### regression-contract.yaml 的地位

**唯一合法定义来源** - 全量回归的权威定义

```yaml
# regression-contract.yaml
contracts:
  - id: H1-001
    name: "分支保护 Hook 触发"
    priority: P0
    trigger: [PR, Release, EngineUpgrade]  # ← ECC 会跑这个
    test: tests/hooks/test-branch-protect.sh

  - id: B1-001
    name: "ContentSeed 输入输出契约"
    priority: P1
    trigger: [PR]  # ← ECC 不跑这个（业务细节）
    test: tests/flows/test-content-seed.sh
```

### FEATURES.md vs regression-contract.yaml

```
FEATURES.md
  ├─ What（能力地图）
  ├─ 人读
  └─ 能力列表

regression-contract.yaml
  ├─ How（如何保证不坏）
  ├─ 机器读
  └─ 测试定义
```

**规则**：
- ❌ 不要把业务 UI 细节塞进 Engine 的回归契约
- ❌ 不要把测试细节塞进 FEATURES.md
- ✅ FEATURES.md 记录能力，regression-contract.yaml 记录测试

---

## 📊 RepoType vs QA Layers 对照表

| 层级 | Engine | Autopilot（Business） | App/Console |
|------|--------|----------------------|-------------|
| **L1** | ✅ 必须 | ✅ 必须 | ✅ 必须 |
| **L2A** | ✅ 强制 | ✅ 中等 | ✅ 基本 |
| **L2B** | ✅ 强制 | ✅ 轻量 | ❌ 无 |
| **L3（RCI）** | ✅ 系统级 | ✅ 业务能力级 | ❌ 不需要 |
| **L4（GoldenPath）** | ✅ 全系统 E2E | ✅ Flow E2E | ✅ 简单 E2E |

---

## 🎯 常见混淆点澄清

### 混淆 1：以为 RCI 是 RepoType

**错误理解**：
- "Engine 才需要 RCI"
- "Business 不需要 RCI"

**正确理解**：
- RCI 是稳定性契约，不是仓库类型
- Engine 需要系统级 RCI
- Autopilot 需要业务能力级 RCI
- 两者都需要 RCI，但级别和目的不同

### 混淆 2：以为有无数层 QA

**错误理解**：
- "不知道到底有几层质量"
- "Gate/RCA/Level/Contract/Evidence 都是不同的层"

**正确理解**：
- 只有 L1-L4 四层
- Gate = L0 规则层
- Contract = L1 契约层（Gate Contract + Regression Contract）
- Executors = L2 执行层
- Evidence = L3 证据层

### 混淆 3：Engine 和 Autopilot 的 QA 需求混淆

**错误理解**：
- "Autopilot 不需要 QA"
- "Autopilot 和 Engine 要求一样"

**正确理解**：
- Autopilot 需要 QA，但层级和要求不同
- Engine：L1-L4 全覆盖，系统级 RCI
- Autopilot：L1-L4 部分覆盖，业务能力级 RCI

---

## 🔧 实施指南

### Engine 仓库质量清单

- [ ] L1：ESLint + Prettier + Typecheck + Build
- [ ] L2A：Features Registry + Impact 分析
- [ ] L2B：Evidence 收集
- [ ] L3：系统级 RCI（Hooks/Skills/Workflow）
- [ ] L4：完整开发流程 GoldenPath

### Autopilot 仓库质量清单

- [ ] L1：ESLint + Prettier + Typecheck + Build
- [ ] L2A：Flow JSON 合法性
- [ ] L2B：Prompt Schema 合法性
- [ ] L3：业务能力级 RCI（Flow 输入/输出契约）
- [ ] L4：内容生成到发布 GoldenPath

### App/Console 仓库质量清单

- [ ] L1：ESLint + Prettier + Typecheck + Build
- [ ] L2A：基本代码规范
- [ ] L4：简单 E2E（用户关键流程）

---

## 📚 相关文档

**核心文档**：
- [三组分层系统对照表](./THREE-LAYER-SYSTEMS.md) - 最容易混淆的点
- [Feature 归类指南](./FEATURE-CLASSIFICATION-GUIDE.md) - H/W/C/B 分类体系
- [可视化架构图](./QUALITY-LAYERS-VISUAL.md) - 一图胜千言
- [QA 稳定契约矩阵](./QA-STABILITY-MATRIX.md) - 对比表大全

**进阶文档**：
- [ARCHITECTURE.md](./ARCHITECTURE.md) - RADNA 4层架构
- [QA-DECISION.md](./QA-DECISION.md) - QA 决策模板
- [skills/qa/SKILL.md](../skills/qa/SKILL.md) - QA Skill 使用指南
- [contracts/gate-contract.template.yaml](../contracts/gate-contract.template.yaml) - Gate Contract 模板
- [contracts/regression-contract.template.yaml](../contracts/regression-contract.template.yaml) - Regression Contract 模板

---

## 🎁 快速参考卡

### RepoType 判定

```bash
# Engine
- 包含 regression-contract.yaml
- 包含 hooks/ 或 skills/
- 提供系统能力

# Business (Autopilot)
- 包含业务逻辑
- 包含 flows/
- 消费系统能力

# App/Console
- 纯 UI 项目
- 不提供能力
```

### RCI 判定

```bash
# Engine RCI（系统级）
- Hooks 行为不能变
- Skills 契约不能破
- 系统 API 不能漂移

# Autopilot RCI（业务能力级）
- Flow 输入/输出不能被改坏
- Prompt 模板版本可复现
- 内容契约必须稳定
```

### 优先级映射

| 审计严重性 | 业务优先级 | RCI 要求 |
|-----------|-----------|---------|
| CRITICAL | P0 | 必须更新 RCI |
| HIGH | P1 | 必须更新 RCI |
| MEDIUM | P2 | 可选 |
| LOW | P3 | 可选 |

---

**Version**: 1.0.0
**Last Updated**: 2026-01-26
**Author**: Cecelia Quality Team
