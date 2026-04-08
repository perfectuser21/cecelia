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
# TASK_ID、SPRINT_DIR、PLANNER_BRANCH、PROPOSE_ROUND 由 cecelia-run 通过 prompt 注入，直接使用：
# TASK_ID={TASK_ID}
# SPRINT_DIR={sprint_dir}
# PLANNER_BRANCH={planner_branch}
# PROPOSE_ROUND={propose_round}

# PRD 在 planner 的分支上，fetch 后用 git show 读取（不依赖本地文件是否存在）
git fetch origin "${PLANNER_BRANCH}" 2>/dev/null || true
git show "origin/${PLANNER_BRANCH}:${SPRINT_DIR}/sprint-prd.md" 2>/dev/null || \
  cat "${SPRINT_DIR}/sprint-prd.md"   # fallback：已合并到本分支的场景
```

**如果是修订轮（propose_round > 1）**，读取上轮 Reviewer 的反馈：
```bash
# REVIEW_BRANCH 由 prompt 注入（review_feedback_task_id 对应的任务 result.review_branch）
if [ -n "$REVIEW_BRANCH" ]; then
  git fetch origin "${REVIEW_BRANCH}" 2>/dev/null || true
  git show "origin/${REVIEW_BRANCH}:${SPRINT_DIR}/contract-review-feedback.md" 2>/dev/null || true
fi
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

### Step 3: 建分支 + push + 回写 Brain

**重要**：在独立 cp-* 分支上 push，不能推 main：

```bash
TASK_ID_SHORT=$(echo {TASK_ID} | cut -c1-8)
PROPOSE_BRANCH="cp-harness-propose-r${PROPOSE_ROUND}-${TASK_ID_SHORT}"
git checkout -b "${PROPOSE_BRANCH}" 2>/dev/null || git checkout "${PROPOSE_BRANCH}"
mkdir -p "${SPRINT_DIR}"
git add "${SPRINT_DIR}/contract-draft.md"
git commit -m "feat(contract): round-${PROPOSE_ROUND} draft"
git push origin "${PROPOSE_BRANCH}"
```

**最后一条消息**：
```
{"verdict": "PROPOSED", "contract_draft_path": "sprints/.../contract-draft.md", "propose_branch": "cp-harness-propose-r1-xxxxxxxx"}
```
