---
name: decomp
version: 1.2.0
created: 2026-02-27
updated: 2026-02-27
changelog:
  - 1.2.0: 加入 Stage 0.5 - 上次审查反馈读取（rejected 重拆时必须针对性修正）
  - 1.1.0: 加入顶部 HARD RULE，补写入前自检，修复 Stage 4 幂等检查漏查 projects 表
  - 1.0.0: 从 /okr 重写。改名 decomp，对齐数据库结构，移除时间约束，加入战略对齐检查，KR→Project 数量不设上限
description: |
  全链路 Project Management 拆解引擎。供秋米（autumnrice）角色在后台调用。
  输入任意层级（Global OKR / Area OKR / KR / Project / Initiative），
  自动识别层级，逐层拆解到下一层，写入数据库。
  OKR 层（Global/Area）拆解后标记需人工确认；KR 以下由 Decomp-Check 自动审查。
  触发词：拆解、分解、秋米被调用、decomp、project management 规划。
---

> **CRITICAL LANGUAGE RULE: 所有输出必须使用简体中文。**

# Decomp — 全链路 PM 拆解引擎

## ⛔ HARD RULE（最高优先级，不可违反）

**Decomp 绝对不创建 tasks 表的记录。**

| 层级流向 | 写入表 | type 字段 |
|---------|-------|-----------|
| Global OKR → Area OKR | goals | area_okr |
| Area OKR → KR | goals | kr |
| KR → Project | projects | project |
| Project → Initiative | projects | initiative |

任何情况下，Decomp 的写入操作只涉及 `goals` 表和 `projects` 表。
`tasks` 表由 `/dev` 在 Initiative 执行阶段写入，与 Decomp 完全无关。

**写入任何记录前，必须自问并确认（不可跳过）：**
1. 我要写的是 `goals` 表还是 `projects` 表？（绝不是 `tasks` 表）
2. `type` 字段值是正确的（`kr` / `project` / `initiative`）吗？
3. `parent_id` 或 `kr_id` 指向的是正确的父记录吗？

如果发现自己在构造写入 `tasks` 表的 curl 命令——立刻停止，重新看此 HARD RULE。

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

1. 3-8 个 Initiative per Project
2. 每个 Initiative 独立可部署（不依赖其他 Initiative 才能运行）
3. 不确定的先创建 exploratory Initiative
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

如果回答"不确定" → 先创建 exploratory Initiative 调研，再继续。

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
