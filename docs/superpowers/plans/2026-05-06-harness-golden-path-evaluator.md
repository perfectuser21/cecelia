# Harness Golden Path + Evaluator 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 Harness pipeline 从 feature-driven 改造为 Golden Path E2E-driven：Planner 只写 PRD，Proposer+Reviewer GAN 写含真实验证命令的合同，合同确认后拆任务，每个 Generator 跑完后由 Evaluator 真实验证 DoD，最终跑 E2E 脚本。

**Architecture:** Sprint 1 改三个 SKILL.md（Planner v8 去掉任务拆分、Proposer v7 改 Golden Path 合同格式、新建 Evaluator v1.0）；Sprint 2 改 harness-initiative.graph.js（parsePrdNode 宽容、inferTaskPlanNode 从 propose 分支读 task-plan.json、Phase B 改为串行 Generator→Evaluator 循环）。

**Tech Stack:** Node.js, LangGraph (@langchain/langgraph), PostgreSQL, vitest, Markdown SKILL.md

---

## 文件结构

**Sprint 1（Skill 改动 — 一个 PR）**

| 操作 | 路径 | 说明 |
|---|---|---|
| Modify | `packages/workflows/skills/harness-planner/SKILL.md` | v7→v8：删 Step 3 任务拆分，PRD 改 Golden Path 格式 |
| Modify | `packages/workflows/skills/harness-contract-proposer/SKILL.md` | v6→v7：合同改 Golden Path Steps + 验证命令，GAN 后拆任务 |
| Create | `packages/workflows/skills/harness-evaluator/SKILL.md` | v1.0：Mode A 逐任务 DoD 验证，Mode B 最终 E2E |

**Sprint 2（Brain 编排 — 一个 PR）**

| 操作 | 路径 | 说明 |
|---|---|---|
| Modify | `packages/brain/src/workflows/harness-initiative.graph.js` | parsePrdNode 宽容 + inferTaskPlanNode 读 propose 分支 + 串行 evaluate 循环 |
| Create | `packages/brain/src/__tests__/harness-initiative-evaluate.test.js` | 新节点单元测试 |

---

## Sprint 1 — Skill 改动

### Task 1: harness-planner v8

**Files:**
- Modify: `packages/workflows/skills/harness-planner/SKILL.md`

- [ ] **Step 1: 写失败的内容检查测试**

```bash
cat > /tmp/test-planner-v8.sh << 'EOF'
#!/bin/bash
set -e
FILE="packages/workflows/skills/harness-planner/SKILL.md"

# 必须存在 Golden Path 段
grep -q "Golden Path" "$FILE" || { echo "FAIL: 缺 Golden Path 段"; exit 1; }

# 不能再有 Step 3 任务拆分
grep -q "task-plan.json" "$FILE" && { echo "FAIL: v8 不应再有 task-plan.json"; exit 1; }

# 版本必须是 8.0.0
grep -q "version: 8.0.0" "$FILE" || { echo "FAIL: 版本不是 8.0.0"; exit 1; }

# PRD 格式必须含入口→步骤→出口
grep -q "入口.*步骤.*出口\|Golden Path（核心场景）" "$FILE" || { echo "FAIL: PRD 未改为 Golden Path 格式"; exit 1; }

echo "PASS"
EOF
chmod +x /tmp/test-planner-v8.sh
```

- [ ] **Step 2: 运行测试，确认失败**

```bash
bash /tmp/test-planner-v8.sh
```

预期：`FAIL: 版本不是 8.0.0`（当前是 7.0.0）

- [ ] **Step 3: 写新的 SKILL.md（完整内容）**

```bash
cat > packages/workflows/skills/harness-planner/SKILL.md << 'SKILLEOF'
---
id: harness-planner-skill
description: |
  Harness Planner — Harness v5 阶段 A Layer 1：把用户需求展开为 Initiative PRD（Golden Path 格式）。
  输出 sprint-prd.md（What，不写 How），供 Proposer GAN 起草 Golden Path 合同。
  v8 起不再拆任务——任务 DAG 由 Proposer 在合同 GAN 确认后从 Golden Path 倒推。
version: 8.0.0
created: 2026-04-08
updated: 2026-05-06
changelog:
  - 8.0.0: Golden Path PRD — 去掉任务拆分（Step 3）；PRD 格式从"功能需求 FR-001"改为 Golden Path（入口→步骤→出口）；不再输出 task-plan.json；journey_type 保留写入 PRD 末尾
  - 7.0.0: Working Skeleton — Step 0.5 journey_type 推断（4 类）+ Skeleton Task 强制首位；task-plan.json 根加 journey_type/journey_type_reason
  - 6.0.0: Harness v2 M2 — 增产 task-plan.json（DAG）；强制 4-5 Task
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
git push origin HEAD
```

**最后一条消息**：

```
{"verdict": "DONE", "branch": "cp-...", "sprint_dir": "sprints/run-..."}
```

**⚠️ 注意**：不再输出 task-plan.json。任务拆分由 Proposer 在合同 GAN 确认后完成。

---

## 常见错误

1. **输出 task-plan.json** → v8 不再拆任务，此文件由 Proposer 在合同后产出
2. **PRD 仍用功能需求列表格式** → 必须改为 Golden Path 格式（入口→步骤→出口）
3. **写实现细节**（"引入 X 库"、"用 async 模式"）→ 违反 What-only 原则
4. **忘记 journey_type** → 必须在 PRD 末尾标注，Proposer 和 Evaluator 依赖此字段
SKILLEOF
```

- [ ] **Step 4: 运行测试，确认通过**

```bash
bash /tmp/test-planner-v8.sh
```

预期：`PASS`

- [ ] **Step 5: Commit**

```bash
git add packages/workflows/skills/harness-planner/SKILL.md
git commit -m "feat(harness): planner v8 — 去掉任务拆分，PRD 改为 Golden Path 格式"
```

---

### Task 2: harness-contract-proposer v7

**Files:**
- Modify: `packages/workflows/skills/harness-contract-proposer/SKILL.md`

- [ ] **Step 1: 写失败的内容检查测试**

```bash
cat > /tmp/test-proposer-v7.sh << 'EOF'
#!/bin/bash
set -e
FILE="packages/workflows/skills/harness-contract-proposer/SKILL.md"

grep -q "version: 7.0.0" "$FILE" || { echo "FAIL: 版本不是 7.0.0"; exit 1; }

# 合同格式必须含 Golden Path Steps
grep -q "Golden Path" "$FILE" || { echo "FAIL: 合同格式未改为 Golden Path"; exit 1; }

# 合同必须含验证命令
grep -q "验证命令" "$FILE" || { echo "FAIL: 缺验证命令"; exit 1; }

# GAN 对抗必须含验证命令完整性检查
grep -q "验证命令可否造假\|造假通过\|SELECT count" "$FILE" || { echo "FAIL: GAN 缺验证完整性审查"; exit 1; }

# GAN 收敛后必须输出 task-plan.json
grep -q "GAN 收敛\|APPROVED.*task-plan\|task-plan.json" "$FILE" || { echo "FAIL: 缺合同后拆任务步骤"; exit 1; }

# E2E 验收脚本
grep -q "E2E 验收" "$FILE" || { echo "FAIL: 合同缺 E2E 验收区块"; exit 1; }

echo "PASS"
EOF
chmod +x /tmp/test-proposer-v7.sh
```

- [ ] **Step 2: 运行测试，确认失败**

```bash
bash /tmp/test-proposer-v7.sh
```

预期：`FAIL: 版本不是 7.0.0`（当前是 6.0.0）

- [ ] **Step 3: 写新的 SKILL.md（完整内容）**

```bash
cat > packages/workflows/skills/harness-contract-proposer/SKILL.md << 'SKILLEOF'
---
id: harness-contract-proposer-skill
description: |
  Harness Contract Proposer — Harness v5 GAN Layer 2a：
  读 PRD，GAN 对抗写 Golden Path 合同（每步含真实验证命令）；
  Reviewer APPROVED 后倒推拆 task-plan.json。
version: 7.0.0
created: 2026-04-08
updated: 2026-05-06
changelog:
  - 7.0.0: Golden Path 合同 — 格式从"Feature 1/Feature 2"改为 Golden Path Steps（每步含验证命令）；GAN 新增"验证命令可否造假"审查；合同 GAN 收敛后 Proposer 输出 task-plan.json（从 Golden Path 倒推）
  - 6.0.0: Working Skeleton — is_skeleton 检测；按 journey_type 切换 E2E test 模板（4 种）；contract-dod-ws0.md 加 YAML header
  - 5.0.0: TDD 融合 — 合同产出 3 份产物；Test Contract 索引表；严禁 contract-dod-ws 出现 [BEHAVIOR] 条目
---

> **语言规则: 所有输出必须使用简体中文。严禁日语、韩语或其他语言。**
> **执行规则: 严格按照下面列出的步骤执行。不要搜索/查找其他 skill 文件，直接按本文档流程操作。**

# /harness-contract-proposer — Harness v5 Contract Proposer

**角色**: Generator（合同起草者）
**对应 task_type**: `harness_contract_propose`

---

## 职责

读取 `sprint-prd.md`，提出 **Golden Path 合同**（每步含真实验证命令 + 完整 E2E 脚本）。
产出：

1. **`${SPRINT_DIR}/contract-draft.md`** — Golden Path Steps 合同，每步含验证命令 + 硬阈值，末尾含 E2E 验收脚本
2. **`${SPRINT_DIR}/contract-dod-ws{N}.md`** — 每个 workstream 的 DoD（只装 [ARTIFACT] 条目）
3. **`${SPRINT_DIR}/tests/ws{N}/*.test.ts`** — 真实失败测试（TDD Red 阶段）

GAN 收敛（Reviewer APPROVED）后输出第 4 件：
4. **`${SPRINT_DIR}/task-plan.json`** — 从 Golden Path 倒推的任务 DAG

**GAN 对抗核心**：
- Reviewer 审合同是否覆盖 Golden Path 全程
- Reviewer 审验证命令是否能造假通过（核心新增）
- GAN 轮次无上限，直到 Reviewer APPROVED

---

## DoD 分家规则

| 类型 | 住哪 | 说明 |
|---|---|---|
| **[ARTIFACT]** | `contract-dod-ws{N}.md` | 静态产出物：文件/内容/配置 |
| **[BEHAVIOR]** | `tests/ws{N}/*.test.ts` 的 `it()` 块 | 运行时行为：API 响应/函数返回 |

---

## 执行流程

### Step 1: 读取 PRD

```bash
git fetch origin "${PLANNER_BRANCH}" 2>/dev/null || true
git show "origin/${PLANNER_BRANCH}:${SPRINT_DIR}/sprint-prd.md" 2>/dev/null || \
  cat "${SPRINT_DIR}/sprint-prd.md"
```

读取 journey_type（从 PRD 末尾）：
```bash
JOURNEY_TYPE=$(grep -m1 "^## journey_type:" "${SPRINT_DIR}/sprint-prd.md" | sed 's/## journey_type: //' | tr -d ' ') || JOURNEY_TYPE="autonomous"
```

如果是修订轮（propose_round > 1），读取 Reviewer 反馈：
```bash
if [ -n "$REVIEW_BRANCH" ]; then
  git fetch origin "${REVIEW_BRANCH}" 2>/dev/null || true
  git show "origin/${REVIEW_BRANCH}:${SPRINT_DIR}/contract-review-feedback.md" 2>/dev/null || true
fi
```

---

### Step 2: 写合同草案（Golden Path 格式）

写入 `${SPRINT_DIR}/contract-draft.md`：

````markdown
# Sprint Contract Draft (Round {N})

## Golden Path
[入口] → [步骤1] → [步骤2] → [出口]

### Step 1: {触发描述}

**可观测行为**: {外部可见的结果，不写实现}

**验证命令**:
```bash
# 具体可执行命令，Evaluator 直接跑
curl localhost:5221/api/brain/tasks/$TASK_ID | jq '.status'
# 期望：completed
```

**硬阈值**: status = completed，耗时 < 5s

---

### Step 2: {系统处理描述}

**可观测行为**: {...}

**验证命令**:
```bash
psql $DB -c "SELECT count(*) FROM brain_alerts WHERE task_id='$TASK_ID'"
# 期望：count = 1
```

**硬阈值**: count ≥ 1，2 小时内不重复

---

### Step N: {出口描述}

**可观测行为**: {...}
**验证命令**: `...`
**硬阈值**: ...

---

## E2E 验收（最终 Evaluator 跑）

**journey_type**: {autonomous|user_facing|dev_pipeline|agent_remote}

**完整验证脚本**:
```bash
#!/bin/bash
set -e

# 1. 注入测试数据 / 触发入口
TASK_ID=$(psql $DB -t -c "INSERT INTO tasks (task_type, status, payload) VALUES ('test_event', 'queued', '{}') RETURNING id" | tr -d ' ')

# 2. 触发处理（或等待 tick）
curl -X POST localhost:5221/api/brain/scan-timeout

# 3. 验证终态
COUNT=$(psql $DB -t -c "SELECT count(*) FROM brain_alerts WHERE task_id='$TASK_ID'" | tr -d ' ')
[ "$COUNT" -ge 1 ] || exit 1

echo "✅ Golden Path 验证通过"
```

**通过标准**: 脚本 exit 0

---

## Workstreams

workstream_count: {N}

### Workstream 1: {标题}

**范围**: {清晰的实现边界}
**大小**: S(<100行) / M(100-300行) / L(>300行)
**依赖**: 无 / Workstream X 完成后

**BEHAVIOR 覆盖测试文件**: `tests/ws1/xxx.test.ts`

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| WS1 | `tests/ws1/xxx.test.ts` | {行为列表} | WS1 → N failures |
````

**验证命令写作规范**（Reviewer 重点检查）：

- 命令必须可直接执行（含 $DB/$TASK_ID 等环境变量须可替换）
- 禁止 `echo "ok"` / `true` 假验证
- 禁止只检查文件存在（不能验运行时行为）
- SELECT count(*) 必须配合时间窗口防造假（如 `AND created_at > NOW() - interval '1 minute'`）

---

### Step 2b: 写 contract-dod-ws{N}.md

```bash
mkdir -p "${SPRINT_DIR}"

cat > "${SPRINT_DIR}/contract-dod-ws1.md" << 'DODEOF'
---
skeleton: false
journey_type: {journey_type}
---
# Contract DoD — Workstream 1: {标题}

**范围**: {实现边界}
**大小**: S/M/L
**依赖**: 无 / Workstream X

## ARTIFACT 条目

- [ ] [ARTIFACT] {文件/配置存在}
  Test: node -e "const c=require('fs').readFileSync('{path}','utf8');if(!c.includes('{pattern}'))process.exit(1)"

## BEHAVIOR 索引（实际测试在 tests/ws1/）

见 `tests/ws1/xxx.test.ts`，覆盖：
- {行为1}
- {行为2}
DODEOF
```

---

### Step 2c: 写真实失败测试

```bash
mkdir -p "${SPRINT_DIR}/tests/ws1"
cat > "${SPRINT_DIR}/tests/ws1/xxx.test.ts" << 'TESTEOF'
import { describe, it, expect } from 'vitest';
import { targetFunction } from '../../../../packages/brain/src/target-module.js';

describe('Workstream 1 — {功能名} [BEHAVIOR]', () => {
  it('{行为1}', async () => {
    const result = await targetFunction({ input: 'x' });
    expect(result).toBe('expected_value');
  });

  it('{行为2}', async () => {
    await expect(targetFunction({ bad: true })).rejects.toThrow('expected error');
  });
});
TESTEOF

# 确认 Red evidence
npx vitest run "${SPRINT_DIR}/tests/ws1/" --reporter=verbose 2>&1 | tee /tmp/ws1-red.log || true
grep -E "FAIL|failed|✗" /tmp/ws1-red.log || { echo "ERROR: 测试未产生 Red"; exit 1; }
```

---

### Step 3: GAN 收敛后拆 task-plan.json

当 Reviewer 输出 `APPROVED` 后执行（每轮 REVISION 跳过此步，继续对抗）：

从 Golden Path Steps 倒推拆任务：

**拆分规则**：
- 每个 Golden Path Step → 对应 1-N 个 Task（按 LOC 估算）
- 每个 Task 预估 < 200 行（soft limit）；> 400 行强制拆分
- 线性依赖链：task2 depends_on task1

```bash
cat > "${SPRINT_DIR}/task-plan.json" << 'JSONEOF'
{
  "initiative_id": "pending",
  "journey_type": "{journey_type}",
  "journey_type_reason": "{1 句推断依据}",
  "tasks": [
    {
      "task_id": "ws1",
      "title": "{对应 Golden Path Step 1 的实现}",
      "scope": "{What，不写 How}",
      "dod": [
        "[BEHAVIOR] {可运行验证，对应合同 Step 1 验证命令}",
        "[ARTIFACT] {文件存在}"
      ],
      "files": ["{预期受影响文件}"],
      "depends_on": [],
      "complexity": "S|M|L",
      "estimated_minutes": 30
    },
    {
      "task_id": "ws2",
      "title": "{对应 Golden Path Step 2 的实现}",
      "scope": "...",
      "dod": ["[BEHAVIOR] ..."],
      "files": ["..."],
      "depends_on": ["ws1"],
      "complexity": "M",
      "estimated_minutes": 45
    }
  ]
}
JSONEOF
```

**字段约束**（同 harness-planner v7 schema）：
- `task_id`: ws1/ws2/... 逻辑 ID（Brain 入库时映射 UUID）
- `estimated_minutes`: 20 ≤ n ≤ 60
- `dod`: 至少 1 个 `[BEHAVIOR]`
- `depends_on`: 线性链即可（ws2 depends_on ws1，无需重复列 ws1 以前的所有依赖）

---

### Step 4: 建分支 + push + 输出 verdict

```bash
TASK_ID_SHORT=$(echo "${TASK_ID}" | cut -c1-8)
PROPOSE_BRANCH="cp-harness-propose-r${PROPOSE_ROUND}-${TASK_ID_SHORT}"
git checkout -b "${PROPOSE_BRANCH}" 2>/dev/null || git checkout "${PROPOSE_BRANCH}"

git add "${SPRINT_DIR}/contract-draft.md" \
        "${SPRINT_DIR}/contract-dod-ws"*.md \
        "${SPRINT_DIR}/tests/ws"*/ \
        "${SPRINT_DIR}/task-plan.json"   # 仅 GAN APPROVED 后才有此文件

git commit -m "feat(contract): round-${PROPOSE_ROUND} Golden Path draft + DoD + tests + task-plan"
git push origin "${PROPOSE_BRANCH}"
```

**最后一条消息**（GAN APPROVED 后）：

```
{"verdict": "PROPOSED", "contract_draft_path": "${SPRINT_DIR}/contract-draft.md", "propose_branch": "cp-harness-propose-r1-xxxxxxxx", "workstream_count": N, "test_files_count": M, "task_plan_path": "${SPRINT_DIR}/task-plan.json"}
```

---

## GAN 对抗焦点（Reviewer 重点审查项）

除"做没做对的事"外，Reviewer 还必须审查**验证命令是否能造假通过**：

- "这个 `SELECT count(*)` 没有时间窗口约束，手动 INSERT 一条就绕过，需加 `AND created_at > NOW() - interval '5 minutes'`"
- "Playwright 脚本缺 `await expect(locator).toBeVisible()` 超时，可能假绿"
- "验证命令依赖 `$TASK_ID` 但前面没有 INSERT 步骤，环境变量未定义"
- "curl 命令没有 `-f` flag，HTTP 500 也返回 exit 0"

---

## 禁止事项

1. **合同格式用 `## Feature 1 / ## Feature 2`** → v7 必须改为 Golden Path Steps
2. **验证命令用 `echo "ok"` / `true`** → 假验证，Reviewer 必须打回
3. **在 contract-dod-ws{N}.md 出现 [BEHAVIOR] 条目** → CI `dod-structure-purity` 会 exit 1
4. **GAN 未 APPROVED 就输出 task-plan.json** → 任务拆分必须在合同确认后
5. **禁止在 main 分支操作**
SKILLEOF
```

- [ ] **Step 4: 运行测试，确认通过**

```bash
bash /tmp/test-proposer-v7.sh
```

预期：`PASS`

- [ ] **Step 5: Commit**

```bash
git add packages/workflows/skills/harness-contract-proposer/SKILL.md
git commit -m "feat(harness): proposer v7 — Golden Path 合同格式 + 验证命令 + GAN 后拆任务"
```

---

### Task 3: harness-evaluator v1.0（新建）

**Files:**
- Create: `packages/workflows/skills/harness-evaluator/SKILL.md`

- [ ] **Step 1: 写失败的内容检查测试**

```bash
cat > /tmp/test-evaluator-v1.sh << 'EOF'
#!/bin/bash
set -e
FILE="packages/workflows/skills/harness-evaluator/SKILL.md"

# 文件必须存在
test -f "$FILE" || { echo "FAIL: 文件不存在"; exit 1; }

grep -q "version: 1.0.0" "$FILE" || { echo "FAIL: 版本不是 1.0.0"; exit 1; }

# 必须有 Mode A 和 Mode B
grep -q "模式 A\|Mode A" "$FILE" || { echo "FAIL: 缺 Mode A（逐任务 DoD）"; exit 1; }
grep -q "模式 B\|Mode B" "$FILE" || { echo "FAIL: 缺 Mode B（最终 E2E）"; exit 1; }

# 必须按 journey_type 选验证方式
grep -q "user_facing" "$FILE" || { echo "FAIL: 缺 user_facing 路径"; exit 1; }
grep -q "autonomous" "$FILE" || { echo "FAIL: 缺 autonomous 路径"; exit 1; }

# 必须输出 verdict JSON
grep -q '"verdict"' "$FILE" || { echo "FAIL: 缺 verdict JSON 输出格式"; exit 1; }

echo "PASS"
EOF
chmod +x /tmp/test-evaluator-v1.sh
```

- [ ] **Step 2: 运行测试，确认失败**

```bash
bash /tmp/test-evaluator-v1.sh
```

预期：`FAIL: 文件不存在`

- [ ] **Step 3: 创建 SKILL.md（完整内容）**

```bash
mkdir -p packages/workflows/skills/harness-evaluator
cat > packages/workflows/skills/harness-evaluator/SKILL.md << 'SKILLEOF'
---
id: harness-evaluator-skill
description: |
  Harness Evaluator — Harness v5 真实验证层：Generator 跑完后真实验证功能是否完成。
  Mode A：逐任务 DoD 验证（读 contract-dod-ws{N}.md BEHAVIOR 验证命令，逐条执行，PASS/FAIL）。
  Mode B：最终 E2E（按 journey_type 选验证方式，跑合同 E2E 验收脚本，exit 0 = PASS）。
  失败时输出详细反馈，供 Generator 重做（最多 3 次）。
version: 1.0.0
created: 2026-05-06
updated: 2026-05-06
changelog:
  - 1.0.0: 初始版本 — Mode A（逐任务 DoD）+ Mode B（最终 E2E）；按 journey_type 自动选验证方式
---

> **语言规则: 所有输出必须使用简体中文。严禁日语、韩语或其他语言。**
> **执行规则: 严格按照下面列出的步骤执行。**

# /harness-evaluator — Harness v5 Evaluator

**角色**: Evaluator（真实验证层）
**对应 task_type**: `harness_evaluate`

---

## Step 0: 确认模式

读取 task payload（由 Brain graph.js dispatch 时注入）：

```bash
# 这些变量由 Brain 在 prompt 里注入，直接使用
# IS_FINAL_E2E: true = 模式 B，false/缺省 = 模式 A
# SPRINT_DIR: sprint 目录路径
# TASK_ID: 当前任务 ID
# WORKSTREAM_N: workstream 序号（0-based，对应 contract-dod-ws{N}.md）
# JOURNEY_TYPE: autonomous|user_facing|dev_pipeline|agent_remote
```

**路由**：
- `IS_FINAL_E2E === true` → 进入模式 B（最终 E2E）
- 否则 → 进入模式 A（逐任务 DoD）

---

## 模式 A：逐任务 DoD 验证

### Step A1: 读取 DoD 文件，提取验证命令

```bash
DOD_FILE="${SPRINT_DIR}/contract-dod-ws${WORKSTREAM_N}.md"

if [ ! -f "${DOD_FILE}" ]; then
  echo '{"verdict": "FAIL", "reason": "DoD 文件不存在: '"${DOD_FILE}"'"}'
  exit 1
fi

cat "${DOD_FILE}"
```

**提取规则**：
- 扫描所有 `[BEHAVIOR]` 条目下的 `Test:` 字段
- 每个 `Test:` 字段是可执行命令（格式：`manual:node ...` / `tests/ws{N}/xxx.test.ts`）

---

### Step A2: 逐条执行验证命令

对每个 `[BEHAVIOR]` 条目：

```bash
# 格式 1: Test: tests/ws{N}/xxx.test.ts → 用 vitest 跑
if [[ "$TEST_CMD" == tests/* ]]; then
  npx vitest run "$TEST_CMD" --reporter=verbose 2>&1
  EXIT_CODE=$?
fi

# 格式 2: Test: manual:node -e "..." → 直接执行
if [[ "$TEST_CMD" == manual:* ]]; then
  CMD="${TEST_CMD#manual:}"
  eval "$CMD" 2>&1
  EXIT_CODE=$?
fi
```

记录每条命令的 stdout/stderr + exit code。

---

### Step A3: 输出 PASS/FAIL 报告

**全部通过**：

```json
{
  "verdict": "PASS",
  "task_id": "<TASK_ID>",
  "workstream": "<WORKSTREAM_N>",
  "all_dod": "passed",
  "checked": <条目数量>
}
```

**有失败项**：

```json
{
  "verdict": "FAIL",
  "task_id": "<TASK_ID>",
  "workstream": "<WORKSTREAM_N>",
  "failed_items": [
    {
      "behavior": "<[BEHAVIOR] 条目描述>",
      "command": "<执行的命令>",
      "exit_code": 1,
      "output": "<stdout/stderr 末尾 200 字符>"
    }
  ],
  "feedback": "<1-3 句具体修复建议，Generator 可以直接行动>"
}
```

`feedback` 写作规范：
- 指出具体失败原因（"SELECT count(*) 返回 0，说明 brain_alerts 未写入"）
- 给出修复方向（"检查 tick.js scan-timeout 函数是否调用了 insertAlert"）
- 不写"建议检查代码"这类模糊指导

---

## 模式 B：最终 E2E 验证

### Step B1: 读取合同 E2E 验收脚本

```bash
CONTRACT_FILE="${SPRINT_DIR}/contract-draft.md"

if [ ! -f "${CONTRACT_FILE}" ]; then
  echo '{"verdict": "FAIL", "reason": "合同文件不存在: '"${CONTRACT_FILE}"'"}'
  exit 1
fi

# 提取 "## E2E 验收" 区块中的 bash 脚本
awk '/^## E2E 验收/,/^## /' "${CONTRACT_FILE}" | grep -A999 '```bash' | grep -B999 '```' | grep -v '```' > /tmp/e2e-verify.sh

chmod +x /tmp/e2e-verify.sh
```

---

### Step B2: 按 journey_type 执行验证

**autonomous**（psql/curl 脚本）：

```bash
export DB="${DB:-postgresql://localhost/cecelia}"
bash /tmp/e2e-verify.sh 2>&1 | tee /tmp/e2e-result.log
E2E_EXIT=$?
```

**user_facing**（Playwright / Chrome MCP）：

```bash
# 通过 Chrome MCP 打开页面并验证 UI 状态
# 脚本内应包含 Playwright 命令或 Chrome MCP 调用
bash /tmp/e2e-verify.sh 2>&1 | tee /tmp/e2e-result.log
E2E_EXIT=$?
```

**dev_pipeline**（curl 触发 + gh pr view 验证）：

```bash
bash /tmp/e2e-verify.sh 2>&1 | tee /tmp/e2e-result.log
E2E_EXIT=$?
```

**agent_remote**（bridge 回调 + DB 状态）：

```bash
bash /tmp/e2e-verify.sh 2>&1 | tee /tmp/e2e-result.log
E2E_EXIT=$?
```

---

### Step B3: 判断结果并输出

```bash
FAIL_LOG=$(tail -30 /tmp/e2e-result.log 2>/dev/null || echo "")

if [ $E2E_EXIT -eq 0 ]; then
  echo '{"verdict": "PASS", "e2e": "passed", "journey_type": "'"${JOURNEY_TYPE}"'"}'
else
  # 分析 log 定位失败的 Golden Path Step
  echo "{\"verdict\": \"FAIL\", \"exit_code\": ${E2E_EXIT}, \"journey_type\": \"${JOURNEY_TYPE}\", \"log\": \"$(echo "$FAIL_LOG" | head -5 | tr '\n' ' ' | sed 's/\"/\\\"/g')\"}"
fi
```

---

## 输出格式（所有模式）

最后一条消息必须是字面量 JSON，不加 markdown 代码块：

```
{"verdict": "PASS"|"FAIL", ...}
```

Brain graph.js 解析 `verdict` 字段决定下一步：
- `PASS` → 继续下一个 Task（或最终标 phase='done'）
- `FAIL` + fix_count < 3 → 打回 Generator 重做，附 `feedback` 字段
- `FAIL` + fix_count ≥ 3 → Brain 标 phase='failed'，人工介入
SKILLEOF
```

- [ ] **Step 4: 运行测试，确认通过**

```bash
bash /tmp/test-evaluator-v1.sh
```

预期：`PASS`

- [ ] **Step 5: Push + 创建 Sprint 1 PR**

```bash
git add packages/workflows/skills/harness-evaluator/SKILL.md
git commit -m "feat(harness): evaluator v1.0 — 新建 Mode A（逐任务 DoD）+ Mode B（E2E）skill"

git push origin HEAD

gh pr create \
  --title "feat(harness): Golden Path pipeline — planner v8 + proposer v7 + evaluator v1.0" \
  --body "## Summary
- harness-planner v8：去掉任务拆分，PRD 改为 Golden Path 格式
- harness-contract-proposer v7：合同改为 Golden Path Steps + 验证命令；GAN 后拆 task-plan.json
- harness-evaluator v1.0：新建，Mode A 逐任务 DoD + Mode B 最终 E2E

## Test plan
- [ ] planner v8 测试通过（无 task-plan.json，有 Golden Path PRD 格式）
- [ ] proposer v7 测试通过（Golden Path 格式，含验证命令）
- [ ] evaluator v1.0 测试通过（Mode A/B，journey_type 路由）"
```

---

## Sprint 2 — Brain 编排

### Task 4: harness-initiative.graph.js — 串行 Evaluator 循环

**Files:**
- Modify: `packages/brain/src/workflows/harness-initiative.graph.js`
- Create: `packages/brain/src/__tests__/harness-initiative-evaluate.test.js`

**背景**：
当前 graph 在 Phase B 用 fanout 并行跑所有 sub_task，跑完后串行一次 final_e2e。
新设计：Phase B 串行执行（task1 → evaluate1 → task2 → evaluate2...），每个 generator 跑完后 Evaluator 真实验证 DoD，最后再跑 E2E 脚本。

同时需要修复：Planner v8 不再输出 task-plan.json，`parsePrdNode` 需宽容处理；`inferTaskPlanNode` 需从 propose 分支读 task-plan.json（Proposer v7 在 GAN 收敛后写入）。

- [ ] **Step 1: 写失败的单元测试**

```bash
cat > packages/brain/src/__tests__/harness-initiative-evaluate.test.js << 'TESTEOF'
/**
 * harness-initiative-evaluate.test.js
 *
 * 测试 Sprint 2 新增的节点：
 * - parsePrdNode: Planner v8 不输出 task-plan.json 时不返回 error
 * - inferTaskPlanNode: 从 propose 分支读 task-plan.json
 * - evaluateSubTaskNode: 解析 PASS/FAIL verdict
 * - routeAfterEvaluate: 路由逻辑（PASS→advance/final, FAIL<3→retry, FAIL≥3→failed）
 * - pickSubTaskNode: 按 task_loop_index 设置 sub_task
 * - advanceTaskIndexNode: 递增 index 并重置 fix_count
 * - retryTaskNode: 递增 fix_count
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db.js', () => ({
  default: { connect: vi.fn(), query: vi.fn() },
}));
vi.mock('../harness-dag.js', () => ({
  parseTaskPlan: vi.fn(),
  upsertTaskPlan: vi.fn().mockResolvedValue({ idMap: {}, insertedTaskIds: [] }),
  topologicalOrder: vi.fn(),
  detectCycle: vi.fn(),
  nextRunnableTask: vi.fn(),
}));
vi.mock('../harness-final-e2e.js', () => ({
  runScenarioCommand: vi.fn(),
  bootstrapE2E: vi.fn(),
  teardownE2E: vi.fn(),
  normalizeAcceptance: vi.fn(),
}));
vi.mock('../harness-shared.js', () => ({
  parseDockerOutput: vi.fn((s) => s),
  loadSkillContent: vi.fn(() => 'SKILL_CONTENT'),
}));
vi.mock('../spawn/index.js', () => ({ spawn: vi.fn() }));
vi.mock('../harness-worktree.js', () => ({ ensureHarnessWorktree: vi.fn().mockResolvedValue('/tmp/wt') }));
vi.mock('../harness-credentials.js', () => ({ resolveGitHubToken: vi.fn().mockResolvedValue('token') }));
vi.mock('../harness-gan-graph.js', () => ({ runGanContractGraph: vi.fn() }));
vi.mock('@langchain/langgraph', () => {
  function Annotation(x) { return x; }
  Annotation.Root = (fields) => fields;
  return {
    StateGraph: class { addNode() { return this; } addEdge() { return this; } addConditionalEdges() { return this; } compile() { return { invoke: vi.fn() }; } },
    Annotation,
    START: '__start__',
    END: '__end__',
    Send: class { constructor(n, s) { this.node = n; this.state = s; } },
    MemorySaver: class {},
  };
});
vi.mock('@langchain/langgraph-checkpoint-postgres', () => ({ PostgresSaver: class { static fromConnString() { return { setup: vi.fn() }; } } }));

import {
  parsePrdNode,
  inferTaskPlanNode,
  evaluateSubTaskNode,
  pickSubTaskNode,
  advanceTaskIndexNode,
  retryTaskNode,
  routeAfterEvaluate,
} from '../workflows/harness-initiative.graph.js';
import { parseTaskPlan } from '../harness-dag.js';
import { parseDockerOutput } from '../harness-shared.js';

// ─── parsePrdNode: Planner v8 宽容测试 ────────────────────────────────────

describe('parsePrdNode (v8 兼容)', () => {
  it('Planner 未输出 task-plan.json 时返回 taskPlan=null，不返回 error', async () => {
    parseTaskPlan.mockImplementationOnce(() => { throw new Error('no json found'); });

    const state = { plannerOutput: '# Sprint PRD\n## Golden Path\n...', worktreePath: '/tmp', task: {} };
    const result = await parsePrdNode(state);

    expect(result.error).toBeUndefined();
    expect(result.taskPlan).toBeNull();
    expect(result.prdContent).toBeTruthy();
  });

  it('Planner 输出了 task-plan.json 时正常解析（向后兼容）', async () => {
    parseTaskPlan.mockReturnValueOnce({
      initiative_id: 'abc',
      tasks: [{ task_id: 'ws1', title: 'T', scope: 'S', dod: ['[BEHAVIOR] x'], files: [], depends_on: [], complexity: 'S', estimated_minutes: 30 }],
    });

    const state = { plannerOutput: '```json\n{"initiative_id":"abc","tasks":[...]}\n```', worktreePath: '/tmp', task: {} };
    const result = await parsePrdNode(state);

    expect(result.taskPlan).not.toBeNull();
    expect(result.error).toBeUndefined();
  });
});

// ─── inferTaskPlanNode: 从 propose 分支读 task-plan.json ──────────────────

describe('inferTaskPlanNode (从 propose 分支读)', () => {
  it('有 propose 分支时用 git show 读取 task-plan.json', async () => {
    parseTaskPlan.mockReturnValueOnce({
      initiative_id: 'abc',
      tasks: [{ task_id: 'ws1', title: 'T', scope: 'S', dod: ['[BEHAVIOR] x'], files: [], depends_on: [], complexity: 'S', estimated_minutes: 30 }],
    });

    const mockExecutor = vi.fn().mockResolvedValue({ exit_code: 0, stdout: '{"initiative_id":"abc","tasks":[{"task_id":"ws1","title":"T","scope":"S","dod":["[BEHAVIOR] x"],"files":[],"depends_on":[],"complexity":"S","estimated_minutes":30}]}', stderr: '' });

    const state = {
      taskPlan: null,
      ganResult: { propose_branch: 'cp-harness-propose-r1-abcd1234' },
      task: { payload: { sprint_dir: 'sprints' } },
      worktreePath: '/tmp/wt',
      initiativeId: 'abc',
      prdContent: '',
    };

    const result = await inferTaskPlanNode(state, { executor: mockExecutor, gitShowMode: true });
    expect(result.taskPlan).not.toBeNull();
    expect(result.taskPlan.tasks).toHaveLength(1);
  });

  it('taskPlan.tasks 已存在时直接返回空 delta', async () => {
    const state = {
      taskPlan: { tasks: [{ task_id: 'ws1' }] },
      ganResult: null,
    };
    const result = await inferTaskPlanNode(state);
    expect(result).toEqual({});
  });
});

// ─── evaluateSubTaskNode ──────────────────────────────────────────────────

describe('evaluateSubTaskNode', () => {
  it('executor 返回 PASS verdict 时解析正确', async () => {
    const mockExecutor = vi.fn().mockResolvedValue({
      exit_code: 0,
      stdout: '{"verdict":"PASS","task_id":"ws1","workstream":"0","all_dod":"passed"}',
      stderr: '',
    });
    parseDockerOutput.mockReturnValue('{"verdict":"PASS","task_id":"ws1","workstream":"0","all_dod":"passed"}');

    const state = {
      taskPlan: { tasks: [{ id: 'ws1', task_id: 'ws1', title: 'T' }], journey_type: 'autonomous' },
      task_loop_index: 0,
      task: { id: 'init-1', payload: { sprint_dir: 'sprints' } },
      worktreePath: '/tmp/wt',
    };

    const result = await evaluateSubTaskNode(state, { executor: mockExecutor });
    expect(result.evaluate_verdict).toBe('PASS');
  });

  it('executor 返回 FAIL verdict 时包含 feedback', async () => {
    const failOutput = '{"verdict":"FAIL","task_id":"ws1","failed_items":[{"behavior":"count >= 1","exit_code":1}],"feedback":"brain_alerts 未写入"}';
    const mockExecutor = vi.fn().mockResolvedValue({ exit_code: 0, stdout: failOutput, stderr: '' });
    parseDockerOutput.mockReturnValue(failOutput);

    const state = {
      taskPlan: { tasks: [{ id: 'ws1', task_id: 'ws1', title: 'T' }], journey_type: 'autonomous' },
      task_loop_index: 0,
      task: { id: 'init-1', payload: { sprint_dir: 'sprints' } },
      worktreePath: '/tmp/wt',
    };

    const result = await evaluateSubTaskNode(state, { executor: mockExecutor });
    expect(result.evaluate_verdict).toBe('FAIL');
    expect(result.evaluate_feedback).toContain('brain_alerts');
  });
});

// ─── pickSubTaskNode ──────────────────────────────────────────────────────

describe('pickSubTaskNode', () => {
  it('按 task_loop_index 取正确的 sub_task', async () => {
    const tasks = [
      { id: 'ws1', task_id: 'ws1', title: 'Task 1' },
      { id: 'ws2', task_id: 'ws2', title: 'Task 2' },
    ];
    const state = { taskPlan: { tasks }, task_loop_index: 1, task_loop_fix_count: 2 };
    const result = await pickSubTaskNode(state);
    expect(result.sub_task.id).toBe('ws2');
    expect(result.task_loop_fix_count).toBe(0); // fix_count 重置
  });
});

// ─── advanceTaskIndexNode + retryTaskNode ─────────────────────────────────

describe('advanceTaskIndexNode', () => {
  it('index +1，fix_count 重置为 0', async () => {
    const state = { task_loop_index: 1, task_loop_fix_count: 2 };
    const result = await advanceTaskIndexNode(state);
    expect(result.task_loop_index).toBe(2);
    expect(result.task_loop_fix_count).toBe(0);
  });
});

describe('retryTaskNode', () => {
  it('fix_count +1', async () => {
    const state = { task_loop_fix_count: 1 };
    const result = await retryTaskNode(state);
    expect(result.task_loop_fix_count).toBe(2);
  });
});

// ─── routeAfterEvaluate ───────────────────────────────────────────────────

describe('routeAfterEvaluate', () => {
  it('PASS + 还有任务 → advance_task', () => {
    const state = {
      evaluate_verdict: 'PASS',
      task_loop_index: 0,
      task_loop_fix_count: 0,
      taskPlan: { tasks: [{ id: 'ws1' }, { id: 'ws2' }] },
    };
    expect(routeAfterEvaluate(state)).toBe('advance_task');
  });

  it('PASS + 最后一个任务 → final_evaluate', () => {
    const state = {
      evaluate_verdict: 'PASS',
      task_loop_index: 1,
      task_loop_fix_count: 0,
      taskPlan: { tasks: [{ id: 'ws1' }, { id: 'ws2' }] },
    };
    expect(routeAfterEvaluate(state)).toBe('final_evaluate');
  });

  it('FAIL + fix_count < MAX_FIX_ROUNDS → retry_task', () => {
    const state = {
      evaluate_verdict: 'FAIL',
      task_loop_index: 0,
      task_loop_fix_count: 1,
      taskPlan: { tasks: [{ id: 'ws1' }] },
    };
    expect(routeAfterEvaluate(state)).toBe('retry_task');
  });

  it('FAIL + fix_count >= MAX_FIX_ROUNDS → failed', () => {
    const state = {
      evaluate_verdict: 'FAIL',
      task_loop_index: 0,
      task_loop_fix_count: 3, // MAX_FIX_ROUNDS = 3
      taskPlan: { tasks: [{ id: 'ws1' }] },
    };
    expect(routeAfterEvaluate(state)).toBe('failed');
  });
});
TESTEOF
```

- [ ] **Step 2: 运行测试，确认失败**

```bash
cd packages/brain
npx vitest run src/__tests__/harness-initiative-evaluate.test.js --reporter=verbose 2>&1 | tail -30
```

预期：多个 FAIL（函数未导出 / 行为不符合预期）

- [ ] **Step 3a: 修改 parsePrdNode — 宽容处理 v8 输出**

定位 `packages/brain/src/workflows/harness-initiative.graph.js` 中的 `parsePrdNode`（约第 599 行），将：

```javascript
export async function parsePrdNode(state) {
  if (state.taskPlan && state.prdContent) {
    return { taskPlan: state.taskPlan, prdContent: state.prdContent };
  }
  let taskPlan;
  try {
    taskPlan = parseTaskPlan(state.plannerOutput);
  } catch (err) {
    return { error: { node: 'parsePrd', message: `parseTaskPlan: ${err.message}` } };
  }
  if (taskPlan.initiative_id === 'pending' || !taskPlan.initiative_id) {
    taskPlan.initiative_id = state.initiativeId;
  }
```

改为：

```javascript
export async function parsePrdNode(state) {
  if (state.taskPlan !== undefined && state.prdContent) {
    return { taskPlan: state.taskPlan, prdContent: state.prdContent };
  }
  let taskPlan = null;
  try {
    taskPlan = parseTaskPlan(state.plannerOutput);
    if (taskPlan.initiative_id === 'pending' || !taskPlan.initiative_id) {
      taskPlan.initiative_id = state.initiativeId;
    }
  } catch {
    // Planner v8 不再输出 task-plan.json — 宽容，由 inferTaskPlanNode 从 propose 分支读
    console.log('[harness-initiative-graph] parsePrd: no task-plan.json in planner output, will infer from propose branch');
  }
```

- [ ] **Step 3b: 修改 inferTaskPlanNode — 先从 propose 分支读 task-plan.json**

定位 `inferTaskPlanNode`（约第 804 行），在 `const executor = opts.executor || spawn;` 之前插入：

```javascript
export async function inferTaskPlanNode(state, opts = {}) {
  const existing = state?.taskPlan?.tasks;
  if (Array.isArray(existing) && existing.length >= 1) {
    return {};
  }

  // 优先：从 Proposer v7 写入的 propose 分支读 task-plan.json
  const proposeBranch = state.ganResult?.propose_branch;
  const sprintDir = state.task?.payload?.sprint_dir || 'sprints';
  if (proposeBranch) {
    try {
      const { execSync } = await import('node:child_process');
      const raw = execSync(
        `git -C "${state.worktreePath}" show "origin/${proposeBranch}:${sprintDir}/task-plan.json" 2>/dev/null`,
        { encoding: 'utf8', timeout: 10000 }
      ).trim();
      if (raw) {
        const plan = parseTaskPlan(raw);
        if (plan.initiative_id === 'pending' || !plan.initiative_id) plan.initiative_id = state.initiativeId;
        console.log(`[harness-initiative-graph] inferTaskPlan: read from propose branch ${proposeBranch}`);
        return { taskPlan: plan };
      }
    } catch (err) {
      console.warn(`[harness-initiative-graph] inferTaskPlan: git show failed (${err.message}), falling back to LLM`);
    }
  }

  // Fallback: 原 LLM 推断逻辑（保留不变）
  const executor = opts.executor || spawn;
  // ... 以下原有代码不变
```

- [ ] **Step 3c: 新增串行 evaluate 相关节点和 state 字段**

在 `FullInitiativeState` 定义（约第 756 行）末尾，在 `report_path` 之后新增：

```javascript
  // 串行 evaluate 循环状态（Phase B sequential G1→E1→G2→E2...）
  task_loop_index:    Annotation({ reducer: (_o, n) => n, default: () => 0 }),
  task_loop_fix_count: Annotation({ reducer: (_o, n) => n, default: () => 0 }),
  evaluate_verdict:   Annotation({ reducer: (_o, n) => n, default: () => null }),
  evaluate_feedback:  Annotation({ reducer: (_o, n) => n, default: () => null }),
```

在 `fanoutSubTasksNode` 之后新增以下函数（约第 893 行后）：

```javascript
// ─── 串行 evaluate 循环节点（Phase B: G→E→G→E...） ─────────────────────────

export async function pickSubTaskNode(state) {
  const tasks = state.taskPlan?.tasks || [];
  const idx = state.task_loop_index || 0;
  if (idx >= tasks.length) return {};
  return { sub_task: tasks[idx], task_loop_fix_count: 0 };
}

export async function evaluateSubTaskNode(state, opts = {}) {
  const tasks = state.taskPlan?.tasks || [];
  const idx = state.task_loop_index || 0;
  if (idx >= tasks.length) return { evaluate_verdict: 'PASS' };

  const subTask = tasks[idx];
  const executor = opts.executor || spawn;
  const sprintDir = state.task?.payload?.sprint_dir || 'sprints';
  const journeyType = state.taskPlan?.journey_type || 'autonomous';
  const skillContent = loadSkillContent('harness-evaluator');

  const prompt = `你是 harness-evaluator agent。按下面 SKILL 指令工作。

${skillContent}

---
## 本次任务参数
task_id: ${subTask.id || subTask.task_id}
sprint_dir: ${sprintDir}
workstream_n: ${idx}
is_final_e2e: false
journey_type: ${journeyType}`;

  let result;
  try {
    result = await executor({
      task: { id: subTask.id || subTask.task_id, task_type: 'harness_evaluate' },
      prompt,
      worktreePath: state.worktreePath,
      env: {
        CECELIA_TASK_TYPE: 'harness_evaluate',
        is_final_e2e: 'false',
        task_id: String(subTask.id || subTask.task_id),
        workstream_n: String(idx),
        sprint_dir: sprintDir,
        journey_type: journeyType,
        GITHUB_TOKEN: state.githubToken || '',
      },
    });
  } catch (err) {
    return { evaluate_verdict: 'FAIL', evaluate_feedback: `executor error: ${err.message}` };
  }

  const stdout = parseDockerOutput(result.stdout || '');
  let verdict = 'FAIL';
  let feedback = stdout.slice(-300);
  try {
    const match = stdout.match(/\{"verdict"\s*:\s*"(PASS|FAIL)"[^}]*\}/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      verdict = parsed.verdict;
      feedback = parsed.feedback || stdout.slice(-300);
    }
  } catch { /* use defaults */ }

  return { evaluate_verdict: verdict, evaluate_feedback: feedback };
}

export async function advanceTaskIndexNode(state) {
  return {
    task_loop_index: (state.task_loop_index || 0) + 1,
    task_loop_fix_count: 0,
    evaluate_verdict: null,
  };
}

export async function retryTaskNode(state) {
  return { task_loop_fix_count: (state.task_loop_fix_count || 0) + 1 };
}

export async function terminalFailNode(state, opts = {}) {
  const dbPool = opts.pool || pool;
  const reason = `Evaluator FAIL: ${state.evaluate_feedback || 'unknown'} (max fix rounds exceeded)`;
  try {
    await dbPool.query(
      `UPDATE initiative_runs SET phase='failed', failure_reason=$2, completed_at=NOW(), updated_at=NOW()
       WHERE initiative_id=$1::uuid`,
      [state.initiativeId, reason.slice(0, 500)]
    );
  } catch (err) {
    console.warn(`[harness-initiative.graph] terminalFailNode db update failed: ${err.message}`);
  }
  return { final_e2e_verdict: 'FAIL' };
}

export async function finalEvaluateDispatchNode(state, opts = {}) {
  const executor = opts.executor || spawn;
  const sprintDir = state.task?.payload?.sprint_dir || 'sprints';
  const journeyType = state.taskPlan?.journey_type || 'autonomous';
  const skillContent = loadSkillContent('harness-evaluator');

  const prompt = `你是 harness-evaluator agent。按下面 SKILL 指令工作。

${skillContent}

---
## 本次任务参数
is_final_e2e: true
sprint_dir: ${sprintDir}
journey_type: ${journeyType}
initiative_id: ${state.initiativeId}`;

  let result;
  try {
    result = await executor({
      task: { id: state.task.id, task_type: 'harness_evaluate' },
      prompt,
      worktreePath: state.worktreePath,
      env: {
        CECELIA_TASK_TYPE: 'harness_evaluate',
        is_final_e2e: 'true',
        sprint_dir: sprintDir,
        journey_type: journeyType,
        GITHUB_TOKEN: state.githubToken || '',
      },
    });
  } catch (err) {
    return {
      final_e2e_verdict: 'FAIL',
      final_e2e_failed_scenarios: [{ name: 'executor error', covered_tasks: [], output: err.message, exitCode: 1 }],
    };
  }

  const stdout = parseDockerOutput(result.stdout || '');
  let verdict = 'FAIL';
  try {
    const match = stdout.match(/\{"verdict"\s*:\s*"(PASS|FAIL)"[^}]*\}/);
    if (match) verdict = JSON.parse(match[0]).verdict;
  } catch { /* use default */ }

  return {
    final_e2e_verdict: verdict,
    final_e2e_failed_scenarios: verdict === 'FAIL'
      ? [{ name: 'E2E script failed', covered_tasks: [], output: stdout.slice(-500), exitCode: 1 }]
      : [],
  };
}

// ─── 串行 evaluate 路由函数 ────────────────────────────────────────────────

export function routeFromPickSubTask(state) {
  const tasks = state.taskPlan?.tasks || [];
  const idx = state.task_loop_index || 0;
  if (idx >= tasks.length) return 'final_evaluate';
  return 'run_sub_task';
}

export function routeAfterEvaluate(state) {
  const tasks = state.taskPlan?.tasks || [];
  const currentIdx = state.task_loop_index || 0;

  if (state.evaluate_verdict === 'PASS') {
    const nextIdx = currentIdx + 1;
    if (nextIdx >= tasks.length) return 'final_evaluate';
    return 'advance_task';
  }

  const fixCount = state.task_loop_fix_count || 0;
  if (fixCount >= MAX_FIX_ROUNDS) return 'failed';
  return 'retry_task';
}
```

- [ ] **Step 3d: 修改 buildHarnessFullGraph — 替换 fanout/join 为串行 evaluate 循环**

找到 `buildHarnessFullGraph`（约第 1068 行），将整个函数替换为：

```javascript
export function buildHarnessFullGraph() {
  return new StateGraph(FullInitiativeState)
    .addNode('prep', prepInitiativeNode)
    .addNode('planner', runPlannerNode)
    .addNode('parsePrd', parsePrdNode)
    .addNode('ganLoop', runGanLoopNode)
    .addNode('inferTaskPlan', inferTaskPlanNode)
    .addNode('dbUpsert', dbUpsertNode)
    .addNode('pick_sub_task', pickSubTaskNode)
    .addNode('run_sub_task', runSubTaskNode)
    .addNode('evaluate', evaluateSubTaskNode)
    .addNode('advance_task', advanceTaskIndexNode)
    .addNode('retry_task', retryTaskNode)
    .addNode('terminal_fail', terminalFailNode)
    .addNode('final_evaluate', finalEvaluateDispatchNode)
    .addNode('report', reportNode)
    .addEdge(START, 'prep')
    .addConditionalEdges('prep', stateHasError, { error: END, ok: 'planner' })
    .addConditionalEdges('planner', stateHasError, { error: END, ok: 'parsePrd' })
    .addConditionalEdges('parsePrd', stateHasError, { error: END, ok: 'ganLoop' })
    .addConditionalEdges('ganLoop', stateHasError, { error: END, ok: 'inferTaskPlan' })
    .addConditionalEdges('inferTaskPlan', stateHasError, { error: END, ok: 'dbUpsert' })
    .addConditionalEdges('dbUpsert', stateHasError, { error: END, ok: 'pick_sub_task' })
    .addConditionalEdges('pick_sub_task', routeFromPickSubTask, { run_sub_task: 'run_sub_task', final_evaluate: 'final_evaluate' })
    .addEdge('run_sub_task', 'evaluate')
    .addConditionalEdges('evaluate', routeAfterEvaluate, {
      advance_task: 'advance_task',
      final_evaluate: 'final_evaluate',
      retry_task: 'retry_task',
      failed: 'terminal_fail',
    })
    .addEdge('advance_task', 'pick_sub_task')
    .addEdge('retry_task', 'run_sub_task')
    .addEdge('terminal_fail', 'report')
    .addConditionalEdges('final_evaluate', _routeAfterFinalE2E, { end: END, report: 'report' })
    .addEdge('report', END);
}
```

**注意**：同时将 `inferTaskPlanNode` 从 dbUpsert 之后移到 ganLoop 之后（`ganLoop → inferTaskPlan → dbUpsert`），因为 dbUpsert 需要 taskPlan。

- [ ] **Step 4: 运行测试，确认通过**

```bash
cd packages/brain
npx vitest run src/__tests__/harness-initiative-evaluate.test.js --reporter=verbose 2>&1
```

预期：所有测试 PASS

- [ ] **Step 5: 补充运行旧测试，确认无回归**

```bash
npx vitest run src/__tests__/harness-initiative-create-fix-task.test.js \
              src/__tests__/harness-dag.test.js \
              src/__tests__/harness-final-e2e.test.js \
              --reporter=verbose 2>&1 | tail -20
```

预期：全部 PASS（无回归）

- [ ] **Step 6: Push + 创建 Sprint 2 PR**

```bash
# 从 main 建新分支
git checkout main
git checkout -b "cp-$(TZ=Asia/Shanghai date +%m%d%H%M)-harness-evaluate-loop"

git add packages/brain/src/workflows/harness-initiative.graph.js \
        packages/brain/src/__tests__/harness-initiative-evaluate.test.js

git commit -m "feat(brain): harness Phase B 改串行 evaluate 循环 — G1→E1→G2→E2→E2E

- parsePrdNode 宽容：Planner v8 不输出 task-plan.json 时不报 error
- inferTaskPlanNode: 优先从 propose 分支读 Proposer v7 写入的 task-plan.json
- 新增 pick_sub_task / evaluate / advance_task / retry_task / terminal_fail / final_evaluate 节点
- buildHarnessFullGraph: 替换 fanout+join 为串行 G→E 循环（最多重试 3 次）"

git push origin HEAD

gh pr create \
  --title "feat(brain): harness Phase B 串行 evaluate 循环 + parsePrdNode v8 兼容" \
  --body "## Summary
- parsePrdNode 宽容：Planner v8 不输出 task-plan.json → 继续而非报错
- inferTaskPlanNode 先从 propose 分支读 task-plan.json（Proposer v7 在 GAN 后写入）
- Phase B 从 fanout 并行改为串行 G1→E1→G2→E2 循环
- 每个 Generator 跑完后 Evaluator 真实验证 DoD，FAIL < 3 次重试，≥ 3 次 phase=failed
- Phase C 改为 dispatch finalEvaluateDispatchNode（跑合同 E2E 脚本，exit 0 = done）

## Test plan
- [ ] harness-initiative-evaluate 测试全部 PASS（8 个新测试）
- [ ] harness-dag / harness-final-e2e / harness-initiative-create-fix-task 无回归
- [ ] CI 全绿"
```

---

## 自检清单

完成所有任务后验证：

- [ ] `packages/workflows/skills/harness-planner/SKILL.md` version = 8.0.0，无 task-plan.json，有 Golden Path PRD 格式
- [ ] `packages/workflows/skills/harness-contract-proposer/SKILL.md` version = 7.0.0，合同格式为 Golden Path Steps，含验证命令，GAN 后拆 task-plan.json
- [ ] `packages/workflows/skills/harness-evaluator/SKILL.md` 存在，version = 1.0.0，有 Mode A + Mode B
- [ ] `buildHarnessFullGraph` 不再含 fanout/join 节点，改为 pick_sub_task → run_sub_task → evaluate 串行循环
- [ ] `parsePrdNode` catch 块不再 return error
- [ ] `inferTaskPlanNode` 先尝试 git show propose 分支，再 LLM fallback
- [ ] 所有新测试 PASS，旧测试无回归
