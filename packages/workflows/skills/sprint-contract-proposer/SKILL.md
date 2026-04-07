---
id: sprint-contract-proposer-skill
description: /sprint-contract-proposer — Harness v3.1：Generator 提出合同草案（功能+行为描述+硬阈值），GAN 对抗起点
version: 3.0.0
created: 2026-04-04
updated: 2026-04-07
changelog:
  - 3.0.0: 合同格式重写 — 从"验证命令"改为"行为描述+硬阈值"，Evaluator 自主决定验证方式
  - 2.0.0: v3.1 — 去掉 sprint_num，验证命令根据任务类型自选（curl/npm/psql/playwright/bash）
  - 1.0.0: 初始版本
---

# /sprint-contract-proposer — Harness v3.1: Generator 提合同草案

**角色**: Generator（合同提案方）
**职责**: 读取 Planner 的 PRD，提出具体的实现合同草案——包含功能范围、技术路线、以及**每个 Feature 的行为描述和可量化的硬阈值**。

**这是 GAN 对抗的起点**：Generator 提出合同（行为标准），Evaluator 挑战，直到双方对齐。

---

## 输入（从 task payload 获取）

```
sprint_dir: <文件目录，如 sprints>
planner_task_id: <Planner task id>
propose_round: <本轮提案轮次，1=首次，2+=带反馈修改>
review_feedback_task_id: <上一轮 review task id，仅 propose_round>1 时存在>
```

## 执行步骤

### Phase 1: 读取上下文

```bash
# 读取 PRD
cat "${sprint_dir}/sprint-prd.md"

# 如果是修改轮次，读取上一轮的 review 反馈
if [ "$propose_round" -gt 1 ]; then
  cat "${sprint_dir}/contract-draft.md"
  cat "${sprint_dir}/contract-review-feedback.md"
fi
```

### Phase 2: 写合同草案

合同草案的核心是**行为描述 + 硬阈值**——清晰描述系统在各种情况下应如何运作，以及可量化的验收标准。Evaluator 将根据这些标准自主决定验证方式。

写入 `${sprint_dir}/contract-draft.md`：

```markdown
# 合同草案（第 ${propose_round} 轮）

## 本次实现的功能
- Feature A: <具体描述>
- Feature B: <具体描述>

## 验收标准（DoD）

### Feature A: <功能名>

**行为描述**：
- 当 <触发条件> 时，<系统行为>
- 当 <边界情况/错误输入> 时，<正确处理方式>
- 当 <并发/高负载> 时，<系统表现>

**硬阈值**：
- <具体指标> < <数值>（如：API 响应时间 < 500ms）
- 返回数据必须包含 <字段列表>（如：task_id、status、created_at）
- DB 中对应记录 <字段> 必须更新为 <期望值>
- 失败情况：<无效输入时> 返回 <错误码>，不崩溃
- <其他可量化标准>

**验收判断**：Evaluator 用任意方式验证以上行为是否成立

### Feature B: <功能名>

**行为描述**：
- 当 <触发条件> 时，<系统行为>
- 当 <边界情况> 时，<正确处理>

**硬阈值**：
- <具体量化标准>
- <错误路径的预期行为>

**验收判断**：Evaluator 用任意方式验证以上行为是否成立

## 技术实现方向（高层）
- <关键技术选型/接口设计>

## 不在本次范围内
- <明确排除项>
```

**合同写作规则**：
- 硬阈值必须可量化，禁止"合理"、"正确"、"适当"等模糊词
- 每个 Feature 必须覆盖正常路径 + 至少一个失败/边界路径
- 行为描述使用"当…时，…"格式，明确触发条件和预期结果

### Phase 3: 持久化草案并完成

写入 `contract-draft.md` 后，立即 git push 使草案跨 worktree 可访问：

```bash
cd "${sprint_dir}/.." 2>/dev/null || true
git add "${sprint_dir}/contract-draft.md" "${sprint_dir}/contract-review-feedback.md" 2>/dev/null || git add "${sprint_dir}/contract-draft.md"
git commit -m "chore(harness): contract draft round ${propose_round}" || true
git push origin HEAD
```

Brain 断链自动创建 sprint_contract_review 任务（Evaluator 开始挑战）。

---

## 输出 verdict

```json
{"verdict": "PROPOSED", "contract_draft_path": "sprints/contract-draft.md"}
```
