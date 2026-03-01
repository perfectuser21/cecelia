---
name: decomp
version: 1.5.0
created: 2026-02-27
updated: 2026-03-01
changelog:
  - 1.5.0: Stage 2/3 写入 known vs exploratory 明确判定规则，含判定表格、强制声明要求和灰色地带案例
  - 1.4.0: Phase 2 Step 1 补充读取 parent Project 描述（北极星），initiative_plan session 有完整全局上下文
  - 1.3.0: 加入 Phase 2 initiative_plan 模式，打通 Initiative → PR 执行循环
  - 1.2.0: 加入 Stage 0.5 - 上次审查反馈读取（rejected 重拆时必须针对性修正）
  - 1.1.0: 加入顶部 HARD RULE，补写入前自检，修复 Stage 4 幂等检查漏查 projects 表
  - 1.0.0: 从 /okr 重写。改名 decomp，对齐数据库结构，移除时间约束，加入战略对齐检查，KR→Project 数量不设上限
description: |
  全链路 Project Management 拆解引擎。供秋米（autumnrice）角色在后台调用。
  输入任意层级（Global OKR / Area OKR / KR / Project / Initiative），
  自动识别层级，逐层拆解到下一层，写入数据库。
  OKR 层（Global/Area）拆解后标记需人工确认；KR 以下由 Decomp-Check 自动审查。
  触发词：拆解、分解、秋米被调用、decomp、project management 规划。
  initiative_plan 模式：读 Initiative + 已完成 PR → 规划下一 PR → 写 dev 任务。
---

> **CRITICAL LANGUAGE RULE: 所有输出必须使用简体中文。**

# Decomp — 全链路 PM 拆解引擎

## ⛔ HARD RULE（最高优先级，不可违反）

**Decomp 分两个 Phase，写入权限完全不同：**

| Phase | 触发方式 | 写入表 | 说明 |
|-------|---------|--------|------|
| **Phase 1**（OKR 拆解） | task_type = 'dev'（含 decomposition payload） | `goals` / `projects` | 绝不写 `tasks` |
| **Phase 2**（initiative_plan） | task_type = 'initiative_plan' | `tasks`（一条 dev 任务） | 绝不写 `goals`/`projects` |

**Phase 1 层级写入规则（绝不写 tasks 表）**：

| 层级流向 | 写入表 | type 字段 |
|---------|-------|-----------|
| Global OKR → Area OKR | goals | area_okr |
| Area OKR → KR | goals | kr |
| KR → Project | projects | project |
| Project → Initiative | projects | initiative |

**Phase 2 写入规则（只写一条 dev task）**：
- 写入 `tasks` 表，`task_type = 'dev'`
- 必须包含：`project_id`（指向 Initiative）、`goal_id`（所属 KR）、`priority = 'P1'`
- 绝不写 `goals` 或 `projects` 表

**写入任何记录前，必须自问：**
1. 我现在是 Phase 1 还是 Phase 2？（看 task_type 字段）
2. Phase 1：写的是 goals/projects？（绝不写 tasks）
3. Phase 2：写的是 tasks 表的一条 dev 任务？（绝不多写）

如果 Phase 1 发现自己在写 `tasks` 表——立刻停止，重看此 HARD RULE。

---

## 核心设计原则

1. **野心驱动**：OKR 应该激进，70% 达成算成功。KR 不要因为"怕完不成"而定保守。
2. **范围驱动，不设时间约束**：Project 和 Initiative 的大小由范围决定。KR 下 Project 数量按需生成，无上限。
3. **战略对齐**：每层拆解前必须问"这能推动上层指标/目标吗？"
4. **边做边拆**：只详细写下一步，后续保持 draft。

---

## Stage 0.5：上次审查反馈（重拆时必读，首次跳过）

**Brain 在重新调用秋米时，会在 task payload 中传入上次 Vivian 的审查结果。如果存在 `findings`，必须在拆解前读取并针对性修正。**

检查 task 描述/payload 是否包含类似以下内容：

```
上次 Decomp-Check 审查结果（rejected）：
- 因果链：断裂 - "Project X 无法说明如何推动 KR 指标"
- 命名质量：模糊 - "Initiative #2 '优化处理' 无法判断交付什么"
- 覆盖度：遗漏 - "没有覆盖监控和告警"
```

**如果有 findings：**
1. 逐条列出上次的问题
2. 明确说明本次如何针对每个问题修正
3. 再开始拆解

**如果没有 findings（首次拆解）：** 跳过此 Stage，直接 Stage 0。

这就是 validation loop 的"学习"环节——每次 rejected 都有具体的修正依据，不是盲目重拆。

---

## Stage 0：层级识别（第一步，不可跳过）

### 数据库实际结构（SSOT）

```
goals 表（type 字段值）：
  global_okr  — 全平台季度 Objective
  area_okr    — 单 Area 月度 Objective
  kr          — Key Result（parent_id → global_okr 或 area_okr）

projects 表（type 字段值）：
  project     — 功能模块（kr_id → 关联 KR）
  initiative  — 子功能（parent_id → project）

tasks 表：
  task        — 单个 PR（由 /dev 接管，decomp 不创建 task）
```

### 三维识别矩阵

| 维度 | 信号 | 判定层级 |
|------|------|----------|
| **范围**（主信号）| 跨多个 Area | global_okr |
| | 单 Area，方向性，无度量 | area_okr |
| | 有可量化指标（%/数量/频率）| kr |
| | 跨多 repo 或多 Initiative | project |
| | 单 repo，单子功能 | initiative |
| **抽象度** | 方向/愿景，无法直接执行 | global_okr / area_okr |
| | 可量化的结果 | kr |
| | 可以直接开始写代码 | initiative |
| **工作量** | 多个 Agent 协作，长周期 | project |
| | 单 Agent，独立可部署 | initiative |

### 识别输出（必须输出）

```
[层级识别]
输入："{传入描述}"
判定：{global_okr | area_okr | kr | project | initiative}
依据：{哪个维度起决定作用}
拆解方向：{当前层} → {下一层}
需人工确认：{是 / 否}
```

---

## Stage 1：五层模板（统一标准，Decomp-Check 按此审查）

### 模板 A — Global OKR（季度 Objective）

```yaml
title: "[激进的季度方向——让人兴奋的愿景]"
type: global_okr
涉及 Area: [列举，必须 2+ 个]
成功画面: "[季度末 70% 达成时，系统/业务是什么状态]"
野心说明: "[为什么值得追求这个目标]"
```

**拆解到**：每个 Area 一个 area_okr（月度）

**硬约束**：全局最多 7 个 area_okr；每个 Objective 最多 5 个 KR

---

### 模板 B — Area OKR（月度 Objective）

```yaml
title: "[单 Area 月度激进目标]"
type: area_okr
parent_id: "<global_okr_id>"
所属 Area: "[Cecelia / ZenithJoy / ...]"
成功画面: "[月底达成时，这个 Area 变成什么样]"
```

**拆解到**：2-5 个 KR（月底可验收）

---

### 模板 C — KR（Key Result）

```yaml
title: "[动词 + 对象 + 从 X 到 Y]"
type: kr
parent_id: "<okr_id>"
metric_from: X
metric_to: Y
metric_unit: "[% / 次 / 个 / ms ...]"
measure: "[具体怎么测：SQL / API / 日志查询]"
验收时间: "[月底 / 季度末]"
推动逻辑: "[为什么做下面这些 Project，指标会从 X 到 Y]"
```

**拆解到**：Project（数量不限，按 KR 复杂度决定）

**KR 质量硬规则**：
- 必须有数字（from / to）
- 度量方式必须可执行（能实际查到数据）
- 推动逻辑必须可信（不能写"做了功能所以指标会提升"）

---

### 模板 D — Project（功能模块）

```yaml
name: "[完整可交付的功能模块名称]"
type: project
kr_id: "<kr_id>"
推动方式: "[完成这个 Project 后，KR 的指标如何变化，为什么]"
交付物: "[完成后用户/系统能感知到什么]"
验收标准:
  - "[条件1，可测试]"
  - "[条件2，可测试]"
```

**拆解到**：3-8 个 Initiative

**注意**：`推动方式` 必须具体——不能写"有助于提升指标"，要写"因为修复了 X 路径的失败，成功率会从 A% 提升到 B%"。

---

### 模板 E — Initiative（独立子功能）

```yaml
name: "[独立可部署的子功能名称]"
type: initiative
parent_id: "<project_id>"
产出: "[代码/配置/数据，具体说]"
dod:
  - "[完成条件1]"
  - "[完成条件2]"
  - "[测试通过]"
task_type: "[dev / exploratory / review / qa]"
```

**Decomp 到此为止**，Initiative 创建后由 /dev 接管拆 Task（PR）。

---

## Stage 2：拆解规则

### Global OKR → Area OKR

1. 按 Area 拆分，每个 Area 一个月度 Objective
2. Area OKR 各自独立可验收（月底）
3. 所有 Area OKR 加起来能推动 Global OKR
4. **写入时 status='reviewing'**（需人工在 Dashboard 确认）

```bash
curl -X POST localhost:5221/api/brain/goals \
  -H 'Content-Type: application/json' \
  -d '{"title":"...","type":"area_okr","parent_id":"<global_id>","status":"reviewing"}'
```

### Area OKR → KR

1. 每个 KR 必须有 from/to 数字和度量方式
2. 2-5 个 KR per Objective（硬上限）
3. **写入时 status='reviewing'**（需人工确认）

```bash
curl -X POST localhost:5221/api/brain/goals \
  -H 'Content-Type: application/json' \
  -d '{
    "title": "任务成功率从60%提升到90%",
    "type": "kr",
    "parent_id": "<area_okr_id>",
    "status": "reviewing",
    "metadata": {
      "metric_from": 60,
      "metric_to": 90,
      "metric_unit": "%",
      "measure": "SELECT succeeded/total FROM task_runs"
    }
  }'
```

### KR → Project

1. **先问自己**："哪些 Project 能真正把指标从 X 推到 Y？"
2. 数量不限——复杂 KR 可能需要 10-20 个 Project，简单 KR 可能 2-3 个
3. 每个 Project 必须填写 `推动方式`
4. **写入后触发 Decomp-Check**（自动审查，无需人工）

```bash
curl -X POST localhost:5221/api/brain/projects \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "...",
    "type": "project",
    "kr_id": "<kr_id>",
    "description": "...",
    "metadata": {"push_mechanism": "..."}
  }'
```

### Project → Initiative

#### ⚠️ 必须显式声明：每个 Initiative 的 decomposition_mode

**秋米每次创建 Initiative 时，必须在输出中明确声明选用哪个模式，并给出理由。**

格式（不可省略）：

```
[模式声明] Initiative "XXX"
  选择模式：known / exploratory
  理由：[1-2 句说明为什么]
```

不声明 = Decomp-Check 自动 rejected。

---

#### 判定规则：known vs exploratory

**核心问题**：拆解时，你对"完成这个 Initiative 需要几个 PR、改哪些文件、架构怎么走"是否有把握？

| 条件 | 选 known | 选 exploratory |
|------|---------|----------------|
| **方案清晰度** | 实现方案明确，能列出 PR 序列 | 方案未知，需要先调研或试错 |
| **文件依赖** | 涉及文件 < 5 个，已知具体文件名 | 5+ 文件，或不知道要改哪些 |
| **根因是否明确** | 明确 bug 修复（有具体报错/复现路径） | 根因未知，需先诊断 |
| **模块状态** | 改造/扩展现有模块 | 新模块从 0 到 1 |
| **架构影响** | 不影响整体架构 | 需要探索架构设计 |
| **依赖外部** | 依赖关系已知、稳定 | 依赖第三方 API/行为不确定 |

**简记口诀**：
- **known** = 知道怎么做，列得出 PR 清单
- **exploratory** = 不知道怎么做，先探索再规划

---

#### 灰色地带判定（边界案例）

以下是 3 个常见灰色地带及正确判断：

**案例 1：优化性能，但不知道瓶颈在哪**

> "优化 tick 循环性能，目标从 200ms 降到 50ms"

- 看似明确（有具体指标）→ 但根因未知（不知道瓶颈在哪里）
- **选 exploratory**：先创建"性能分析和诊断"Initiative，找到瓶颈后再创建 known 的优化 Initiative

---

**案例 2：加一个新 API 端点**

> "新增 /api/brain/intent-router 端点，支持统一意图路由"

- 已知要加哪个端点，但"统一意图路由"涉及架构设计（24 个入口点的整合）
- **看具体工作量**：
  - 如果只是加端点 + 路由逻辑（<5 文件）→ **known**
  - 如果需要重新设计意图识别框架、整合多模块 → **exploratory**

---

**案例 3：修复一个已知 bug**

> "修复 liveness probe 把 bridge 任务误杀的 bug"

- 根因明确（ps aux grep 找不到 bridge 进程 pid）
- 改动范围明确（executor.js 的 probeTaskLiveness 函数）
- **选 known**：直接规划修复 PR

---

1. 3-8 个 Initiative per Project
2. 每个 Initiative 独立可部署（不依赖其他 Initiative 才能运行）
3. **模式选择（必须显式声明，见上方判定规则）**：方案清晰 → known；不确定/需探索 → exploratory
4. **写入后触发 Decomp-Check**（自动审查）

```bash
curl -X POST localhost:5221/api/brain/projects \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "...",
    "type": "initiative",
    "parent_id": "<project_id>",
    "description": "...",
    "metadata": {"dod": [...], "task_type": "dev"}
  }'
```

---

## Stage 3：战略对齐检查（每层必做）

拆解前，必须回答以下问题：

| 层级 | 对齐问题 |
|------|----------|
| Global OKR → Area OKR | 这些 Area OKR 加起来，能实现季度方向吗？ |
| Area OKR → KR | 这些 KR 全部达成，月度目标就完成了吗？ |
| KR → Project | 这些 Project 完成后，指标真的会从 X 到 Y 吗？为什么？ |
| Project → Initiative | 这些 Initiative 全做完，Project 的验收标准都能过吗？ |

如果回答"不确定" → 先创建 **exploratory** Initiative 调研，再继续（参见 Stage 2 known vs exploratory 判定规则）。

---

## Stage 4：幂等性检查（拆解前必做）

```bash
# 检查是否已有子节点（防止重复拆解）——OKR 层级用 goals 表
curl -s "localhost:5221/api/brain/goals?parent_id=<id>" | jq 'length'
# > 0 → 停止，列出已有子节点

# Area OKR 上限
curl -s "localhost:5221/api/brain/goals?type=area_okr" | jq 'length'
# >= 7 → 停止

# KR 上限（每个 Objective 最多 5 个）
curl -s "localhost:5221/api/brain/goals?parent_id=<okr_id>&type=kr" | jq 'length'
# >= 5 → 停止

# Project 幂等检查（KR → Project，查 projects 表，不是 goals 表）
curl -s "localhost:5221/api/brain/projects?kr_id=<kr_id>&type=project" | jq 'length'
# > 0 → 停止，列出已有 Project，不重复拆解

# Initiative 幂等检查（Project → Initiative，查 projects 表）
curl -s "localhost:5221/api/brain/projects?parent_id=<project_id>&type=initiative" | jq 'length'
# > 0 → 停止，列出已有 Initiative，不重复拆解
```

---

## Stage 5：输出格式

```json
{
  "input_layer": "area_okr",
  "output_layer": "kr",
  "needs_human_approval": true,
  "created": [
    {
      "id": "...",
      "title": "任务成功率从60%提升到90%",
      "type": "kr",
      "status": "reviewing"
    }
  ],
  "alignment_check": "这3个KR全部达成后，Area OKR的成功画面能实现，理由是...",
  "next_step": "等待人工在 Dashboard 确认后继续 / 触发 Decomp-Check 审查"
}
```

`needs_human_approval`：
- global_okr → area_okr：`true`
- area_okr → kr：`true`
- kr → project：`false`（Decomp-Check 审查即可）
- project → initiative：`false`（Decomp-Check 审查即可）

---

## Phase 2：initiative_plan 模式（执行循环）

> **触发条件**：Brain 派发了 `task_type = 'initiative_plan'` 的任务。
> 这是与 Phase 1（OKR 拆解）完全不同的模式。

### 背景

Initiative 是"一组 PR 的闭环工作包"。当 Initiative 有 0 个活跃任务时，Brain 会创建 `initiative_plan` 任务并派发给你。你的职责是：**读取 Initiative 目标和已完成 PR，判断是否继续，是则规划下一个 PR。**

### 执行步骤

**Step 1：读取全量上下文（Project + Initiative + 已完成 PR）**

```bash
# 读 Initiative 描述（同时拿到 parent_id = 所属 Project 的 ID）
INITIATIVE=$(curl -s "localhost:5221/api/brain/projects/<initiative_id>")
echo $INITIATIVE | jq '{name, description, status, parent_id}'

# 读 parent Project 描述（方向锚点，判断 Initiative 是否仍在正轨）
PROJECT_ID=$(echo $INITIATIVE | jq -r '.parent_id')
curl -s "localhost:5221/api/brain/projects/$PROJECT_ID" | jq '{name, description}'

# 读已完成的 PR 列表
curl -s "localhost:5221/api/brain/tasks?project_id=<initiative_id>&status=completed" | jq '[.[] | {title, description}]'
```

> **为什么要读 Project？** Initiative 可能已完成自身子目标，但 Project 整体目标还需要更多工作。Project 描述是你的"北极星"——确认当前 Initiative 的进度放在 Project 全局视野里是否足够。

**Step 2：评估 Initiative 是否完成**

判断：基于 Initiative 的描述/目标 + 已完成 PR 的内容，目标是否达成？

- **是** → 执行 Step 3a（标记完成）
- **否** → 执行 Step 3b（规划下一 PR）

**Step 3a：Initiative 完成 → 标记 completed**

```bash
curl -s -X PATCH "localhost:5221/api/brain/projects/<initiative_id>" \
  -H "Content-Type: application/json" \
  -d '{"status": "completed"}'
```

输出结果：
```json
{
  "phase": "initiative_plan",
  "verdict": "completed",
  "initiative_id": "<id>",
  "reason": "Initiative 目标已达成，具体原因..."
}
```

然后结束，不创建新任务。

**Step 3b：Initiative 未完成 → 规划下一 PR**

基于 Initiative 目标和已完成内容，规划下一个 PR：

```bash
curl -s -X POST "localhost:5221/api/brain/tasks" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "<PR 标题，简洁说明本次 PR 做什么>",
    "description": "<详细 PRD：背景、具体需求、涉及文件、成功标准>",
    "task_type": "dev",
    "priority": "P1",
    "project_id": "<initiative_id>",
    "goal_id": "<kr_id 或 null>",
    "status": "queued"
  }'
```

输出结果：
```json
{
  "phase": "initiative_plan",
  "verdict": "in_progress",
  "initiative_id": "<id>",
  "planned_pr": {
    "title": "...",
    "rationale": "为什么下一步做这个"
  }
}
```

### 规划原则

- **边做边拆**：只规划下一个 PR，不要提前规划全部 PR
- **基于结果**：每次规划时参考已完成 PR 的实际情况，不要按原计划盲目执行
- **最小可交付**：每个 PR 应该是独立可部署的功能单元
- **完成即止**：一旦 Initiative 目标达成就停止，不要多做

### 循环流程

```
initiative_plan session（你）
  → 判断未完成 → 写 dev task → 结束

Brain 自动派发 dev task
  → /dev session 执行 PR → 合并 → 结束

Brain execution-callback 检测到 dev 完成
  → 创建下一个 initiative_plan task → 派发

initiative_plan session（你，下一轮）
  → 读 Initiative + 所有已完成 PR → 重新判断 → ...
```
