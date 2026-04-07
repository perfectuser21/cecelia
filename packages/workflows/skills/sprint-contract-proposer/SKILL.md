---
id: sprint-contract-proposer-skill
description: /sprint-contract-proposer — Harness v3.1：Generator 提出合同草案（功能+可执行验证命令），GAN 对抗起点
version: 2.0.0
created: 2026-04-04
updated: 2026-04-07
changelog:
  - 2.0.0: v3.1 — 去掉 sprint_num，验证命令根据任务类型自选（curl/npm/psql/playwright/bash）
  - 1.0.0: 初始版本
---

# /sprint-contract-proposer — Harness v3.1: Generator 提合同草案

**角色**: Generator（合同提案方）
**职责**: 读取 Planner 的 PRD，提出具体的实现合同草案——包含功能范围、技术路线、以及**可执行的验证命令**。

**这是 GAN 对抗的起点**：Generator 提出合同，Evaluator 挑战，直到双方对齐。

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

合同草案的核心是**验证命令**——根据任务类型选择合适的验证方式：

| 任务类型 | 验证方式 |
|---------|---------|
| API/后端接口 | `curl` 调真实接口，检查返回值 |
| 数据库状态 | `psql` 查记录 |
| 代码逻辑单元 | `npm test` / `npx vitest run` |
| UI/前端交互 | `playwright` 真实浏览器操作 |
| 文件/配置 | `node -e` 读文件验证内容 |
| 脚本行为 | `bash` 执行脚本看输出 |

写入 `${sprint_dir}/contract-draft.md`：

```markdown
# 合同草案（第 ${propose_round} 轮）

## 本次实现的功能
- Feature A: <具体描述>
- Feature B: <具体描述>

## 验收标准（DoD）

### Feature A
- [ ] <用户行为> → <系统响应>
- [ ] <边界情况> → <正确处理>

**验证命令**：
```bash
# 根据任务类型选择合适命令，exit code 0 = PASS
curl -s http://localhost:5221/api/xxx | jq -e '.field == "expected"'
# 或
npx vitest run src/__tests__/feature-a.test.ts
# 或
psql cecelia -c "SELECT count(*) FROM xxx WHERE yyy" | grep -q "1"
```

### Feature B
- [ ] ...

**验证命令**：
```bash
# ...
```

## 技术实现方向（高层）
- <关键技术选型/接口设计>

## 不在本次范围内
- <明确排除项>
```

### Phase 3: 完成

写入后返回。Brain 断链自动创建 sprint_contract_review 任务（Evaluator 开始挑战）。

---

## 输出 verdict

```json
{"verdict": "PROPOSED", "contract_draft_path": "sprints/contract-draft.md"}
```
