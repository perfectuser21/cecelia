---
id: capability-task-matching-analysis
version: 2.0.0
created: 2026-02-18
updated: 2026-02-18
changelog:
  - 2.0.0: 基于最新代码重写，聚焦优化机会和实现方案
  - 1.0.0: 初始版本
---

# 能力-任务匹配分析报告

## 当前机制分析

### 1. `getSkillForTaskType(taskType)` — executor.js:656

**逻辑**：纯静态映射，task_type → skill 命令

```
'dev'         → '/dev'
'review'      → '/review'
'qa_init'     → '/review init'
'exploratory' → '/exploratory'
'talk'        → '/talk'
'research'    → null
'qa'/'audit'  → '/review'（兼容旧类型）
默认           → '/dev'
```

**局限性**：
- 只看 `task_type` 字段，完全忽略任务内容
- 所有 dev 任务都用 `/dev`，无论是"改一行注释"还是"重构整个模块"
- `skill_override`（payload 字段）已存在可覆盖此映射，但从未被自动设置过

---

### 2. `getModelForTask(task)` — executor.js:679

**逻辑**：永远返回 `null`（使用 cecelia-run 默认模型 Sonnet）

```js
function getModelForTask(task) {
  // 成本优化：全部使用 Sonnet
  return null;
}
```

**局限性**：
- 2026-02-16 成本优化后，彻底放弃模型差异化
- exploratory 任务（研究/调研）理论上 Opus 更合适，但被强制降为 Sonnet
- dev 任务（复杂重构）同样 Opus 更合适，但无法动态判断

---

### 3. `getPermissionModeForTaskType(taskType)` — executor.js:690

**逻辑**：静态映射，task_type → 权限模式

```
'dev'         → 'bypassPermissions'
'review'      → 'plan'（唯一只读模式）
'exploratory' → 'bypassPermissions'
'talk'        → 'bypassPermissions'
'research'    → 'bypassPermissions'
默认           → 'bypassPermissions'
```

**局限性**：
- 权限与任务风险不匹配：research 任务（完全只读意图）却给了完全权限
- 无法基于 prd_content 检测到"不应该写代码"的 dev 任务

---

### 4. `preparePrompt(task)` — executor.js:711

**逻辑**：分支判断生成 prompt，有 skill_override 时优先使用

```
if skill_override    → 使用 skill_override 值
if decomposition     → /okr prompt（OKR 拆解流程）
if talk              → 文档写作 prompt
if review/qa/audit   → /review prompt
if research          → 只读调研 prompt
if prd_content       → skill + prd_content
else                 → skill + 自动生成 PRD
```

**局限性**：
- 自动生成的 PRD 极其简陋（只有 3 行模板），无法给 agent 足够上下文
- `skill_override` 只能由创建者手动设置（没有自动推断）

---

### 5. `getTaskLocation(taskType)` — task-router.js:93

**逻辑**：静态映射，task_type → 执行位置

```
us: dev, review, qa, audit, exploratory
hk: talk, research, data
```

**局限性**：
- 与 skill 映射一样只看 task_type，不看内容
- `identifyWorkType()` 函数（基于关键词匹配 title）实际并未用于路由决策

---

### 6. `identifyWorkType(input)` — task-router.js:63

**逻辑**：基于正则模式匹配任务标题，判断是"单任务"还是"功能"

**关键词模式（已实现但未接入匹配链路）**：
```js
SINGLE_TASK_PATTERNS: /修复/, /fix/, /更新/, /bugfix/, /patch/...
FEATURE_PATTERNS: /实现/, /系统/, /架构/, /重构/, /implement/...
```

**局限性**：
- 此函数的分析结果（single/feature/ask_autumnrice）只影响 `determineExecutionMode()`
- 最终 `determineExecutionMode()` 返回值统一为 `'single'`，与路由无关
- **关键词分析能力已存在，但完全没有接入 skill/model 选择链路！**

---

## 优化机会

### 机会 1：关键词 → Skill 自动推断（高价值，低风险）

**现状**：`identifyWorkType()` 的关键词分析只是死代码，skill 选择纯靠 task_type

**问题**：exploratory task 的 PRD 可能写"调研+实现"，但都被分配 `/exploratory`；
dev task 可能只是"修注释"，被分配完整 `/dev`（带全部代码权限）

**解决方案**：在 `getSkillForTaskType()` 之后，叠加一层 title/description 关键词分析：
```
if task_type='dev' AND title 匹配 /review|检查|分析|调研/ → 推断为 /exploratory 或 /review
if task_type='dev' AND prd_content 字数 < 100 → 标记为简单任务
```

**实现工作量**：S（单函数，不改存储结构）

---

### 机会 2：基于 prd_content 复杂度的 skill_override 自动设置（中价值，低风险）

**现状**：`skill_override` 字段存在，但只能手动设置（创建任务时显式传入）

**问题**：OKR 拆解出来的 Task PRD 内容参差不齐，有的几百字，有的几千字，
但都用相同的 `/dev` + Sonnet 组合处理

**解决方案**：在 `preparePrompt()` 中，分析 prd_content 自动推断 skill：
```
prd_content 包含"调研/分析/报告"关键词 → 用 /exploratory 而不是 /dev
prd_content 包含"测试/验证/检查"关键词 → 用 /review
```

**实现工作量**：S（纯逻辑，不改接口）

---

### 机会 3：Exploratory 续拆 Prompt 补全（高价值，极低风险）

**现状**：exploratory 任务完成后，续拆（next_action=decompose）依赖 payload 字段手动设置

**问题**：如果 OKR 拆解时忘记设置 `next_action=decompose`，exploratory 任务完成后
没有后续 dev task 被创建，整条 KR 推进链断掉（已观测到此类断链）

**解决方案**：在 `preparePrompt()` 中，对 exploratory 任务检查是否有 next_action 字段，
并在 prompt 中明确要求 agent 调用续拆 API

**实现工作量**：XS（加几行 prompt 补全）

---

### 机会 4：Thalamus create_task 支持 skill_override 参数（中价值，中风险）

**现状**：Thalamus 的 `create_task` action 创建任务时，没有传递 skill_override

**问题**：当 Thalamus/Cortex 基于事件分析后创建任务，无法针对具体任务内容
推荐更合适的 skill（只能依赖默认映射）

**解决方案**：在 Thalamus ACTION_WHITELIST 中为 `create_task` 添加 skill_override 参数说明，
并在 prompt 模板中提示 Thalamus 可以设置

**实现工作量**：M（需要修改 Thalamus prompt + action executor）

---

### 机会 5：dispatch-stats 分 task_type 维度拆分（低价值，高复杂度）

**现状**：dispatch-stats 跟踪整体派发成功率，无 task_type 维度

**问题**：无法发现"某类任务失败率异常高可能是 skill 匹配问题"的信号

**解决方案**：在 `recordDispatchResult()` 中增加 task_type 字段，
支持按类型聚合成功率

**实现工作量**：L（涉及 dispatch-stats 数据结构和聚合逻辑）

---

## 推荐实现方案

### 推荐：机会 1 + 2 + 3 合并实现 — "内容感知 Skill 推断"

**理由**：

1. **最小侵入**：只改 `executor.js` 中的 `preparePrompt()` 一个函数，
   不改数据库结构，不改 API 接口，不改 Thalamus

2. **立竿见影**：exploratory 任务的 skill 选择将更精准；
   "调研类" dev 任务不再用完全权限的 `/dev`；
   exploratory 断链问题自动修复

3. **向后兼容**：`skill_override` 仍然优先，手动设置不受影响

4. **可渐进迭代**：先加关键词规则，后期可替换为 Thalamus 分析

**具体实现**：

```
Step 1：在 executor.js 中新增 inferSkillFromContent(task) 函数
        - 输入：task.title + task.description + task.prd_content
        - 输出：{ skill, reason } 或 null（null=使用默认映射）
        - 规则（优先级从高到低）：
          * 包含"调研/分析/报告/研究" → /exploratory（dev 任务时）
          * 包含"审查/检查/验证/评审" → /review（dev 任务时）
          * exploratory 且无 next_action → 追加续拆提示

Step 2：在 preparePrompt() 中，调用 inferSkillFromContent()
        优先级：skill_override > content_infer > type_default

Step 3：写单元测试（至少 5 cases）：
        - dev + 调研关键词 → /exploratory
        - dev + 审查关键词 → /review
        - dev + 无关键词 → /dev（保持默认）
        - exploratory + next_action 已设置 → 不追加
        - exploratory + next_action 未设置 → 追加续拆 prompt
```

**估算工作量**：1 个 PR，2-3 小时实现 + 测试

---

## 后续 Task 清单（草稿）

### Task A：内容感知 Skill 推断（推荐优先）
- task_type: dev
- 优先级: P1
- 描述: 在 executor.js 新增 `inferSkillFromContent()` 函数，
  基于任务标题/描述关键词自动推断更合适的 skill
- 验收: 5 个 unit tests 覆盖关键词场景，preparePrompt() 集成验证

### Task B：Exploratory 续拆 Prompt 补全
- task_type: dev
- 优先级: P1
- 描述: 当 task_type='exploratory' 且 payload.next_action 未设置时，
  在 preparePrompt() 中自动追加"完成后调用续拆 API"的 prompt 片段
- 验收: 有/无 next_action 两种场景的单元测试

### Task C：Thalamus create_task 支持 skill_override
- task_type: dev
- 优先级: P2
- 描述: 更新 Thalamus prompt 说明 create_task action 支持 skill_override 参数；
  更新 action executor 传递此参数
- 验收: Thalamus 路由 task_failed 事件时，输出包含 skill_override 字段

---

## 附：当前匹配链路图

```
任务到达 tick.js
    ↓
dispatchNextTask()
    ↓
triggerCeceliaRun(task)
    ↓
┌─────────────────────────────────────────────┐
│ 匹配层（executor.js）                         │
│                                             │
│ 1. getTaskLocation(task_type)               │
│    → us / hk（静态映射）                      │
│                                             │
│ 2. getSkillForTaskType(task_type)           │
│    → /dev / /review / ...（静态映射）         │
│    ← 可被 payload.skill_override 覆盖        │
│                                             │
│ 3. getPermissionModeForTaskType(task_type)  │
│    → bypassPermissions / plan（静态映射）     │
│                                             │
│ 4. getModelForTask(task)                    │
│    → null（Sonnet，成本优化后硬编码）           │
│                                             │
│ 5. preparePrompt(task)                      │
│    → 生成最终 prompt 字符串                   │
└─────────────────────────────────────────────┘
    ↓
cecelia-bridge → claude -p "prompt"
```

**优化后链路（推荐方案）**：

```
2. getSkillForTaskType(task_type)  → 默认 skill
    ↓
2.5 inferSkillFromContent(task)    → 内容感知推断（NEW）
    优先级：skill_override > content_infer > type_default
    ↓
5. preparePrompt(task)             → 使用推断后的 skill
   + exploratory 续拆 prompt 补全（NEW）
```
