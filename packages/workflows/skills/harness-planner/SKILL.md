---
id: harness-planner-skill
description: |
  Harness Planner — Harness v5 阶段 A Layer 1：把用户需求展开为 Initiative PRD（Golden Path 格式）。
  输出 sprint-prd.md（What，不写 How），供 Proposer GAN 起草 Golden Path 合同。
  v8 起不再拆任务——任务 DAG 由 Proposer 在合同 GAN 确认后从 Golden Path 倒推。
version: 8.2.0
created: 2026-04-08
updated: 2026-05-11
changelog:
  - 8.2.0: Response Schema 段加"Query Parameters"子段 — W22 实证 generator 漂移到 query 名 a/b（PRD 写 base/exp）。补充 query 名约束 + 禁用别名清单，配合 proposer v7.4 强制每个 query 1 条 [BEHAVIOR]
  - 8.1.0: 加"## Response Schema"段 — API 任务必填，强制 planner 把响应字段名/类型 codify 成可机检 oracle，避免 W19/W20 类 generator schema 漂移（{result→sum/product}）。Anthropic harness-design 推荐 contract is law；schema 在 PRD 阶段就锁死，proposer/generator/evaluator 全链下游有 ground truth
  - 8.0.0: Golden Path PRD — 去掉任务拆分（Step 3）；PRD 格式从"功能需求 FR-001"改为 Golden Path（入口→步骤→出口）；journey_type 保留写入 PRD 末尾
  - 7.0.0: Working Skeleton — Step 0.5 journey_type 推断（4 类）+ Skeleton Task 强制首位
  - 6.0.0: Harness v2 M2 — 强制 4-5 Task
  - 5.0.0: Step 0 升级 Brain API 上下文采集 + 歧义自检（9类）
---

> **语言规则: 所有输出必须使用简体中文。严禁日语、韩语或其他语言。**
> **执行规则: 严格按照下面列出的步骤执行。不要搜索/查找其他 skill 文件，直接按本文档流程操作。**

# /harness-planner — Harness v5 Initiative Planner（阶段 A · Layer 1）

**角色**: Planner（Initiative 级规划师）
**对应 task_type**: `harness_initiative`（v2）/ `harness_planner`（v1 兼容）

---

## 核心原则

- **只写 What，不写 How**：PRD 描述用户看到的行为，不描述实现路径
- **Golden Path 优先**：PRD 围绕核心使用场景（入口→关键步骤→出口）组织，不按功能列表
- **不拆任务**：Planner 只写 PRD；任务 DAG 由 Proposer 在合同 GAN 确认后从 Golden Path 倒推

---

## 执行流程

### Step 0: 采集系统上下文（Brain API）

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

### Step 0.5: 推断 journey_type

根据用户请求描述和涉及文件判断：

```
if 涉及 apps/dashboard/ → user_facing
elif 仅涉及 packages/brain/ → autonomous
elif 涉及 packages/engine/（hooks/skills）→ dev_pipeline
elif 涉及远端 agent 协议 / bridge / cecelia-run → agent_remote
elif 同时命中多个 → 取起点最靠前（UI > tick > task dispatch > bridge）
else（无路径线索）→ 默认 autonomous
```

记录：`journey_type: <值>，推断依据：<1 句话>`，写入 PRD 末尾。

---

### Step 1: 歧义自检（9 类扫描）

在输出 PRD 前对需求描述执行扫描：

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

### Step 2: 输出 sprint-prd.md（Golden Path 格式）

```bash
# SPRINT_DIR 由 cecelia-run 通过 prompt 注入（如 sprints/run-20260506-1400）
# 直接使用，无需手动设置
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

## Golden Path（核心场景）

用户/系统从 [入口] → 经过 [关键步骤] → 到达 [出口]

具体：
1. [触发条件]
2. [系统处理]
3. [可观测结果]

## Response Schema（API 任务必填，其他任务标 N/A）

> **目的**：把响应字段 codify 成 oracle，让 proposer 把每个字段转成 `jq -e` 命令，evaluator 真起服务真 curl 真校验。避免 generator 自由发挥 key 名（W19 result→sum / W20 result→product 实证）。
>
> **填法**：
> - 列出所有 endpoint 的 success response shape（key 名/类型/必填性）
> - 列出所有 endpoint 的 error response shape（HTTP code + body shape）
> - 明确禁用字段名清单（避免 generator 用近义词替换）
> - 不允许仅用自然语言描述（"返回结果对象"无效）；必须给字面 JSON 示例

模板：

```
### Endpoint: GET /xxx

**Query Parameters**（v8.2 新增 — 强制约束 query param 名，避免 generator 漂移到 a/b）:
- `<必填 param 名>` (type, 必填): 用途说明
- 例如: `base` (number-as-string, 必填), `exp` (number-as-string, 必填)
- **禁用 query 名**: 列出 generator 容易用错的别名（如禁用 `a/b/x/y/p/q/n/m/input1/input2/v1/v2`）
- **强约束**: generator 必须**字面用** PRD 列出的 query 名；用错 query 名 endpoint 应返 400 或 404

**Success (HTTP 200)**:
```json
{"result": <number>, "operation": "<string字面量 'multiply'>"}
```
- `result` (number, 必填): 计算结果
- `operation` (string, 必填): 字面量 `multiply`，禁用变体 `mul`/`multiplication`/`product`/`op`/`method`

**Error (HTTP 400)**:
```json
{"error": "<string>"}
```
- 必有 `error` key，禁用 `message`/`msg`/`reason` 等替代

**禁用响应字段名**: `sum`/`product`/`value`/`answer`/`data`/`payload`/`response`（generator 不得自由发挥）

**Schema 完整性**: response 顶层 keys 必须**完全等于** `["operation", "result"]`，不允许多余字段
```

非 API 任务（纯内部 Brain 改动 / 数据库迁移 / CI 流程）此段写 `N/A — 任务无 HTTP 响应`。

**关键**：proposer SKILL v7.4 强制每个 Query Parameter 在合同里有 1 条 [BEHAVIOR] 验。Query 名漂移会被 evaluator jq -e + curl 抓住。

## 边界情况

- {异常/空/并发}

## 范围限定

**在范围内**：...
**不在范围内**：...

## 假设

- [ASSUMPTION: ...]

## 预期受影响文件

- `path/to/file`: {为何受影响}

## journey_type: autonomous|user_facing|dev_pipeline|agent_remote
## journey_type_reason: {1 句推断依据}
```

---

### Step 3: push + 返回

```bash
git checkout -b "cp-$(TZ=Asia/Shanghai date +%m%d%H%M)-harness-prd"
git add "$SPRINT_DIR/sprint-prd.md"
git commit -m "feat(harness): Initiative PRD — {目标}"
git push origin HEAD 2>/dev/null || echo "[harness-planner] push skipped (no creds), commit retained on local branch"
```

**最后一条消息**：

```
{"verdict": "DONE", "branch": "cp-...", "sprint_dir": "sprints/run-..."}
```

---

## 常见错误

1. **输出 task-plan.json** → v8 不再拆任务，此文件由 Proposer 在合同 GAN 确认后产出
2. **PRD 仍用功能需求列表格式** → 必须改为 Golden Path 格式（入口→步骤→出口）
3. **写实现细节**（"引入 X 库"、"用 async 模式"）→ 违反 What-only 原则
4. **忘记 journey_type** → 必须在 PRD 末尾标注，Proposer 和 Evaluator 依赖此字段
