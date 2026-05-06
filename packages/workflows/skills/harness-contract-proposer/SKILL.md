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
# TASK_ID、SPRINT_DIR、PLANNER_BRANCH、PROPOSE_ROUND、INITIATIVE_ID 由 cecelia-run 通过 prompt 注入，直接使用
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
curl -f localhost:5221/api/brain/tasks/$TASK_ID | jq '.status'
# 期望：completed
```

**硬阈值**: status = completed，耗时 < 5s

---

### Step 2: {系统处理描述}

**可观测行为**: {...}

**验证命令**:
```bash
psql $DB -c "SELECT count(*) FROM brain_alerts WHERE task_id='$TASK_ID' AND created_at > NOW() - interval '5 minutes'"
# 期望：count >= 1
```

**硬阈值**: count ≥ 1，5 分钟内写入

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
curl -f -X POST localhost:5221/api/brain/scan-timeout

# 3. 验证终态（带时间窗口防造假）
COUNT=$(psql $DB -t -c "SELECT count(*) FROM brain_alerts WHERE task_id='$TASK_ID' AND created_at > NOW() - interval '5 minutes'" | tr -d ' ')
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

**验证命令写作规范**（Reviewer 重点检查，GAN 对抗焦点）：

- 命令必须可直接执行（含 $DB/$TASK_ID 等环境变量须可替换）
- `SELECT count(*)` 必须配时间窗口（如 `AND created_at > NOW() - interval '5 minutes'`）防止造假通过
- 禁止 `echo "ok"` / `true` 假验证
- curl 必须加 `-f` flag（HTTP 5xx 才返回非0 exit code）
- Playwright 脚本必须含显式 `toBeVisible` / `toHaveText` 断言，不能只 navigate

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

**仅在 Reviewer 输出 APPROVED 时执行**（每轮 REVISION 跳过此步，继续对抗）：

从 Golden Path Steps 倒推拆任务：
- 每个 Golden Path Step → 对应 1-N 个 Task（按 LOC 估算）
- 每个 Task 预估 < 200 行（soft limit）；> 400 行强制拆分
- 线性依赖链：ws2 depends_on ws1

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

**字段约束**：
- `task_id`: ws1/ws2/... 逻辑 ID（Brain 入库时映射 UUID）
- `estimated_minutes`: 20 ≤ n ≤ 60
- `dod`: 至少 1 个 `[BEHAVIOR]`
- `depends_on`: 线性链（ws2 depends_on ws1 即可）

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
