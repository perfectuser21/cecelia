---
id: architect-skill
description: /architect - 系统架构师，提出设计方案、产出架构文档，与 /arch-review 分工互补
version: 1.4.0
created: 2026-03-06
updated: 2026-03-09
changelog:
  - 1.4.0: Mode 2 Phase 1 明确 system_modules 为空时的标准处理（返回失败，Brain 自动创建 Mode 1 scan task）
  - 1.3.0: Mode 2 串行 task 创建规范（sequence_order/blocked/depends_on_prev）；Mode 3 machine-readable verdict JSON 输出规范
  - 1.2.0: Mode 2 新增 initiative-dod.md + 集成测试归属；Mode 3 verify 完整实现（含架构对齐校验）
  - 1.0.0: 初始版本 - Mode 1 系统说明书 + Mode 2 Initiative 设计
---

# /architect - 系统架构师

**角色**: Architect（架构师） - 既是 CTO（让人看懂系统）也是 Architect（让 AI 有设计再编码）

**模型**: Opus（深度分析需要最强推理能力）

---

## 核心定位

/architect 是 Initiative 级别的架构设计技能。解决三个问题：

1. **Owner 看不懂系统** - Mode 1 扫描代码，生成人可读的模块说明书
2. **AI 没有设计就编码** - Mode 2 在 /dev 之前产出技术方案 + Initiative DoD，确保全局一致性
3. **Initiative 无闭环收尾** - Mode 3 验收 DoD、校验架构对齐、更新文档、标记完成

```
Initiative 完整流水线:
  /decomp          → 拆出 Initiatives
  /architect M2    → 技术设计 + Initiative DoD + Tasks 注册
  /dev × N         → 按设计写代码
  /code-review     → Initiative 级集成审查（--initiative-id）
  /architect M3    → 验收收尾（verify 模式）
```

---

## 触发方式

```bash
# Mode 1: 生成/更新系统说明书
/architect scan

# Mode 2: Initiative 技术设计
/architect design <initiative_description>

# Mode 3: Initiative 验收收尾
/architect verify --initiative-id <id>

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
3. 如果 `system_modules` 表为空（无记录）→ **立即停止并返回失败**
   - 不要自行内嵌 Mode 1 逻辑
   - Brain 的 execution-callback（断链#3）会检测到 architecture_design(design) 失败
   - Brain 随后自动创建新的 `architecture_design(mode='scan')` task 让 Mode 1 先执行
   - Mode 1 完成后 Brain 重新派发 `architecture_design(mode='design')` task
   - **切勿在同一个 task 内嵌套两个 Mode 的逻辑**

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

#### Phase 3.5: 产出 initiative-dod.md（强制，不可跳过）

**Mode 3 将逐条对照此文件验收。没有此文件 = Mode 2 失败。**

```markdown
# Initiative DoD: [Initiative Name]

## 功能验收条件（Mode 3 逐条检查）
- [ ] F1: [具体功能，可量化] — 验证方式: [如何验证]
- [ ] F2: [具体功能，可量化] — 验证方式: [如何验证]

## 集成测试通过条件
- [ ] I1: 集成测试全部通过（最后一个 dev task 的测试套件）
- [ ] I2: Golden Path 端到端通过

## 架构对齐条件（Mode 3 自动校验）
- [ ] A1: 数据模型变更按 architecture.md 实现（逐字段）
- [ ] A2: API 端点按 architecture.md 实现（逐端点）
- [ ] A3: 关键决策已落地（无偏离）

## 非功能条件
- [ ] N1: 无新增 L1 bug（code_review 无 BLOCK）
- [ ] N2: Brain CI 全通过
```

#### Phase 4: 拆分 Tasks（含集成测试归属）

将 architecture.md 拆成可独立执行的 Tasks：

```
Task 1: [标题] -- 依赖: 无
Task 2: [标题] -- 依赖: Task 1
Task N: [标题 + 集成测试] -- 依赖: Task 1, Task 2  ← 集成测试在这里
```

拆分原则：
- 每个 Task = 1 个 PR
- Task 之间有明确依赖关系
- **最后一个 dev task 明确承担集成测试职责**（description 注明，payload 含 `integration_test_owner: true`）
- 总 Task 数 3-7 个

#### Phase 5: 注册到 Brain（强制，不可跳过）

**必须为每个 Task 调用 Brain API。不调用 = Phase 5 未完成 = Mode 2 失败。**

**串行 task 格式（重要）**：

| 位置 | `status` | `sequence_order` | `depends_on_prev` | 说明 |
|------|----------|-----------------|-------------------|------|
| 第 1 个 task | `queued` | `1` | 不设置 | Brain 立即调度 |
| 第 2-N 个 task | `blocked` | `2`…`N` | `"true"` | 前一个完成后自动解锁 |
| 最后一个 task | `blocked` | N | `"true"` | 同时设 `integration_test_owner: true` |

> Brain 在第 N 个 task 完成时（execution-callback 断链#5c11），自动解锁第 N+1 个 task，并注入 `prev_task_result`（含 summary/pr_url）供下一个 task 参考。

执行流程：

1. 先注册第 1 个 Task（`status: "queued", sequence_order: 1`），记录返回的 `task_id`
2. 按顺序注册后续 Task（`status: "blocked", depends_on_prev: "true", sequence_order: N`）
3. 每个 curl 调用必须检查 HTTP 状态码（201 = 成功，其他 = 重试或报错）

```bash
# Task 1（第一个，立即可调度）
TASK1_ID=$(curl -s -X POST http://localhost:5221/api/brain/tasks \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Task 1 标题",
    "description": "Task 描述，引用 architecture.md 对应章节",
    "priority": "P1",
    "project_id": "<initiative_id>",
    "task_type": "dev",
    "goal_id": "<kr_id>",
    "status": "queued",
    "payload": {
      "architecture_ref": "architecture.md",
      "sequence_order": 1,
      "harness_mode": true
    }
  }' | jq -r '.id')

echo "Task 1 注册成功: $TASK1_ID"

# Task 2（串行等待 Task 1 完成，非最后一个）
TASK2_ID=$(curl -s -X POST http://localhost:5221/api/brain/tasks \
  -H "Content-Type: application/json" \
  -d "{
    \"title\": \"Task 2 标题\",
    \"description\": \"Task 描述（可引用 prev_task_result.summary 获取上一个 task 产出）\",
    \"priority\": \"P1\",
    \"project_id\": \"<initiative_id>\",
    \"task_type\": \"dev\",
    \"goal_id\": \"<kr_id>\",
    \"status\": \"blocked\",
    \"payload\": {
      \"architecture_ref\": \"architecture.md\",
      \"sequence_order\": 2,
      \"depends_on_prev\": \"true\",
      \"harness_mode\": true
    }
  }" | jq -r '.id')

echo "Task 2 注册成功: $TASK2_ID"

# Task N（最后一个，负责集成测试）
TASKN_ID=$(curl -s -X POST http://localhost:5221/api/brain/tasks \
  -H "Content-Type: application/json" \
  -d "{
    \"title\": \"Task N 标题（集成测试负责人）\",
    \"description\": \"Task 描述\",
    \"priority\": \"P1\",
    \"project_id\": \"<initiative_id>\",
    \"task_type\": \"dev\",
    \"goal_id\": \"<kr_id>\",
    \"status\": \"blocked\",
    \"payload\": {
      \"architecture_ref\": \"architecture.md\",
      \"sequence_order\": N,
      \"depends_on_prev\": \"true\",
      \"integration_test_owner\": true,
      \"harness_mode\": true
    }
  }" | jq -r '.id')

echo "Task N 注册成功: $TASKN_ID"
```

**注册后验证**：

```bash
# 确认 Task 1 在 queued，其余在 blocked
curl -s "http://localhost:5221/api/brain/tasks?project_id=<initiative_id>" | \
  jq '[.[] | {title, status, sequence_order: .payload.sequence_order}]'
```

### 完成条件

- `architecture.md` 文件存在
- `initiative-dod.md` 文件存在（至少 3 条功能验收条件）
- 所有 Tasks 已注册到 Brain：第 1 个 `status=queued`，其余 `status=blocked`
- `sequence_order` 连续递增，最后一个含 `integration_test_owner: true`
- 创建 `.architect-design-done` 文件

---

## Mode 3: Initiative 验收收尾（verify）

### 目标

Initiative 所有 dev tasks 完成、code_review PASS 后，执行功能验收 + 架构对齐校验 + 文档更新 + 标记完成。

Brain 自动触发：`task_type = 'initiative_verify'` → executor 生成 `/architect verify --initiative-id <project_id>`

### Phase 1: 验收检查

#### Step 1.1 流程验收

```bash
INITIATIVE_ID="<id>"

# 所有 dev tasks 已完成？
PENDING_DEV=$(curl -s "http://localhost:5221/api/brain/tasks?project_id=$INITIATIVE_ID" | \
  jq '[.[] | select(.task_type=="dev" and (.status | IN("queued","in_progress","blocked")))] | length')
[ "$PENDING_DEV" -gt 0 ] && echo "BLOCK: $PENDING_DEV dev tasks 未完成" && exit 1

# code_review PASS（scope=initiative）？
CR_STATUS=$(curl -s "http://localhost:5221/api/brain/tasks?project_id=$INITIATIVE_ID" | \
  jq -r '[.[] | select(.task_type=="code_review" and .payload.scope=="initiative")] | last | .status')
[ "$CR_STATUS" != "completed" ] && echo "BLOCK: initiative code_review 未完成" && exit 1
echo "✅ 流程验收通过"
```

#### Step 1.2 功能 DoD 验收

读取 `initiative-dod.md`，逐条验证 F1/F2... 条件，记录 PASS / FAIL。

#### Step 1.3 架构对齐校验

对照 `architecture.md` 逐条校验：

**数据模型对齐**：查询实际 DB schema，确认 architecture.md 中描述的新增字段/表是否存在。

**API 端点对齐**：grep routes.js 确认 architecture.md 中描述的新增端点是否存在。

**关键决策对齐**：逐条读"关键决策"表，判断代码实现是否符合选定方案。不可自动校验的 → 标注"需人工确认"。

#### Step 1.4 汇总报告

```markdown
## Initiative 验收报告

### 流程验收
- ✅ 所有 dev tasks 完成 / ✅ code_review PASS

### 功能 DoD
- ✅/❌ F1: ...
- ✅/❌ F2: ...

### 架构对齐
- ✅/❌ A1: 数据模型 — [字段] 存在
- ✅/❌ A2: API — [端点] 存在
- ⚠️  A3: 需人工确认 — [决策描述]

### 总体裁决
PASS / PARTIAL（可接受）/ BLOCK（不可接受，停止后续 Phase）
```

**BLOCK 时**：停止，不进入 Phase 2/3，不标记 completed。

### Phase 2: 文档更新

1. **更新 architecture.md**：追加实施记录（完成时间、实际偏差、验收结果）
2. **增量扫描 system_modules**：对本 Initiative 改动的模块，运行 Mode 1 增量扫描
3. **更新 DEFINITION.md**（若有架构层面变更）：新增 task_type、Brain 器官、端口等
4. **更新 LEARNINGS.md**：记录关键决策回顾、踩的坑、下次改进建议

### Phase 3: 标记完成

```bash
# PATCH initiative 状态
curl -s -X PATCH http://localhost:5221/api/brain/projects/$INITIATIVE_ID \
  -H "Content-Type: application/json" \
  -d '{"status": "completed"}'

# 关闭剩余 queued tasks（防御性清理）
curl -s "http://localhost:5221/api/brain/tasks?project_id=$INITIATIVE_ID&status=queued" | \
  jq -r '.[].id' | while read tid; do
    curl -s -X PATCH "http://localhost:5221/api/brain/tasks/$tid" \
      -H "Content-Type: application/json" \
      -d '{"status": "cancelled", "result": "initiative_verify 完成，剩余任务关闭"}'
  done

# 创建完成标志
echo "verified_at=$(TZ=Asia/Shanghai date +%Y-%m-%dT%H:%M:%S+08:00)" > .architect-verify-done
echo "initiative_id=$INITIATIVE_ID" >> .architect-verify-done
echo "verdict=PASS" >> .architect-verify-done
```

### 输出规范（Machine-Readable Verdict）

**`initiative_verify` task 的 result 必须包含以下 JSON 结构**，供 Brain 断链#6 路由使用：

```json
{
  "verdict": "APPROVED",
  "summary": "Initiative 验收通过：所有功能 DoD 满足，架构对齐无偏差",
  "dod_results": [
    { "id": "F1", "status": "PASS", "note": "..." }
  ],
  "architecture_alignment": "aligned"
}
```

| `verdict` 值 | 含义 | Brain 行为 |
|-------------|------|-----------|
| `APPROVED` | 验收通过 | project status → completed |
| `NEEDS_REVISION` | 有问题但可修复 | 创建修订 dev task（最多 3 轮） |
| `REJECTED` | 架构/功能根本性问题 | cecelia_events P0 告警 |

**输出规则**：
- Phase 1 所有验收项 PASS → `verdict: "APPROVED"`
- Phase 1 有 FAIL 但属于可修复问题（实现偏差、边界条件）→ `verdict: "NEEDS_REVISION"`
- Phase 1 有根本性失败（架构不符、关键 API 缺失）→ `verdict: "REJECTED"`
- Phase 1 返回 BLOCK → `verdict: "REJECTED"`

**在 task execution-callback 时输出**（通过 Brain `/api/brain/execution-callback`）：
```bash
curl -s -X POST http://localhost:5221/api/brain/execution-callback \
  -H "Content-Type: application/json" \
  -d "{
    \"task_id\": \"$TASK_ID\",
    \"run_id\": \"$RUN_ID\",
    \"status\": \"AI Done\",
    \"result\": {
      \"verdict\": \"APPROVED\",
      \"summary\": \"$SUMMARY\"
    }
  }"
```

### 完成条件（Mode 3）

- Phase 1 验收报告产出，裁决为 PASS 或 PARTIAL
- `architecture.md` 追加实施记录
- `LEARNINGS.md` 更新
- initiative status = completed
- 创建 `.architect-verify-done`

---

## Stop Hook 集成

### 模式文件

- Mode 1: 创建 `.architect-lock.scan`
- Mode 2: 创建 `.architect-lock.design`

### 完成条件

| Mode | 检查文件 | 完成标志 |
|------|---------|---------|
| Mode 1 (scan) | `.architect-scan-done` | system_modules 有数据 |
| Mode 2 (design) | `.architect-design-done` | architecture.md + initiative-dod.md + Tasks 注册 |
| Mode 3 (verify) | `.architect-verify-done` | 验收报告 + initiative completed |

---

## Brain 注册

| task_type | skill 参数 | 说明 |
|-----------|-----------|------|
| `architecture_design` | `/architect design ...` | Mode 2 — 技术设计 |
| `initiative_verify` | `/architect verify --initiative-id <project_id>` | Mode 3 — 验收收尾 |

---

## 与其他 Skill 的关系

### 场景一：主流程（新项目 / 首次）

Mode 1 必须在 /decomp 之前运行——它建立的 system_modules 知识库是 /decomp 有依据拆解的前提。

```
/plan 识别层级
    ↓
/architect M1 → 建立 system_modules 知识库
    ↓
/decomp → 拆 OKR → Initiative
    ↓
[每个 Initiative 独立执行]
    ↓
/architect M2 → architecture.md + initiative-dod.md + Tasks 注册（含集成测试归属）
    ↓
/dev Task 1 → PR → merge
/dev Task 2 → PR → merge
/dev Task N → PR → merge（含集成测试）
    ↓
Brain 断链#5: 所有 dev 完成 → code_review(scope=initiative)
    ↓
/code-review --initiative-id <id>（集成测试 + 代码质量）
    ↓ PASS
Brain 断链#4: initiative_verify 创建
    ↓
/architect M3 verify → 功能 DoD + 架构对齐 + 文档更新 + 标记完成
    ↓
Initiative ✅ 完成
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
- Mode 2 不产出 initiative-dod.md = 失败（DoD 是 Mode 3 验收的唯一依据）
- 不在 Mode 2 中跳过 system_modules 检查
- Mode 3 跳过架构对齐校验 = 失败
- Mode 3 裁决 BLOCK 时标记 initiative completed = 严重错误
# /architect skill
