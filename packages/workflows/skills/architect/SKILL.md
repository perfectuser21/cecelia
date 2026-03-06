---
id: architect-skill
version: 1.0.0
created: 2026-03-06
updated: 2026-03-06
changelog:
  - 1.0.0: 初始版本 - Mode 1 系统说明书 + Mode 2 Initiative 设计
---

# /architect - 系统架构师

**角色**: Architect（架构师） - 既是 CTO（让人看懂系统）也是 Architect（让 AI 有设计再编码）

**模型**: Opus（深度分析需要最强推理能力）

---

## 核心定位

/architect 是 Initiative 级别的架构设计技能。它解决两个问题：

1. **Owner 看不懂系统** - Mode 1 扫描代码，生成人可读的模块说明书
2. **AI 没有设计就编码** - Mode 2 在 /dev 之前产出技术方案，确保全局一致性

```
层级关系:
  /decomp  → 拆出 Initiatives
  /architect → 为 Initiative 做技术设计（本 skill）
  /dev     → 按设计写代码
```

---

## 触发方式

```bash
# Mode 1: 生成/更新系统说明书
/architect scan

# Mode 2: Initiative 技术设计
/architect design <initiative_description>

# 从 Brain 自动派发
/architect --task-id <id>
```

---

## Mode 1: 系统说明书（给 Owner 看）

### 目标

扫描 Brain 代码，为每个模块生成**人看得懂的中文说明书**，写入数据库 `system_modules` 表，Dashboard SuperBrain 页面动态展示。

### 触发时机

- 首次运行：全量扫描所有模块
- /dev PR 合并后：Brain 自动派发增量更新（只扫被改的模块）
- Owner 主动要求：`/architect scan`

### 执行步骤

#### Phase 1: 扫描代码

1. 读取 `packages/brain/src/` 下所有 `.js` 文件
2. 对每个文件，提取：
   - 文件名和路径
   - 导出的函数/类列表
   - 文件头部注释（如果有）
   - import 依赖关系
   - 被哪些文件 import（反向依赖）

3. 使用 subagent 并行扫描（每个 subagent 负责 3-5 个文件）：

```
主 agent:
  → subagent A: 扫描 tick.js, orchestrator-chat.js, server.js
  → subagent B: 扫描 thalamus.js, cortex.js, cognitive-core.js
  → subagent C: 扫描 executor.js, task-router.js, model-registry.js
  → subagent D: 扫描 desire/*.js, emotion-layer.js
  → subagent E: 扫描 learning.js, memory-*.js, self-model.js
  ← 所有 subagent 返回结果
  → 主 agent 整合
```

#### Phase 2: 生成模块卡片

对每个模块生成结构化说明书：

```markdown
## [icon] [模块名称] ([filename])

**通俗解释**: 用一句大白话说这个模块干什么
**类比**: 大脑的"XX"

**职责**:
[2-3 句详细说明，用非技术人员能理解的语言]

**输入**: [什么数据/事件进来]
**输出**: [什么结果出去]

**依赖**: [依赖哪些其他模块]
**被依赖**: [被哪些模块依赖]

**风险点**: [改了这个模块可能影响什么]

**关键数字**:
- 调用频率: [每 tick / 每事件 / 按需]
- 使用的 LLM: [Haiku/Sonnet/Opus/无]

**最后更新**: [从 git log 读取]
**版本**: [从 package.json 读取]
```

#### Phase 3: 写入数据库

将模块卡片写入 `system_modules` 表：

```sql
INSERT INTO system_modules (
  module_id, filename, display_name, icon, chapter,
  analogy, role_description, inputs, outputs,
  dependencies, dependents, risk_notes,
  call_frequency, llm_model, content_hash
) VALUES (...)
ON CONFLICT (module_id) DO UPDATE SET ...;
```

#### Phase 4: 收敛检查

扫描完成后，输出系统全景图 + 收敛性报告：

```markdown
## 系统全景图

[按 chapter 分组列出所有模块]

## 收敛性检查

- 重复功能: [是否有两个模块做类似的事]
- 孤岛模块: [是否有模块没有被任何其他模块依赖]
- 过度耦合: [是否有模块依赖 >5 个其他模块]
- 缺失文档: [是否有模块没有头部注释]
```

### 完成条件

- `system_modules` 表有数据（行数 > 0）
- 创建 `.architect-scan-done` 文件

---

## Mode 2: Initiative 技术设计（给 AI 看）

### 目标

接收 Initiative 描述，产出完整的技术设计文档 `architecture.md` + 拆分后的 Tasks，注册到 Brain。

### 触发时机

- /decomp 拆出 Initiative 后，Brain 自动派发 `task_type='architecture_design'`
- Owner 主动要求：`/architect design "实现 XXX"`

### 执行步骤

#### Phase 1: 理解 Initiative

1. 读取 Initiative 描述（从 Brain task.description 或用户输入）
2. 读取系统说明书（从 `system_modules` 表，Mode 1 的产出）
3. 如果 `system_modules` 表为空 → 先执行 Mode 1 扫描

#### Phase 2: 影响分析

使用 subagent 并行分析：

```
主 agent:
  → subagent A: 分析 Initiative 涉及哪些模块（读代码 + system_modules）
  → subagent B: 检查是否与现有功能重复（收敛性检查）
  → subagent C: 评估技术风险（依赖链、breaking changes）
  ← 汇总结果
```

产出影响分析报告：

```markdown
## 影响分析

### 涉及模块
- [模块A]: [需要怎么改]
- [模块B]: [需要怎么改]

### 收敛性检查
- [是否与现有功能重复？如果是，说明哪个]
- [是否需要先重构再开发？]

### 技术风险
- [风险1]: [影响范围 + 缓解方案]

### 裁决
- GOOD: 可以开始开发
- NEEDS_WORK: 需要先解决 [X] 再开始
- REJECT: 不应该做这个（理由）
```

#### Phase 3: 技术设计

如果裁决为 GOOD 或 NEEDS_WORK（解决后），产出 architecture.md：

```markdown
# Architecture: [Initiative Name]

## 概述
[1-2 段说明整体方案]

## 数据模型变更
[新增/修改的数据库表、字段]

## API 变更
[新增/修改的 API 端点]

## 模块变更
| 模块 | 变更类型 | 说明 |
|------|---------|------|
| [模块A] | 新建/修改/删除 | [具体说明] |

## 关键决策
| 决策 | 选项A | 选项B | 选择 | 理由 |

## 测试策略
[关键测试点]
```

#### Phase 4: 拆分 Tasks

将 architecture.md 拆成可独立执行的 Tasks：

```
Task 1: [标题] -- 依赖: 无
Task 2: [标题] -- 依赖: Task 1
Task 3: [标题] -- 依赖: Task 1
...
```

拆分原则：
- 每个 Task = 1 个 PR
- Task 之间有明确依赖关系
- 每个 Task 有独立的验收标准
- 总 Task 数 3-7 个

#### Phase 5: 注册到 Brain

通过 Brain API 注册所有 Tasks：

```bash
curl -X POST http://localhost:5221/api/brain/tasks \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Task 标题",
    "description": "Task 描述 + architecture.md 引用",
    "priority": "P1",
    "project_id": "<initiative_id>",
    "task_type": "dev",
    "metadata": {
      "architecture_ref": "architecture.md",
      "depends_on": ["task_id_1"]
    }
  }'
```

### 完成条件

- `architecture.md` 文件存在
- 所有 Tasks 已注册到 Brain
- 创建 `.architect-design-done` 文件

---

## Stop Hook 集成

### 模式文件

- Mode 1: 创建 `.architect-lock.scan`
- Mode 2: 创建 `.architect-lock.design`

### 完成条件

| Mode | 检查文件 | 完成标志 |
|------|---------|---------|
| Mode 1 (scan) | `.architect-scan-done` | system_modules 有数据 |
| Mode 2 (design) | `.architect-design-done` | architecture.md + Tasks 注册 |

---

## Brain 注册

| 项 | 值 |
|----|---|
| task_type | `architecture_design` |
| skill_path | `/architect` |
| location | `us` |
| model | Opus |
| agent_id | `architect` |

---

## 与其他 Skill 的关系

### 场景一：主流程（新项目 / 首次）

Mode 1 必须在 /decomp 之前运行——它建立的 system_modules 知识库是 /decomp 有依据拆解的前提。

```
/plan 识别层级（Area OKR / Project / Initiative）
    |
/architect Mode 1 → 扫描代码库，建立 system_modules 知识库
    |
/decomp → 基于 system_modules 拆 OKR → Initiative（有依据的拆解）
    |
/decomp-check → 审查拆解质量
    |
[每个 Initiative 独立执行]
    |
/architect Mode 2 → 读 system_modules，产出 architecture.md + Tasks
    |
/dev Task 1 → PR → merge
/dev Task 2 → PR → merge
/dev Task 3 → PR → merge
    |
Initiative 完成
```

### 场景二：增量更新（PR merge 后自动触发）

每次 /dev PR 合并后，Brain 自动派发增量 Mode 1 扫描被改动的模块：

```
/dev PR → merge
    |
Brain 自动派发 architecture_design 任务（type=scan）
    |
/architect Mode 1（增量）→ 只更新被改动的 system_modules 条目
```

---

## 禁止行为

- 不直接改代码（那是 /dev 的事）
- 不跳过影响分析直接设计
- 不产出没有 Tasks 的 architecture.md
- 不在 Mode 2 中跳过 system_modules 检查
# /architect skill
