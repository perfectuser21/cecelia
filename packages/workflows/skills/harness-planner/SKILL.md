---
id: harness-planner-skill
description: |
  Harness Planner — Harness v2 阶段 A Layer 1：把用户需求展开为 Initiative PRD + 可调度 Task DAG。
  输出 sprint-prd.md（What，不写 How）+ task-plan.json（4-5 Task，含 depends_on / dod / files / complexity / estimated_minutes），供 Initiative Runner 入库。
version: 7.0.0
created: 2026-04-08
updated: 2026-05-06
changelog:
  - 7.0.0: Working Skeleton — Step 0.5 journey_type 推断（4 类 journey）+ Skeleton Task 强制首位；task-plan.json 根加 journey_type/journey_type_reason；每个 task 加可选 is_skeleton 字段
  - 6.0.0: Harness v2 M2 — 增产 task-plan.json（DAG）。强制 4-5 Task（>5 需 justification，>8 拒绝）；每 Task 20-60min；必须输出 DAG；task_id 为逻辑 ID（入库时由 Brain 映射 UUID）
  - 5.0.0: Step 0 升级为 Brain API 上下文采集（不读代码实现细节）+ 歧义自检（9类）+ PRD 模板结构化
  - 4.1.0: 新增 Step 0 — 写 PRD 前先读取相关代码文件
  - 4.0.0: Harness v4.0 Planner（独立 skill）
---

> **语言规则: 所有输出必须使用简体中文。严禁日语、韩语或其他语言。**
> **执行规则: 严格按照下面列出的步骤执行。不要搜索/查找其他 skill 文件，直接按本文档流程操作。**

# /harness-planner — Harness v2 Initiative Planner（阶段 A · Layer 1）

**角色**: Planner（Initiative 级规划师）
**对应 task_type**: `harness_initiative`（v2）/ `harness_planner`（v1 兼容）

---

## 核心原则

- **只写 What，不写 How**：PRD 描述用户看到的行为，不描述实现路径
- **Initiative → Task DAG**：Planner 拆分到 Task 级，每 Task 20-60 分钟可完成
- **强制 DAG**：即便是线性任务也必须写成单链 depends_on
- **4-5 Task 硬约束**：> 5 必须在 `justification` 字段说明理由；> 8 Brain 会直接拒收
- **Task LOC 阈值**（Phase 8.3 起 SSOT）：拆 Task 时预估 LOC，从 `curl localhost:5221/api/brain/capacity-budget` 读 `.pr_loc_threshold`：
  - ≤ `.soft`（默认 200）→ 单 Task 单 PR
  - `.soft`-`.hard`（默认 200-400）→ 评估拆分
  - \> `.hard`（默认 400）→ **强制拆分**为多 Task
  - API 不可达 fallback 硬编码 200/400

---

## 执行流程

### Step 0: 采集系统上下文（Brain API — 不读代码实现细节）

```bash
curl localhost:5221/api/brain/context
```

从返回提取：
- **OKR 进度**：当前活跃 KR，判断本任务推进哪个 KR
- **活跃任务**：避免重复
- **最近 PR**：了解系统演进方向
- **有效决策**：PRD 不能与之矛盾

**边界**：只读运行时上下文，不探索代码实现细节。

---

### Step 0.5: 推断 journey_type（Working Skeleton 前置）

根据用户请求描述和涉及文件判断：

```
if 涉及 apps/dashboard/ → user_facing
elif 仅涉及 packages/brain/ → autonomous
elif 涉及 packages/engine/（hooks/skills）→ dev_pipeline
elif 涉及远端 agent 协议 / bridge / cecelia-run → agent_remote
elif 同时命中多个 → 取起点最靠前（UI > tick > task dispatch > bridge）
elif 无法判断 → 默认 autonomous
```

记录：`journey_type: <值>，推断依据：<1 句话>`，写入 task-plan.json 根字段。

---

### Step 1: 歧义自检（9 类扫描）

在拆分 DAG 前对任务描述执行扫描：

| # | 歧义类型 | 检查内容 |
|---|----------|----------|
| 1 | 功能范围 | 哪些功能在范围内，哪些排除 |
| 2 | 数据模型 | 涉及哪些数据结构 |
| 3 | UX 流程 | 用户交互路径 |
| 4 | 非功能需求 | 性能/安全/兼容性 |
| 5 | 集成点 | 依赖哪些外部系统 |
| 6 | 边界情况 | 异常/空状态/并发 |
| 7 | 约束 | 技术栈/框架/部署环境 |
| 8 | 术语 | 关键术语歧义 |
| 9 | 完成信号 | 验收标准 |

无法推断的写 `[ASSUMPTION: ...]` 进 PRD 假设列表。**只有方向性歧义才向用户提问**（预期 0-1 问题）。

---

### Step 2: 输出 sprint-prd.md（What 为主）

```bash
mkdir -p "$SPRINT_DIR"
```

模板（不留占位符）：

```markdown
# Sprint PRD — {目标名称}

## OKR 对齐

- **对应 KR**：KR-{编号}（{标题}）
- **当前进度**：{X}%
- **本次推进预期**：{Y}%

## 背景

{为什么做，关联 OKR/决策}

## 目标

{一句话用户价值}

## User Stories

**US-001**（P0）: 作为 {角色}，我希望 {功能}，以便 {价值}
**US-002**（P1）: 作为 {角色}，我希望 {功能}，以便 {价值}

## 验收场景（Given-When-Then）

**场景 1**（US-001）:
- Given {初始态}
- When {触发}
- Then {期望}

## 功能需求

- **FR-001**: {描述}
- **FR-002**: {描述}

## 成功标准

- **SC-001**: {可量化}
- **SC-002**: {可量化}

## 假设

- [ASSUMPTION: ...]

## 边界情况

- {异常/空/并发}

## 范围限定

**在范围内**: ...
**不在范围内**: ...

## 预期受影响文件

- `path/to/file`: {为何受影响}
```

---

### Step 3: 拆 Task DAG — 输出 task-plan.json

**硬性要求**：
- 目标 4-5 Task；最多 8；>5 必填 `justification`
- 每 Task 20-60 分钟可独立完成
- 每 Task 对应 **1 PR**（后续 Generator 按拓扑序取一个 Task 产一个 PR）
- 必须显式 `depends_on`（线性也要写成 `["上一个 task_id"]`）
- 禁写实现细节（不写 "使用 X 库"、不写 "引入 Y 模式"）

**task-plan.json schema**（严格，Brain `parseTaskPlan` 会校验）：

```json
{
  "initiative_id": "pending",
  "journey_type": "autonomous",
  "journey_type_reason": "仅涉及 packages/brain/ 内部逻辑",
  "justification": "（可选；tasks.length > 5 时必填）为什么需要 N 个 Task",
  "tasks": [
    {
      "task_id": "skeleton",
      "is_skeleton": true,
      "title": "端到端薄片（Skeleton）— <一句话描述全链路跑通目标>",
      "scope": "这个 Task 的范围。描述做什么（What），不写怎么做（How）。",
      "dod": [
        "[BEHAVIOR] 验收点 1（可运行验证）",
        "[ARTIFACT] 文件存在性校验"
      ],
      "files": [
        "packages/brain/migrations/XXX_feature.sql",
        "packages/brain/src/xxx.js"
      ],
      "depends_on": [],
      "complexity": "M",
      "estimated_minutes": 40
    },
    {
      "task_id": "ws2",
      "title": "核心逻辑实现",
      "scope": "...",
      "dod": ["[BEHAVIOR] ..."],
      "files": ["..."],
      "depends_on": ["skeleton"],
      "complexity": "M",
      "estimated_minutes": 50
    }
  ]
}
```

**字段约束**：
- `task_id`: 逻辑 ID（`ws1/ws2/...`），Brain 入库时映射到 UUID
- `depends_on`: 其他 task_id 的数组；不能自指；不能有环
- `complexity`: `S|M|L`
- `estimated_minutes`: `20 ≤ n ≤ 60`（超出重拆）
- `dod`: 至少 1 条，建议至少 1 个 `[BEHAVIOR]`
- `journey_type`: `user_facing|autonomous|dev_pipeline|agent_remote`（Step 0.5 推断，写入根对象）
- `journey_type_reason`: 1 句推断依据
- `is_skeleton`: boolean，第一个 task 必须为 `true`，其余省略

**Working Skeleton 强制规则（不可跳过）**：
1. `tasks[0].task_id` 必须为 `"skeleton"`，`is_skeleton: true`，`depends_on: []`
2. `tasks[0].scope` 描述模板按 journey_type 填写：
   - `user_facing`：端到端薄片：主理人点击 [入口] → 看到 [结果]，中间层可 stub
   - `autonomous`：端到端薄片：注入 [触发事件] → DB 终态出现 [预期字段]，中间层可 stub
   - `dev_pipeline`：端到端薄片：mock task 派发 → PR 创建（或 callback 回写），中间层可 stub
   - `agent_remote`：端到端薄片：Brain 发指令 → bridge log 有回报 + DB 回写，中间层可 stub
3. 所有其他 task 的 `depends_on` 必须包含 `"skeleton"`（直接或传递依赖）
4. skeleton task `estimated_minutes` 设 40，`complexity` 设 M

**输出格式**：stdout 末尾必须用 \`\`\`json ... \`\`\` 代码块包裹 task-plan.json（Brain Runner 会抓取）。

---

### Step 4: push + 返回

```bash
git checkout -b "cp-$(TZ=Asia/Shanghai date +%m%d%H%M)-harness-prd"
git add "$SPRINT_DIR/sprint-prd.md"
git commit -m "feat(harness): Initiative PRD — {目标}"
git push origin HEAD
```

**最后一条消息**：

```
{"verdict": "DONE", "branch": "cp-...", "sprint_dir": "sprints/run-..."}
```

上方代码块中的 `task-plan.json` 必须存在，否则 Runner 会返回 `parseTaskPlan` 错误。

---

## 常见错误

1. **写实现细节**（"引入 X 库"、"用 async 模式"）→ 违反 What-only 原则
2. **Task > 5 没写 justification** → Brain 会拒收
3. **单 Task >60 min** → 重拆
4. **忘记 depends_on 字段**（即使空数组也要写）
5. **task-plan.json 不在 code fence 内** → Runner 抓不到
