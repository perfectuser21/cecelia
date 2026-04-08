---
id: sprint-contract-proposer-skill
description: /sprint-contract-proposer — Harness v3.1：Generator 提出合同草案（功能+验证命令），GAN 对抗起点
version: 4.0.0
created: 2026-04-04
updated: 2026-04-08
changelog:
  - 4.0.0: 修正 v3.0 错误 — 合同格式恢复包含验证命令（广谱：curl/npm test/psql/playwright），GAN 对抗核心是挑战命令严格性
  - 3.0.0: 合同格式错误改为"行为描述+硬阈值"（已废弃：移除了验证命令，破坏 GAN 对抗核心）
  - 2.0.0: v3.1 — 去掉 sprint_num，验证命令根据任务类型自选（curl/npm/psql/playwright/bash）
  - 1.0.0: 初始版本
---

# /sprint-contract-proposer — Harness v3.1: Generator 提合同草案

**角色**: Generator（合同提案方）
**职责**: 读取 Planner 的 PRD，提出具体的实现合同草案——包含功能范围、技术路线，以及**每个 Feature 的验证命令（广谱：curl/npm test/psql/playwright）**。

**这是 GAN 对抗的起点**：Generator 提出验证命令，Evaluator 挑战命令是否够严格，直到双方对齐。

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

合同草案的核心是**每个 Feature 配套广谱验证命令**——根据任务类型选择合适的工具（API 任务用 curl，UI 任务用 playwright，逻辑单元用 npm test，DB 状态用 psql），命令必须可直接执行且返回有意义的 exit code。

写入 `${sprint_dir}/contract-draft.md`：

````markdown
# 合同草案（第 ${propose_round} 轮）

## 本次实现的功能
- Feature A: <具体描述>
- Feature B: <具体描述>

## 验收标准（DoD）

### Feature A: <功能名>

**行为描述**：<该 Feature 应该做什么，外部可观测行为>

**硬阈值**：
- <具体量化标准，如：API 响应 < 500ms，返回字段包含 task_id>

**验证命令**：
```bash
# Happy path 验证
curl -sf "localhost:5221/api/brain/tasks?limit=5" | \
  node -e "
    const tasks = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    if (!Array.isArray(tasks)) throw new Error('FAIL: 不是数组');
    if (!tasks[0]?.status) throw new Error('FAIL: 缺少 status 字段');
    console.log('PASS: ' + tasks.length + ' 个任务，字段验证通过');
  "

# 边界情况验证
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "localhost:5221/api/brain/tasks/nonexistent-id")
[ "$STATUS" = "404" ] && echo "PASS: 不存在资源返回 404" || (echo "FAIL: 期望 404，实际 $STATUS"; exit 1)
```

### Feature B: <功能名>

**行为描述**：<该 Feature 应该做什么>

**硬阈值**：
- <具体量化标准>

**验证命令**：
```bash
# <根据 Feature 类型选择合适工具>
# API Feature: curl + node
# DB Feature: psql cecelia -c "SELECT ..."
# 单元逻辑: npm test -- --testPathPattern=<模块名>
# UI Feature: playwright test <spec文件>
```

## 技术实现方向（高层）
- <关键技术选型/接口设计>

## 不在本次范围内
- <明确排除项>
````

**验证命令写作规则**：
- 必须可直接在终端执行，无需额外参数替换
- 成功 → exit 0 + `PASS: <说明>`；失败 → exit 非零 + `FAIL: <原因>`
- 每个 Feature 至少 2 条命令（happy path + 至少一个边界/失败路径）
- 根据任务类型选择广谱工具（不要全用 curl）：
  - Brain API 端点 → `curl + node -e`
  - DB 状态 → `psql cecelia -c "..."`
  - 前端 UI → `playwright test`
  - 业务逻辑单元 → `npm test -- --testPathPattern=xxx`

### Phase 3: 持久化草案并完成

写入 `contract-draft.md` 后，立即 git push 使草案跨 worktree 可访问：

```bash
cd "$(git rev-parse --show-toplevel)"
git add "${sprint_dir}/contract-draft.md"
[ -f "${sprint_dir}/contract-review-feedback.md" ] && git add "${sprint_dir}/contract-review-feedback.md"
git commit -m "chore(harness): contract draft round ${propose_round}" || true
git push origin HEAD
```

Brain 断链自动创建 sprint_contract_review 任务（Evaluator 开始挑战验证命令严格性）。

---

## 输出 verdict

```json
{"verdict": "PROPOSED", "contract_draft_path": "sprints/contract-draft.md"}
```
