---
id: qa-stability-matrix
version: 1.0.0
created: 2026-01-26
updated: 2026-01-26
changelog:
  - 1.0.0: 初始版本 - Engine vs Autopilot QA 稳定契约矩阵
---

# QA 稳定契约矩阵

> Engine vs Autopilot (Business) 质量要求完整对比

---

## 总览矩阵

| 维度 | Engine | Autopilot (Business) | App/Console |
|------|--------|---------------------|-------------|
| **RepoType** | Engine | Business | App |
| **核心职责** | 提供系统能力 | 提供业务能力 | 消费能力 |
| **RCI 级别** | 系统级 | 业务能力级 | 无 |
| **L1 要求** | ✅ 强制 | ✅ 强制 | ✅ 强制 |
| **L2A 要求** | ✅ 严格 | ✅ 中等 | ✅ 基本 |
| **L2B 要求** | ✅ 强制 | ✅ 轻量 | ❌ 不需要 |
| **L3 RCI** | ✅ 系统级 | ✅ 业务能力级 | ❌ 不需要 |
| **L4 GoldenPath** | ✅ 全系统 E2E | ✅ Flow E2E | ✅ 简单 E2E |

---

## L1 - Syntax & Format（所有 Repo 必须）

### Engine

| 检查项 | 要求 | 工具 | 完成标准 |
|--------|------|------|----------|
| ESLint | ✅ 强制 | `npm run lint` | 0 errors |
| Prettier | ✅ 强制 | `npm run format:check` | 格式正确 |
| TypeScript | ✅ 强制 | `npm run typecheck` | 0 errors |
| Build | ✅ 强制 | `npm run build` | Build success |
| Import | ✅ 强制 | TypeScript | 无 missing imports |

### Autopilot (Business)

| 检查项 | 要求 | 工具 | 完成标准 |
|--------|------|------|----------|
| ESLint | ✅ 强制 | `npm run lint` | 0 errors |
| Prettier | ✅ 强制 | `npm run format:check` | 格式正确 |
| TypeScript | ✅ 强制 | `npm run typecheck` | 0 errors |
| Build | ✅ 强制 | `npm run build` | Build success |
| Import | ✅ 强制 | TypeScript | 无 missing imports |

### App/Console

| 检查项 | 要求 | 工具 | 完成标准 |
|--------|------|------|----------|
| ESLint | ✅ 强制 | `npm run lint` | 0 errors |
| Prettier | ✅ 强制 | `npm run format:check` | 格式正确 |
| TypeScript | ✅ 强制 | `npm run typecheck` | 0 errors |
| Build | ✅ 强制 | `npm run build` | Build success |

**结论**：L1 要求所有 Repo 完全一致。

---

## L2A - Static Rules（静态业务规则）

### Engine（严格）

| 检查项 | 要求 | 工具 | 完成标准 |
|--------|------|------|----------|
| Features Registry | ✅ 强制 | `l2a-check.sh` | 新功能必须注册 |
| Impact 分析 | ✅ 强制 | `impact-check.sh` | Hooks/Skills 改动必须写 Impact |
| 文件路径规范 | ✅ 强制 | `l2a-check.sh` | 符合 skills/hooks/scripts 结构 |
| 命名规范 | ✅ 强制 | `l2a-check.sh` | kebab-case / camelCase 一致 |
| Changelog | ✅ 强制 | `l2a-check.sh` | 必须更新 CHANGELOG.md |

### Autopilot (Business)（中等）

| 检查项 | 要求 | 工具 | 完成标准 |
|--------|------|------|----------|
| Flow JSON 合法 | ✅ 强制 | `l2a-check.sh` | JSON Schema 验证通过 |
| Prompt Schema | ✅ 强制 | `l2a-check.sh` | Schema 定义合法 |
| 文件路径规范 | ✅ 推荐 | `l2a-check.sh` | flows/ 目录结构清晰 |
| 命名规范 | ✅ 推荐 | `l2a-check.sh` | 一致性 |
| Changelog | ✅ 推荐 | 手动 | 建议更新 |

### App/Console（基本）

| 检查项 | 要求 | 工具 | 完成标准 |
|--------|------|------|----------|
| 文件路径规范 | ✅ 基本 | ESLint | src/ 目录结构合理 |
| 命名规范 | ✅ 基本 | ESLint | 一致性 |

**结论**：Engine 最严格，Autopilot 中等，App 基本。

---

## L2B - Build Business Path（构建业务路径）

### Engine（强制）

| 检查项 | 要求 | 工具 | 完成标准 |
|--------|------|------|----------|
| Hooks 可执行 | ✅ 强制 | `l2b-check.sh` | chmod +x, shebang 正确 |
| Skills 格式 | ✅ 强制 | `l2b-check.sh` | YAML frontmatter 合法 |
| Scripts 可执行 | ✅ 强制 | `l2b-check.sh` | 所有 scripts/ 可执行 |
| Contract 合法 | ✅ 强制 | `l2b-check.sh` | YAML 格式正确 |

### Autopilot (Business)（轻量）

| 检查项 | 要求 | 工具 | 完成标准 |
|--------|------|------|----------|
| Flow 可编译 | ✅ 强制 | `l2b-check.sh` | JSON 可解析 |
| Prompt 可渲染 | ✅ 强制 | `l2b-check.sh` | 模板语法正确 |
| Workflow 可执行 | ✅ 推荐 | 手动 | n8n 可导入 |

### App/Console（无）

| 检查项 | 要求 | 工具 | 完成标准 |
|--------|------|------|----------|
| - | ❌ 不需要 | - | - |

**结论**：Engine 强制，Autopilot 轻量，App 不需要。

---

## L3 - RCI（回归契约）

### Engine RCI（系统级）

**目的**：保证系统能力跨版本不变

| RCI 分类 | ID 前缀 | 说明 | 示例 |
|---------|---------|------|------|
| **Hooks** | H1-xxx | 钩子系统行为 | H1-001: branch-protect 触发 |
| **Workflow** | W1-xxx | 开发工作流 | W1-001: /dev Skill 完整流程 |
| **Core** | C1-xxx | 核心功能 | C1-001: PR Gate 双模式 |

**特点**：
- ✅ 强不变性（跨版本不变）
- ✅ 系统集成测试
- ✅ P0/P1 必须更新 RCI
- ✅ 影响所有使用 Engine 的项目

**Contract 示例**：
```yaml
contracts:
  - id: H1-001
    name: "分支保护 Hook 触发"
    priority: P0
    trigger: [PR, Release]
    test: tests/hooks/test-branch-protect.sh
```

### Autopilot RCI（业务能力级）

**目的**：保证业务能力的稳定性

| RCI 分类 | ID 前缀 | 说明 | 示例 |
|---------|---------|------|------|
| **Flow** | F1-xxx | 内容生成流程 | F1-001: ContentSeed 输入/输出契约 |
| **Prompt** | F2-xxx | Prompt 模板 | F2-001: DeepPost 模板可复现 |
| **Publish** | F3-xxx | 发布链路 | F3-001: Publish 内容契约 |

**特点**：
- ✅ 中不变性（可随版本升级）
- ✅ Flow 单元测试 + E2E
- ✅ P0/P1 建议更新 RCI
- ✅ 影响当前业务流程

**Contract 示例**：
```yaml
contracts:
  - id: F1-001
    name: "ContentSeed Flow 输入输出契约"
    priority: P1
    trigger: [PR]
    test: tests/flows/test-content-seed.sh
```

### App/Console RCI（无）

| RCI 分类 | 要求 | 说明 |
|---------|------|------|
| - | ❌ 不需要 | App 不提供能力，无需 RCI |

**结论**：Engine 系统级，Autopilot 业务能力级，App 不需要。

---

## L4 - GoldenPath（端到端验证）

### Engine GoldenPath（全系统 E2E）

**验证的是完整开发流程**：

```
Hooks → Skills → Workflow → PR → CI → Merge
```

**GoldenPath 示例**：
```yaml
golden_paths:
  - id: GP-001
    name: "完整开发流程"
    rcis: [H1-001, H2-003, W1-001, C1-001, C2-001]
    test: tests/e2e/test-full-dev-flow.sh
```

**覆盖的链路**：
- ✅ branch-protect → 检查分支
- ✅ PRD/DoD → 编写文档
- ✅ Code → 写代码
- ✅ pr-gate-v2 → 质检
- ✅ CI → 运行测试
- ✅ Merge → 合并 PR

### Autopilot GoldenPath（Flow E2E）

**验证的是业务关键路径**：

```
ContentSeed → DeepPost → ShortPost → Publish → Website
```

**GoldenPath 示例**：
```yaml
golden_paths:
  - id: GP-A01
    name: "内容生成到发布完整链路"
    rcis: [F1-001, F2-001, F3-001]
    test: tests/e2e/test-content-pipeline.sh
```

**覆盖的链路**：
- ✅ ContentSeed → 生成内容种子
- ✅ DeepPost → 生成深度文章
- ✅ ShortPost → 生成短文
- ✅ Publish → 发布到 Notion
- ✅ Website → 显示在网站

### App/Console GoldenPath（简单 E2E）

**验证的是用户关键流程**：

```
UI → Backend → Display
```

**示例**：
```bash
# 手动测试或简单自动化
npm run e2e
```

**覆盖的链路**：
- ✅ 登录
- ✅ 操作（CRUD）
- ✅ 显示结果

**结论**：Engine 全系统 E2E，Autopilot Flow E2E，App 简单 E2E。

---

## 优先级映射对比

### Engine 优先级映射

| 审计严重性 | 业务优先级 | RCI 要求 | 说明 |
|-----------|-----------|---------|------|
| **CRITICAL** | **P0** | ✅ 必须更新 | 系统能力破坏 |
| **HIGH** | **P1** | ✅ 必须更新 | 重要功能破坏 |
| MEDIUM | P2 | ⚠️ 可选 | 一般功能 |
| LOW | P3 | ❌ 不需要 | 边缘情况 |

**特殊规则**：
- `security:` 开头 → P0
- Hooks/Skills 改动 → 至少 P1

### Autopilot 优先级映射

| 审计严重性 | 业务优先级 | RCI 要求 | 说明 |
|-----------|-----------|---------|------|
| **CRITICAL** | **P0** | ✅ 必须更新 | 业务能力破坏 |
| **HIGH** | **P1** | ⚠️ 建议更新 | 重要 Flow 破坏 |
| MEDIUM | P2 | ❌ 不需要 | 一般功能 |
| LOW | P3 | ❌ 不需要 | 边缘情况 |

**特殊规则**：
- Flow 输入/输出改动 → 至少 P1
- Prompt 模板改动 → P2

---

## 产物要求对比

### PR 模式

| 产物 | Engine | Autopilot | App |
|------|--------|----------|-----|
| **PRD.md** | ✅ 必须 | ✅ 必须 | ❌ 不需要 |
| **DOD.md** | ✅ 必须 | ✅ 必须 | ❌ 不需要 |
| **QA-DECISION.md** | ✅ 必须 | ✅ 必须 | ❌ 不需要 |
| **AUDIT-REPORT.md** | ✅ 必须 | ✅ 必须 | ❌ 不需要 |
| **.layer2-evidence.md** | ❌ 不需要 | ❌ 不需要 | ❌ 不需要 |

### Release 模式

| 产物 | Engine | Autopilot | App |
|------|--------|----------|-----|
| **PRD.md** | ✅ 必须 | ✅ 必须 | ❌ 不需要 |
| **DOD.md** | ✅ 必须 | ✅ 必须 | ❌ 不需要 |
| **QA-DECISION.md** | ✅ 必须 | ✅ 必须 | ❌ 不需要 |
| **AUDIT-REPORT.md** | ✅ 必须 | ✅ 必须 | ❌ 不需要 |
| **.layer2-evidence.md** | ✅ 必须 | ✅ 必须 | ❌ 不需要 |

---

## 门控检查对比

### Engine 门控

| 检查 | 工具 | 阻塞 | 说明 |
|------|------|------|------|
| 分支保护 | branch-protect.sh | ✅ | 必须在 cp-*/feature/* |
| PRD/DoD 存在 | branch-protect.sh | ✅ | 必须存在且有效 |
| DoD 映射 | check-dod-mapping.cjs | ✅ | DoD ↔ 测试映射 |
| RCI 更新（P0/P1） | require-rci-update-if-p0p1.sh | ✅ | P0/P1 必须更新 RCI |
| RCI 覆盖度 | scan-rci-coverage.cjs | ⚠️ | 警告 |
| L2A 检查 | l2a-check.sh | ✅ | 静态规则 |
| L2B 检查 | l2b-check.sh | ✅ | 构建路径 |
| QA Decision | pr-gate-v2.sh | ✅ | 必须存在 |
| Audit Report | pr-gate-v2.sh | ✅ | L1+L2 清零 |
| L2B Evidence | pr-gate-v2.sh (release) | ✅ | Release 必须 |

### Autopilot 门控

| 检查 | 工具 | 阻塞 | 说明 |
|------|------|------|------|
| 分支保护 | branch-protect.sh | ✅ | 必须在 cp-*/feature/* |
| PRD/DoD 存在 | branch-protect.sh | ✅ | 必须存在且有效 |
| DoD 映射 | check-dod-mapping.cjs | ✅ | DoD ↔ 测试映射 |
| RCI 更新（P0/P1） | require-rci-update-if-p0p1.sh | ⚠️ | P0 必须，P1 建议 |
| Flow JSON 合法 | l2a-check.sh | ✅ | JSON Schema |
| Prompt Schema | l2a-check.sh | ✅ | Schema 合法 |
| QA Decision | pr-gate-v2.sh | ✅ | 必须存在 |
| Audit Report | pr-gate-v2.sh | ✅ | L1+L2 清零 |
| L2B Evidence | pr-gate-v2.sh (release) | ✅ | Release 必须 |

### App 门控

| 检查 | 工具 | 阻塞 | 说明 |
|------|------|------|------|
| Build | CI | ✅ | Build success |
| Type Check | CI | ✅ | 0 errors |
| Tests | CI | ✅ | All pass |

---

## 测试策略对比

### Engine 测试策略

| 测试类型 | 覆盖范围 | 工具 | 频率 |
|---------|---------|------|------|
| **Unit** | 函数/模块 | vitest | 每次 PR |
| **Regression** | RCI 契约 | bash scripts | 每次 PR + Release |
| **E2E** | GoldenPath | bash scripts | Release + Nightly |
| **Manual** | UI/UX | 手动 | Release |

### Autopilot 测试策略

| 测试类型 | 覆盖范围 | 工具 | 频率 |
|---------|---------|------|------|
| **Unit** | Flow 单元 | vitest | 每次 PR |
| **Regression** | Flow RCI | bash scripts | 每次 PR |
| **E2E** | 内容生成链路 | bash scripts | Release |
| **Manual** | 内容质量 | 人工审核 | Release |

### App 测试策略

| 测试类型 | 覆盖范围 | 工具 | 频率 |
|---------|---------|------|------|
| **Unit** | 组件 | vitest | 每次 PR |
| **E2E** | 用户流程 | playwright | Release |

---

## 完整对比总结表

| 维度 | Engine | Autopilot | App |
|------|--------|----------|-----|
| **定位** | 系统能力提供者 | 业务能力提供者 | 能力消费者 |
| **RCI 性质** | 系统级（强不变） | 业务能力级（中不变） | 无 |
| **L1 要求** | 严格 | 严格 | 严格 |
| **L2A 要求** | 严格（Registry+Impact） | 中等（JSON+Schema） | 基本 |
| **L2B 要求** | 强制（可执行+合法） | 轻量（可编译） | 无 |
| **L3 RCI** | 强制（P0/P1） | 建议（P0 强制） | 无 |
| **L4 GP** | 全系统 E2E | Flow E2E | 简单 E2E |
| **门控严格度** | 最高 | 中等 | 基本 |
| **产物要求** | 全部 | 全部 | 无 |
| **影响范围** | 所有使用 Engine 的项目 | 当前业务 | 用户 |

---

## 🎯 5 种 QA 模式详解（/qa Skill）

### 模式自动识别

`/qa` Skill 根据用户意图自动进入对应子流程：

| 用户意图 | 模式 | 输入 | 输出 |
|---------|------|------|------|
| "这次要跑什么测试？" | 测试计划模式 | RepoType + Stage | 测试命令清单 |
| "要不要加到 Golden Path？" | Golden Path 判定模式 | 功能描述 | Decision + GP 建议 |
| "要不要进全量/RCI？" | RCI 判定模式 | 功能描述 | Decision + RCI 建议 |
| "这个算新 Feature 吗？" | Feature 归类模式 | 功能描述 | Decision + Feature ID |
| "审计 QA 成熟度" | QA 审计模式 | 仓库路径 | Meta/Unit/E2E 完成度 |

---

### 模式 1：测试计划模式

**触发词**："这次要跑什么测试"、"CI 怎么跑"、"PR 要跑啥"

**流程**：
1. 判断 RepoType（Engine / Business）
2. 判断 Stage（Local / PR / Release / Nightly / EngineUpgrade）
3. 读取 `knowledge/testing-matrix.md`
4. 输出测试计划 + 命令

**输出示例**：

```
RepoType: Engine
Stage: PR

Required Tests:
  Regression:
    - H1-001: 分支保护 Hook 触发
    - W1-001: /dev Skill 完整流程
    - C1-001: DoD 映射检查

  Unit:
    - npm run test

  E2E:
    - 跳过（PR 阶段不需要）

Commands:
  npm run qa
  bash scripts/rc-filter.sh pr
```

---

### 模式 2：Golden Path 判定模式

**触发词**："要不要加到 Golden Path"、"这是不是 GP"、"E2E 链路"

**判定标准**：
- ✅ End-to-end（完整链路）
- ✅ Critical（关键路径）
- ✅ Representative（代表性）

**输出示例**：

```
Decision: MUST_ADD_GP

Reason: 这是完整的内容生成到发布链路，是关键业务路径

Next Actions:
  - 在 regression-contract.yaml 新增 golden_paths 条目
  - GP ID 建议: GP-A01
  - rcis: [B1-001, B1-002, B2-001]
  - test: tests/e2e/test-content-pipeline.sh
```

**Decision 值**：
- `NO_GP` - 不是 Golden Path（如单个功能测试）
- `MUST_ADD_GP` - 必须新增 GP（完整关键链路）
- `MERGE_GP` - 合并到现有 GP（现有 GP 的扩展）

---

### 模式 3：RCI 判定模式

**触发词**："要不要进全量"、"这个要加 RCI 吗"、"回归契约"

**判定标准**：
- ✅ Must-never-break（必须永不破坏）
- ✅ Verifiable（可验证）
- ✅ Stable Surface（稳定接口）

**Engine RCI 判定示例**：

```
Decision: MUST_ADD_RCI

Reason: 修改了 Hook 入参，影响所有使用者，必须保证不变性

Next Actions:
  - 在 regression-contract.yaml 新增 RCI
  - ID 建议: H1-003
  - Priority: P0（系统级）
  - Trigger: [PR, Release]
  - Test: tests/hooks/test-new-hook.sh
```

**Autopilot RCI 判定示例**：

```
Decision: MUST_ADD_RCI

Reason: 修改了 ContentSeed 的输出格式，影响下游 Flow

Next Actions:
  - 在 autopilot-regression-contract.yaml 新增 RCI
  - ID 建议: B1-003
  - Priority: P1（业务能力级）
  - Trigger: [PR]
  - Test: tests/flows/test-content-seed-output.sh
```

**Decision 值**：
- `NO_RCI` - 无需纳入回归契约（如 UI 样式调整）
- `MUST_ADD_RCI` - 必须新增 RCI（新增关键能力）
- `UPDATE_RCI` - 需要更新现有 RCI（修改现有能力）

---

### 模式 4：Feature 归类模式

**触发词**："这个算新 Feature 吗"、"Feature 怎么编号"、"更新 FEATURES.md"

**流程**：
1. 读取 `FEATURES.md` 的更新规则
2. 判断是新 Feature 还是现有 Feature 的扩展
3. 判断属于哪个分类（H/W/C/B）
4. 建议 ID 和状态

**输出示例**：

```
Decision: NEW_FEATURE

Category: H (Hooks)
Suggested ID: H1-003
Status: Experiment

Reason: 这是一个新的 Hook，属于 Core Hooks 分类

Next Actions:
  1. 更新 FEATURES.md：
     - **H1-003**: 自动提交
       - Status: Experiment
       - Description: 代码审计通过后自动提交
       - Since: v1.3.0

  2. 稳定后更新状态为 Committed 并添加 RCI
```

**Decision 值**：
- `NOT_FEATURE` - 不是 Feature（如 bug fix）
- `NEW_FEATURE` - 新 Feature（全新能力）
- `EXTEND_FEATURE` - 现有 Feature 扩展（增强现有能力）

**分类规则**：
- **H (Hooks)** - 钩子系统
- **W (Workflow)** - 开发工作流
- **C (Core)** - 核心功能
- **B (Business)** - 业务逻辑

---

### 模式 5：QA 审计模式

**触发词**："审计 QA"、"QA 成熟度"、"检查测试体系"

**流程**：
1. 扫描仓库结构
2. 检查 Meta/Unit/E2E 三层完成度
3. 输出报告 + 改进建议

**输出示例**：

```
[QA Audit Report]

RepoType: Engine

Meta Layer:  80%
  ✅ regression-contract.yaml 存在
  ✅ hooks/ 目录存在
  ✅ .github/workflows/ci.yml 存在
  ⚠️  golden_paths 定义缺失

Unit Layer:  60%
  ✅ tests/ 目录存在
  ⚠️  vitest.config.ts 缺失
  ✅ npm test 可执行

E2E Layer:   40%
  ❌ golden_paths 未定义
  ❌ tests/e2e/ 目录缺失
  ❌ E2E 脚本缺失

Missing:
  - [ ] golden_paths 未定义
  - [ ] E2E 脚本缺失
  - [ ] vitest.config.ts 缺失

Recommendations:
  1. 在 regression-contract.yaml 补充 golden_paths
  2. 创建 tests/e2e/ 目录并添加 E2E 脚本
  3. 配置 vitest.config.ts
```

**评分标准**：

| Layer | 权重 | 检查项 |
|-------|------|--------|
| **Meta** | 40% | regression-contract + hooks + gates + ci |
| **Unit** | 30% | tests/ + config + npm test |
| **E2E** | 30% | golden_paths + e2e/ + scripts |

---

### 5 种模式对比总结

| 模式 | 输入 | 输出 | 频率 | 工具 |
|------|------|------|------|------|
| **1. 测试计划** | RepoType + Stage | 测试命令清单 | 每次 PR/Release | testing-matrix.md |
| **2. Golden Path 判定** | 功能描述 | Decision + GP 建议 | 新增完整链路时 | criteria.md |
| **3. RCI 判定** | 功能描述 | Decision + RCI 建议 | 修改关键能力时 | criteria.md |
| **4. Feature 归类** | 功能描述 | Decision + Feature ID | 新增功能时 | FEATURES.md |
| **5. QA 审计** | 仓库路径 | Meta/Unit/E2E 报告 | 按需（季度/里程碑） | 仓库扫描 |

---

## 使用建议

### 何时选择 Engine Profile

✅ 适用场景：
- 提供系统能力（Hooks/Skills/Workflow）
- 影响多个项目
- 需要强不变性保证

❌ 不适用：
- 纯业务逻辑
- UI 项目

### 何时选择 Autopilot Profile

✅ 适用场景：
- 业务流程（Flow/Prompt）
- 内容生成
- 需要业务能力稳定性

❌ 不适用：
- 系统能力提供
- 纯 UI 项目

### 何时选择 App Profile

✅ 适用场景：
- 纯 UI 项目
- 不提供能力
- 快速迭代

❌ 不适用：
- 提供能力的项目
- 需要 RCI 保证的项目

---

## 相关文档

**核心文档**：
- [质量体系白皮书](./QUALITY-SYSTEM-WHITEPAPER.md) - 一次讲透版
- [三组分层系统对照表](./THREE-LAYER-SYSTEMS.md) - 最容易混淆的点
- [Feature 归类指南](./FEATURE-CLASSIFICATION-GUIDE.md) - H/W/C/B 分类体系
- [可视化架构图](./QUALITY-LAYERS-VISUAL.md) - 一图胜千言

**进阶文档**：
- [ARCHITECTURE.md](./ARCHITECTURE.md) - RADNA 4层架构
- [skills/qa/SKILL.md](../skills/qa/SKILL.md) - QA Skill 详细说明
- [skills/audit/SKILL.md](../skills/audit/SKILL.md) - Audit Skill 详细说明

---

**Version**: 1.0.0
**Last Updated**: 2026-01-26
