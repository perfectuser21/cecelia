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
TASK_PAYLOAD=$(curl -s localhost:5221/api/brain/tasks/{TASK_ID} | jq '.payload')
SPRINT_DIR=$(echo $TASK_PAYLOAD | jq -r '.sprint_dir')

cat "${SPRINT_DIR}/sprint-prd.md"
cat "${SPRINT_DIR}/contract-draft.md"
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
# 写最终合同（approved 版）
cp "${SPRINT_DIR}/contract-draft.md" "${SPRINT_DIR}/sprint-contract.md"

curl -X PATCH localhost:5221/api/brain/tasks/{TASK_ID} \
  -H "Content-Type: application/json" \
  -d "{\"status\":\"completed\",\"result\":{\"verdict\":\"APPROVED\",\"contract_path\":\"${SPRINT_DIR}/sprint-contract.md\"}}"
```

**REVISION**：有必须修改项（模糊/遗漏/不可测）。

```bash
# 写反馈文件
cat > "${SPRINT_DIR}/contract-review-feedback.md" << 'FEEDBACK'
# Contract Review Feedback (Round N)

## 必须修改项

### 1. [类型] Feature X — <问题描述>

**问题**: <具体哪里模糊/遗漏>
**影响**: <为什么这让 Evaluator 无法裁定>
**建议**: <如何修改使合同清晰>
FEEDBACK

curl -X PATCH localhost:5221/api/brain/tasks/{TASK_ID} \
  -H "Content-Type: application/json" \
  -d "{\"status\":\"completed\",\"result\":{\"verdict\":\"REVISION\",\"feedback_path\":\"${SPRINT_DIR}/contract-review-feedback.md\",\"issues_count\":N}}"
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
