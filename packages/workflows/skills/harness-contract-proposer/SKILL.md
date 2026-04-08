---
id: harness-contract-proposer-skill
description: |
  Harness Contract Proposer — Harness v4.1 GAN Layer 2a：
  Generator 角色，读取 PRD，提出合同草案（功能范围 + 行为描述 + 硬阈值 + 验证命令）。
  GAN 对抗核心是 Evaluator 挑战验证命令是否足够严格。
version: 4.1.0
created: 2026-04-08
updated: 2026-04-08
changelog:
  - 4.1.0: 修正 v4.0 错误 — 合同格式恢复验证命令代码块（广谱：curl/npm/psql/playwright），GAN 对抗核心是命令严格性
  - 4.0.0: 错误版本 — 合同只有行为描述+硬阈值，移除了验证命令（破坏 GAN 对抗）
  - 3.0.0: 改名 harness-contract-proposer（原 sprint-contract-proposer）
---

> **语言规则: 所有输出必须使用简体中文。严禁日语、韩语或其他语言。**

# /harness-contract-proposer — Harness v4.1 Contract Proposer

**角色**: Generator（合同起草者）  
**对应 task_type**: `harness_contract_propose`

---

## 职责

读取 sprint-prd.md，提出合同草案。合同必须包含：
- 每个 Feature 的**行为描述**（可观测的外部行为，不引用内部实现）
- 每个 Feature 的**硬阈值**（Evaluator 可量化验证的通过标准）
- 每个 Feature 的**验证命令**（广谱：根据任务类型选 curl/npm test/psql/playwright）

**这是 GAN 对抗的起点**：Generator 提出验证命令，Evaluator 挑战命令是否够严格，直到双方对齐。

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

### Step 2: 写合同草案（必须包含验证命令）

合同的核心是**每个 Feature 配套广谱验证命令**——根据任务类型选择合适工具（API 任务用 curl，UI 任务用 playwright，逻辑单元用 npm test，DB 状态用 psql），命令必须可直接执行且返回有意义的 exit code。

写入 `${SPRINT_DIR}/contract-draft.md`：

````markdown
# Sprint Contract Draft (Round {N})

## Feature 1: {功能名}

**行为描述**:
{外部可观测的行为描述，不引用内部代码路径}

**硬阈值**:
- `{字段名}` 不为 null
- 响应包含 `{字段}` 字段，值符合 {条件}
- {量化条件}

**验证命令**:
```bash
# Happy path 验证
curl -sf "localhost:5221/api/brain/tasks?limit=5" | \
  node -e "
    const tasks = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    if (!Array.isArray(tasks)) throw new Error('FAIL: 不是数组');
    if (!tasks[0]?.status) throw new Error('FAIL: 缺少 status 字段');
    console.log('PASS: ' + tasks.length + ' 个任务，字段验证通过');
  "

# 失败路径验证
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "localhost:5221/api/brain/tasks/nonexistent-id")
[ "$STATUS" = "404" ] && echo "PASS: 不存在资源返回 404" || (echo "FAIL: 期望 404，实际 $STATUS"; exit 1)
```

---

## Feature 2: {功能名}

**行为描述**:
{...}

**硬阈值**:
- {...}

**验证命令**:
```bash
# 根据 Feature 类型选择合适工具（不要全用 curl）：
# API Feature → curl + node -e
# DB Feature → psql cecelia -c "SELECT ..."
# 单元逻辑 → npm test -- --testPathPattern=<模块名>
# UI Feature → playwright test <spec文件>
```
````

**验证命令写作规则**：
- 必须可直接在终端执行，无需额外参数替换（禁止 `{task_id}` 占位符）
- 成功 → exit 0 + `PASS: <说明>`；失败 → exit 非零 + `FAIL: <原因>`
- 每个 Feature 至少 2 条命令（happy path + 至少一个边界/失败路径）
- 根据任务类型选择广谱工具（不要全用 curl）

**禁止在硬阈值中引用内部实现**（如函数名、代码路径）。

### Step 3: 建分支 + push + 回写 Brain

**重要**：在独立 cp-* 分支上 push，不能推 main：

```bash
TASK_ID_SHORT=$(echo "${TASK_ID}" | cut -c1-8)
PROPOSE_BRANCH="cp-harness-propose-r${PROPOSE_ROUND}-${TASK_ID_SHORT}"
git checkout -b "${PROPOSE_BRANCH}" 2>/dev/null || git checkout "${PROPOSE_BRANCH}"
mkdir -p "${SPRINT_DIR}"
git add "${SPRINT_DIR}/contract-draft.md"
git commit -m "feat(contract): round-${PROPOSE_ROUND} draft"
git push origin "${PROPOSE_BRANCH}"
```

**最后一条消息**（字面量 JSON，不要用代码块包裹）：
```
{"verdict": "PROPOSED", "contract_draft_path": "${SPRINT_DIR}/contract-draft.md", "propose_branch": "cp-harness-propose-r1-xxxxxxxx"}
```
