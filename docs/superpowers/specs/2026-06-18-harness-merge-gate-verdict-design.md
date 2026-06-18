# Design：harness 合并门旁路修复 — reportNode 自合脱离裁判 verdict

> Issue: 61885f9d-5279-43cb-a486-088e842c3fdf（P1）
> Decision: de992930-27da-4a04-b50c-da946989ddfd

## 问题

harness 子图（`harness-task.graph.js`）的 pre-merge gate 本身正确：`ci_pass → evaluate → 只有 evaluate_verdict==='PASS' 才 merge_pr`。但 reportNode（`harness-initiative.graph.js`，#3398 "假摔修复"引入）会把任何 CI 绿但未合的 PR 主动 `gh pr merge`，然后 `computedVerdict = 所有 sub_task merged ? PASS : FAIL`——全程不看裁判 verdict。

**精确触发**：子图 `evaluate FAIL`（或未跑完）→ fix loop 放弃 → status=`failed`，但 PR 已 push 且 CI 绿 → reportNode 自合段无条件合 → 算 PASS。

## 根因（读代码证实）

| # | 缺陷 | 位置 |
|---|---|---|
| 1 | 数据流断点：`runSubTaskNode` 跨子图边界丢了 `evaluate_verdict` | `harness-initiative.graph.js:1338-1354` |
| 2 | 缺 gate：自合分支无条件合 CI 绿 PR | `harness-initiative.graph.js:1426-1440` |
| 3 | verdict 推导：`status==='merged'` 等价 PASS | `harness-initiative.graph.js:1445-1447` |
| 4 | 外部偷合：orphan-worker 查不到 harness sub_task PR | `orphan-pr-worker.js:99-111` |

## 修复（三处，纵深防御）

### 1. 透传 verdict（数据流）
`runSubTaskNode` 返回的 sub_task 增加 `evaluate_verdict: final.evaluate_verdict ?? null`。

### 2. 自合 gate（核心洞）
自合分支（:1426-1440）增加 `if (s.evaluate_verdict !== 'PASS') { warn; return s }`——不自合，保持非 merged → computedVerdict 自然 FAIL。

**关键约束（避免过度修复）**：gate 只加在"自合"这个 reportNode 主动行为处。**不动 merge-race 纠正段（:1412-1421）**——那段处理"PR 真被子图合了但 graph state 没刷新"，这些 merged 的 sub_task 没有 evaluate_verdict（回查 GitHub 纠正的）；若要求它们必带 PASS，会把合法 PASS 误判 FAIL，正好破坏 #3398 假摔修复。merge-race 的缝隙（外部偷合）由修复 3 堵。

`computedVerdict` 逻辑保持不变（all merged → PASS）——加 gate 后所有 merged 来源都保证经过 evaluate PASS。

### 3. orphan 豁免（外部偷合）
`orphan-pr-worker.js` candidate 循环开头加分支模式判断：
`/^cp-\d{8,10}-ws-[0-9a-f]{6,8}/` → action=`skipped`, reason=`harness_subtask_pr`，不调 mergePr。

harness sub_task PR 分支可靠模式 `cp-<MMDDHHMM>-ws-<init8>-...`（实证近期分支 `cp-06171703-ws-3f893d17-ws1`），普通 /dev 的 `cp-stamp-<slug>` 不撞。

## 测试策略（单元测试档）

- **reportNode**：`{evaluate_verdict:'FAIL', status≠merged, CI绿}` → 断言不调 execFile gh pr merge 且 computedVerdict=FAIL；`{evaluate_verdict:'PASS', status≠merged}` → 断言调自合且 verdict=PASS（保住假摔修复）
- **runSubTaskNode**：断言返回 sub_task 含 `evaluate_verdict` 字段
- **orphan-pr-worker**：分支 `cp-06181506-ws-3f893d17-ws1` → 断言 skipped/harness_subtask_pr，不调 mergePr

## 边界

- `evaluate_verdict` 取值 PASS/FAIL/null；只 PASS 放行自合
- merge-race 纠正不受影响（不加 gate）
- orphan 正则不匹配旧格式历史分支（不影响，历史分支已合）
