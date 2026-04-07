---
id: sprint-report-skill
description: /sprint-report — Harness v3.0 最终步骤：生成完整报告（PRD目标/对抗轮次/修复清单/成本统计）
version: 1.0.0
created: 2026-04-07
---

> **语言规则: 所有输出必须使用简体中文。严禁日语、韩语或其他语言。**

# /sprint-report — Harness v3.0 最终报告

**角色**: Reporter（报告生成者）
**职责**: 从 DB 读取本次 Harness 所有任务，生成完整的 sprint-report.md，统计对抗轮次、修复清单、成本。
**对应 task_type**: `sprint_report`
**触发时机**: sprint_evaluate PASS → Brain 自动创建此任务

---

## 输入参数

从 Brain 任务 payload 中获取：

| 参数 | 来源 | 说明 |
|------|------|------|
| `sprint_dir` | payload | sprint 文件目录（扁平路径，如 `sprints`） |
| `planner_task_id` | payload | Planner 任务 ID（用于查询同 project 所有任务） |
| `eval_round` | payload | 最终评估轮次（评估了几轮） |
| `harness_mode` | payload | 固定为 true |

---

## 执行流程

### Step 1: 读取本次 Harness 所有任务

```bash
TASK_PAYLOAD=$(curl -s localhost:5221/api/brain/tasks/{TASK_ID} | jq '.payload')
SPRINT_DIR=$(echo $TASK_PAYLOAD | jq -r '.sprint_dir // "sprints"')
PLANNER_TASK_ID=$(echo $TASK_PAYLOAD | jq -r '.planner_task_id')

# 获取 project_id（通过 planner task）
PROJECT_ID=$(curl -s localhost:5221/api/brain/tasks/${PLANNER_TASK_ID} | jq -r '.project_id')

# 查询同 project 的所有 harness 相关任务
curl -s "localhost:5221/api/brain/tasks?project_id=${PROJECT_ID}&limit=100" | jq '[.[] | select(.payload.harness_mode == true)]'
```

从 DB 查询以下任务类型：
- `sprint_planner` — 1个，获取用户原始需求
- `sprint_generate` — 1个，Generator 任务
- `sprint_evaluate` — N个，每轮一个
- `sprint_fix` — M个，每次修复一个

### Step 2: 读取 PRD

```bash
PRD_FILE="${SPRINT_DIR}/sprint-prd.md"
if [ -f "$PRD_FILE" ]; then
  PRD_CONTENT=$(cat "$PRD_FILE")
else
  PRD_CONTENT="（PRD 文件未找到：${PRD_FILE}）"
fi
```

### Step 3: 读取每轮 eval 结果

```bash
# 收集所有 eval-round-N.md
EVAL_SUMMARIES=""
for i in $(seq 1 ${EVAL_ROUND}); do
  EVAL_FILE="${SPRINT_DIR}/eval-round-${i}.md"
  if [ -f "$EVAL_FILE" ]; then
    # 提取每轮的裁决和失败列表
    VERDICT=$(grep "总体结论:" "$EVAL_FILE" | head -1)
    EVAL_SUMMARIES="${EVAL_SUMMARIES}\n### Round ${i}\n${VERDICT}"
  fi
done
```

### Step 4: 统计成本

从 DB 中读取任务的 token/cost 数据：

```javascript
const tasks = await fetch(`localhost:5221/api/brain/tasks?project_id=${PROJECT_ID}&limit=100`).then(r => r.json());
const harnessTasks = tasks.filter(t => t.payload?.harness_mode);

let totalTokens = 0;
let totalCost = 0;

for (const task of harnessTasks) {
  const metrics = task.result?.metrics || task.payload?.metrics || {};
  totalTokens += metrics.input_tokens || 0;
  totalTokens += metrics.output_tokens || 0;
  totalCost += metrics.cost_usd || 0;
}
```

### Step 5: 生成 sprint-report.md

写入 `{sprint_dir}/sprint-report.md`：

```markdown
# Sprint Report — Harness v3.0

生成时间: {timestamp}
项目: {project_id}

## 目标（来自 PRD）

{PRD 产品目标部分，1-3句话}

## 功能清单

{PRD 功能清单，逐条列出}

## 对抗轮次（Evaluator R1-RN 摘要）

| 轮次 | 结论 | 失败项 |
|------|------|--------|
| R1 | FAIL | Feature 1, Feature 3 |
| R2 | FAIL | Feature 3 |
| R3 | PASS | — |

共进行 **{N}** 轮评估，**{M}** 次修复。

## 修复清单（每次 sprint_fix 做了什么）

### Fix R1 → R2
- 修复了：{从 fix task 的 result 提取描述}
- 修复时间：{timestamp}

### Fix R2 → R3
- 修复了：{描述}

## 成本统计

| 任务类型 | 任务数 | Token 消耗 | 费用 (USD) |
|---------|--------|-----------|------------|
| sprint_planner | 1 | {N} | ${X} |
| sprint_generate | 1 | {N} | ${X} |
| sprint_evaluate | {N} | {N} | ${X} |
| sprint_fix | {M} | {N} | ${X} |
| sprint_report | 1 | {N} | ${X} |
| **合计** | — | **{total}** | **${total}** |

## 结论

Harness v3.0 完成。目标需求已通过 {N} 轮对抗验证，所有验证命令通过。
```

### Step 6: git commit + push

```bash
cd "$(git rev-parse --show-toplevel)"
CURRENT_BRANCH=$(git branch --show-current)

git add "${SPRINT_DIR}/sprint-report.md"
git commit -m "feat(report): sprint-report Harness v3.0 完成 — ${EVAL_ROUND} 轮验证"
git push origin "${CURRENT_BRANCH}"

echo "sprint-report.md 已推送到 ${CURRENT_BRANCH}"
```

---

## 输出 JSON（CRITICAL）

**必须**将以下 JSON 作为**最后一条消息**输出：

```
{"verdict": "DONE", "report_path": "sprints/sprint-report.md", "eval_rounds": N, "fix_count": M}
```

---

## 禁止事项

1. **禁止修改 PRD** — 只读取，不修改
2. **禁止修改 eval-round-N.md** — 只读取，不修改
3. **禁止美化数据** — 真实统计，不四舍五入
4. **禁止省略失败项** — 每轮失败的 Feature 必须如实列出
