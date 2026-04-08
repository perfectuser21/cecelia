---
id: harness-contract-proposer-skill
description: |
  Harness Contract Proposer — Harness v4.0 GAN Layer 2a：
  Generator 角色，读取 PRD，提出合同草案（功能范围 + 行为描述 + 硬阈值）。
version: 4.0.0
created: 2026-04-08
updated: 2026-04-08
changelog:
  - 4.0.0: 改名 harness-contract-proposer（原 sprint-contract-proposer）
---

> **语言规则: 所有输出必须使用简体中文。严禁日语、韩语或其他语言。**

# /harness-contract-proposer — Harness v4.0 Contract Proposer

**角色**: Generator（合同起草者）  
**对应 task_type**: `harness_contract_propose`

---

## 职责

读取 sprint-prd.md，提出合同草案。合同必须包含：
- 每个 Feature 的**行为描述**（可观测的外部行为，不引用内部实现）
- 每个 Feature 的**硬阈值**（Evaluator 可量化验证的通过标准）

---

## 执行流程

### Step 1: 读取 PRD

```bash
TASK_PAYLOAD=$(curl -s localhost:5221/api/brain/tasks/{TASK_ID} | jq '.payload')
SPRINT_DIR=$(echo $TASK_PAYLOAD | jq -r '.sprint_dir')
PROPOSE_ROUND=$(echo $TASK_PAYLOAD | jq -r '.propose_round // "1"')
REVIEW_FEEDBACK_ID=$(echo $TASK_PAYLOAD | jq -r '.review_feedback_task_id // ""')

cat "${SPRINT_DIR}/sprint-prd.md"
```

**如果是修订轮（propose_round > 1）**，读取上轮 Reviewer 反馈：
```bash
FEEDBACK_FILE="${SPRINT_DIR}/contract-review-feedback.md"
[ -f "$FEEDBACK_FILE" ] && cat "$FEEDBACK_FILE"
```

### Step 2: 写合同草案

```markdown
# Sprint Contract Draft (Round {N})

## Feature 1: {功能名}

**行为描述**:
{外部可观测的行为描述，不引用内部代码路径}

**硬阈值**:
- `{字段名}` 不为 null
- 响应包含 `{字段}` 字段
- {量化条件}

---

## Feature 2: ...
```

**禁止在硬阈值中引用内部实现**（如函数名、代码路径）。

### Step 3: push + 回写 Brain

```bash
git add "${SPRINT_DIR}/contract-draft.md"
git commit -m "feat(contract): round-${PROPOSE_ROUND} draft"
git push origin HEAD

curl -X PATCH localhost:5221/api/brain/tasks/{TASK_ID} \
  -H "Content-Type: application/json" \
  -d "{\"status\":\"completed\",\"result\":{\"verdict\":\"PROPOSED\",\"contract_draft_path\":\"${SPRINT_DIR}/contract-draft.md\"}}"
```

**最后一条消息**：
```
{"verdict": "PROPOSED", "contract_draft_path": "sprints/.../contract-draft.md"}
```
