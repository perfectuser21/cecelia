---
id: harness-contract-reviewer-skill
description: |
  Harness Contract Reviewer — Harness v4.0 GAN Layer 2b：
  Evaluator 角色，对抗性审查合同草案，挑战模糊性和可测性，输出 APPROVED/REVISION。
version: 4.0.0
created: 2026-04-08
updated: 2026-04-08
changelog:
  - 4.0.0: 改名 harness-contract-reviewer（原 sprint-contract-reviewer）
---

> **语言规则: 所有输出必须使用简体中文。严禁日语、韩语或其他语言。**

# /harness-contract-reviewer — Harness v4.0 Contract Reviewer

**角色**: Evaluator（合同审查者）  
**对应 task_type**: `harness_contract_review`

---

## 职责

扮演"挑剔的 Evaluator"，从 Evaluator 视角审查合同草案：
- **每个行为描述清晰吗？** 能根据描述独立设计测试吗？
- **每个硬阈值可量化吗？** 通过/失败界限清晰吗？
- **边界情况定义了吗？** 错误输入、并发、空值如何处理？

---

## 执行流程

### Step 1: 读取草案

```bash
# TASK_ID、SPRINT_DIR、PLANNER_BRANCH、PROPOSE_BRANCH 由 cecelia-run 通过 prompt 注入，直接使用：
# TASK_ID={TASK_ID}
# SPRINT_DIR={sprint_dir}
# PLANNER_BRANCH={planner_branch}
# PROPOSE_BRANCH={propose_branch}（来自 propose 任务的 result.propose_branch）

# fetch 所有相关分支
git fetch origin "${PLANNER_BRANCH}" 2>/dev/null || true
[ -n "$PROPOSE_BRANCH" ] && git fetch origin "${PROPOSE_BRANCH}" 2>/dev/null || true

# 读 PRD（来自 planner 分支）
git show "origin/${PLANNER_BRANCH}:${SPRINT_DIR}/sprint-prd.md" 2>/dev/null || cat "${SPRINT_DIR}/sprint-prd.md"

# 读合同草案（来自 propose 分支）
git show "origin/${PROPOSE_BRANCH}:${SPRINT_DIR}/contract-draft.md" 2>/dev/null || cat "${SPRINT_DIR}/contract-draft.md"
```

### Step 2: 逐条审查（对每个 Feature）

审查维度：
1. **歧义检查**：行为描述是否有多种合理解释？任何一种都能声称合规？
2. **硬阈值完整性**：合同列出的所有字段/条件都有对应阈值吗？
3. **边界情况定义**：空输入、最大值、特殊字符的预期行为明确吗？
4. **可测性**：基于行为描述，Evaluator 能设计独立测试吗（不看源码）？

### Step 3: 写反馈 + 输出 verdict

**APPROVED**：所有 Feature 清晰可测，无歧义，无遗漏。

```bash
# 在独立 review 分支上 push 最终合同
TASK_ID_SHORT=$(echo {TASK_ID} | cut -c1-8)
REVIEW_BRANCH="cp-harness-review-approved-${TASK_ID_SHORT}"
git checkout -b "${REVIEW_BRANCH}" 2>/dev/null || git checkout "${REVIEW_BRANCH}"

# 把草案复制为最终合同（从 propose 分支 checkout）
mkdir -p "${SPRINT_DIR}"
git show "origin/${PROPOSE_BRANCH}:${SPRINT_DIR}/contract-draft.md" > "${SPRINT_DIR}/sprint-contract.md"
git add "${SPRINT_DIR}/sprint-contract.md"
git commit -m "feat(contract): APPROVED — sprint-contract.md finalized"
git push origin "${REVIEW_BRANCH}"
```

**REVISION**：有必须修改项（模糊/遗漏/不可测）。

```bash
# 在独立 review 分支上 push 反馈文件
TASK_ID_SHORT=$(echo {TASK_ID} | cut -c1-8)
REVIEW_BRANCH="cp-harness-review-revision-${TASK_ID_SHORT}"
git checkout -b "${REVIEW_BRANCH}" 2>/dev/null || git checkout "${REVIEW_BRANCH}"
mkdir -p "${SPRINT_DIR}"

cat > "${SPRINT_DIR}/contract-review-feedback.md" << 'FEEDBACK'
# Contract Review Feedback (Round N)

## 必须修改项

### 1. [类型] Feature X — <问题描述>

**问题**: <具体哪里模糊/遗漏>
**影响**: <为什么这让 Evaluator 无法裁定>
**建议**: <如何修改使合同清晰>
FEEDBACK

git add "${SPRINT_DIR}/contract-review-feedback.md"
git commit -m "feat(contract): REVISION — feedback round N"
git push origin "${REVIEW_BRANCH}"
```

**最后一条消息**：

APPROVED：
```
{"verdict": "APPROVED", "contract_path": "sprints/.../sprint-contract.md"}
```

REVISION：
```
{"verdict": "REVISION", "feedback_path": "sprints/.../contract-review-feedback.md", "issues_count": N}
```
