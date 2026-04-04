---
id: sprint-contract-proposer-skill
description: /sprint-contract-proposer — Harness v2.0 Layer 2a：Generator 提出 Sprint 合同草案
version: 1.0.0
created: 2026-04-04
---

# /sprint-contract-proposer — Harness Layer 2a: 提合同草案

**角色**: Generator（合同提案方）
**职责**: 读取 PRD 和已完成 Sprint 历史，为本 Sprint 提出合同草案（功能清单+验收标准）。

**重要**：这一步只写合同草案，不写代码。

---

## 输入（从 task payload 获取）

```
sprint_num: <Sprint 编号，从1开始>
sprint_dir: <sprints/sprint-N>
planner_task_id: <Planner task id>
propose_round: <本轮提案轮次，1=首次，2+=带反馈修改>
review_feedback_task_id: <上一轮 review task id，仅 propose_round>1 时存在>
```

## 执行步骤

### Phase 1: 读取上下文

```bash
# 读取 PRD
cat sprints/sprint-prd.md

# 读取已完成 Sprint 的合同（了解进度）
for i in $(seq 1 $((sprint_num - 1))); do
  echo "=== Sprint $i Contract ==="
  cat "sprints/sprint-${i}/sprint-contract.md" 2>/dev/null
done

# 如果是修改轮次，读取上一轮的 review 反馈
if [ "$propose_round" -gt 1 ]; then
  cat "${sprint_dir}/contract-draft.md" 2>/dev/null
  cat "${sprint_dir}/contract-review-feedback.md" 2>/dev/null
fi
```

### Phase 2: 决定本 Sprint 要做什么

基于 PRD 中剩余未完成的功能，选择本 Sprint 最合适的子集：
- 优先做有前置依赖关系的功能（先基础后上层）
- 每个 Sprint 范围不要太大（1-3 个功能点）
- 如果这是最后一个 Sprint，标记 `is_final: true`

### Phase 3: 写合同草案

写入 `${sprint_dir}/contract-draft.md`：

```markdown
# Sprint ${sprint_num} 合同草案（第 ${propose_round} 轮）

## 本 Sprint 实现的功能
- Feature A: <具体描述>
- Feature B: <具体描述>

## 验收标准（DoD）
### Feature A
- [ ] 用户可以 <操作>，系统返回 <结果>
  验证方式: <具体测试步骤>
- [ ] 当 <边界情况> 时，系统 <正确处理>
  验证方式: <测试步骤>

### Feature B
- [ ] ...

## 技术实现方向（高层，非细节）
- <技术选型/关键接口>

## 不在本 Sprint 范围内
- <明确排除项>

## 是否为最后一个 Sprint
is_final: <true/false>
```

### Phase 4: 完成

写入完成后返回。Brain 断链自动创建 sprint_contract_review 任务。

---

## 输出 verdict

```json
{"verdict": "PROPOSED", "contract_draft_path": "sprints/sprint-N/contract-draft.md", "sprint_num": N}
```
