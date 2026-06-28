# Harness Pipeline Evaluator Pre-merge Gate 修复

**日期**: 2026-06-28  
**类型**: Bug Fix + Enhancement  
**PR 影响文件**:
- `~/.claude/hooks/post-pr-create.sh` (symlink → zenithjoy-skills)
- `packages/brain/src/workflows/harness-task.graph.js`
- `packages/brain/src/workflows/harness-initiative.graph.js`
- `packages/workflows/skills/harness-planner/SKILL.md`

---

## 问题

`post-pr-create.sh` hook 在任何 `gh pr create` 后无条件调用 `gh pr merge --auto --squash`，包括 harness generator 的 PR。结果：

1. Generator 开 PR → hook 立即 enable auto-merge
2. CI 绿 → GitHub 自动 merge PR
3. `poll_ci` 检测到 `ci_status=merged` → `routeAfterPoll` 直接到 `merge_pr`（跳过 evaluate）
4. 或：evaluator 运行时 PR 已 merge → merged-short-circuit → PASS（不跑测试）
5. 人工 gate 和真实 E2E 验证全被绕过

---

## 设计

### Change 1: post-pr-create.sh — HARNESS_NODE 检测

**文件**: `/Users/administrator/perfect21/zenithjoy-skills/hooks/post-pr-create.sh`

在调用 `gh pr merge --auto` 之前加检测：

```bash
# Harness 容器（generator/evaluator/planner）不启用 auto-merge
# Brain 的 evaluator pre-merge gate 负责验证后才 merge
if [[ -n "${HARNESS_NODE:-}" ]]; then
  echo "Harness ${HARNESS_NODE}: 跳过 auto-merge，evaluator 验证后才 merge" >&2
  echo "PR #${PR_NUMBER} (${REPO}) 已创建。等待 Brain evaluator 处理。" >&2
  exit 0
fi
```

`HARNESS_NODE` 由 `harness-task.graph.js:330` 注入（`generator`/`evaluator`/`planner`）。

### Change 2: harness-planner SKILL.md — review_required 字段

**文件**: `packages/workflows/skills/harness-planner/SKILL.md`（同步到 zenithjoy-skills）

在输出 JSON 加 `review_required` 字段，规则：
- `true` — 新功能/UI 变化（需要人工确认）
- `false` — bug fix/重构（自动 merge）

新格式：
```json
{"verdict": "DONE", "branch": "cp-...", "sprint_dir": "sprints/run-...", "planner_branch": "cp-...", "review_required": false}
```

### Change 3: review_required 状态传播 (harness-initiative.graph.js)

**InitiativeState** 新增 annotation：
```js
review_required: Annotation({ reducer: (_o, n) => n, default: () => false }),
```

**parsePrdNode** 提取（在现有 sprint_dir regex 同一区域）：
```js
const rvMatch = (state.plannerOutput || '').match(/"review_required"\s*:\s*(true|false)/);
const reviewRequired = rvMatch ? rvMatch[1] === 'true' : false;
// 返回 { ..., review_required: reviewRequired }
```

**dbUpsertNode** 写入子任务 payload（在现有 sprint_dir UPDATE 之后）：
```js
if (insertedTaskIds?.length > 0) {
  await client.query(
    `UPDATE tasks SET payload = COALESCE(payload, '{}'::jsonb) || $2::jsonb WHERE id = ANY($1::uuid[])`,
    [insertedTaskIds, JSON.stringify({ review_required: state.review_required })]
  );
}
```

### Change 4: mergePrNode — review_required 门

**TaskState** 新增 annotation：
```js
review_required: Annotation({ reducer: (_o, n) => n, default: () => false }),
```

**mergePrNode** 在实际 merge 之前检测：
```js
const needsReview = state.task?.payload?.review_required === true;
if (needsReview) {
  const reviewPayload = interrupt({
    type: 'await_human_review',
    pr_url: prUrl,
    message: `PR ${prUrl} evaluator PASS，需要人工确认后 merge`,
  });
  // interrupt 返回后收到 human approve → 继续正常 merge 流程
  if (reviewPayload?.approved !== true) {
    return { status: 'failed', error: { node: 'merge_pr', message: 'human review rejected' } };
  }
}
// 正常 gh pr merge --squash --delete-branch
```

---

## 不改的地方

- `evaluateContractNode` 的 merged-short-circuit **保留**（防止 evaluator 运行期间 PR 被外部 merge 导致 checkout 已删分支 → FAIL → fix loop）
- `routeAfterPoll` 的 `ci_status=merged → merge` 路由**保留**（处理 PR 被外部 merge 的幂等出口）

---

## 测试策略

| 类型 | 测试内容 | 位置 |
|------|----------|------|
| Unit | `mergePrNode`: `review_required=true` → `interrupt()` 被调用 | `__tests__/harness-task.graph.test.js` |
| Unit | `mergePrNode`: `review_required=false` → 直接 `gh pr merge` | 同上 |
| Unit | `parsePrdNode`: plannerOutput 含 `review_required:true` → state.review_required=true | `__tests__/harness-initiative.graph.test.js` |
| Smoke | `post-pr-create.sh`: `HARNESS_NODE=generator` → exit 0，不调 gh pr merge | bash 脚本 |
| Syntax | `node --check` on both graph files | CI |

---

## 验收标准

- [ ] Generator PR 创建后，hook 检测 HARNESS_NODE → 不启用 auto-merge
- [ ] Evaluator 正常 checkout PR branch 跑测试（不 short-circuit）
- [ ] `review_required=false` → evaluator PASS 后自动 merge
- [ ] `review_required=true` → evaluator PASS 后 interrupt() 暂停，等人工 approve
- [ ] Brain `node --check` 全通过
- [ ] CI 全绿
