---
id: sprint-contract-reviewer-skill
description: /sprint-contract-reviewer — Harness v2.0 Layer 2b：Evaluator 对抗性审查合同草案
version: 1.0.0
created: 2026-04-04
---

# /sprint-contract-reviewer — Harness Layer 2b: 对抗性审查合同

**角色**: Evaluator（合同审查方）
**职责**: 以对抗性视角审查 Generator 提出的合同草案，找出不清晰的验收标准、遗漏的边界情况、过大的 Sprint 范围。

**心态**: 你是一个严苛的质量门禁，不是合作者。你的目标是让合同无懈可击，让后续代码对抗测试有清晰的标准可依。

---

## 输入

```
sprint_num: <Sprint 编号>
sprint_dir: <sprints/sprint-N>
propose_task_id: <proposer task id>
propose_round: <当前是第几轮审查>
```

## 执行步骤

### Phase 1: 读取合同草案

```bash
cat "${sprint_dir}/contract-draft.md"
cat "sprints/sprint-prd.md"
```

### Phase 2: 对抗性审查

逐条检查，寻找以下问题：

**验收标准问题**：
- 是否有模糊词（"正确"、"合理"、"良好"）？→ 必须量化或给出具体示例
- 是否可以用自动化工具验证？→ 不可验证的标准不合格
- 是否覆盖了失败路径/边界情况？

**范围问题**：
- Sprint 范围是否太大（超过 3 个独立功能）？
- 功能之间是否有未说明的依赖？
- 是否有遗漏的核心功能（对比 PRD）？

**技术风险**：
- 实现方向是否有明显的技术陷阱？
- 是否有需要提前澄清的技术决策？

### Phase 3: 做出判断

**如果合同质量足够高**（验收标准清晰可测、范围合理、无明显遗漏）：
→ APPROVED，写入 `${sprint_dir}/sprint-contract.md`（最终版）

**如果有问题**（任何一条验收标准模糊/不可测/范围太大）：
→ REVISION，写详细反馈到 `${sprint_dir}/contract-review-feedback.md`

### Phase 4a: APPROVED — 写最终合同

将草案升级为最终合同，写入 `${sprint_dir}/sprint-contract.md`（可补充审查意见中的澄清）。

### Phase 4b: REVISION — 写反馈

写入 `${sprint_dir}/contract-review-feedback.md`：

```markdown
# Sprint ${sprint_num} 合同审查反馈（第 ${propose_round} 轮）

## 必须修改的问题
1. [验收标准模糊] Feature A 的"返回正确结果"——什么是正确？请给出具体示例
2. [缺少边界情况] 当用户输入为空时，Feature B 应如何响应？
3. [范围过大] Feature C 应拆分为两个独立功能

## 可选改进
- ...
```

---

## 输出 verdict

APPROVED:
```json
{"verdict": "APPROVED", "contract_path": "sprints/sprint-N/sprint-contract.md", "sprint_num": N}
```

REVISION:
```json
{"verdict": "REVISION", "feedback_path": "sprints/sprint-N/contract-review-feedback.md", "sprint_num": N, "issues_count": 3}
```
