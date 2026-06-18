# Bug PrepPRD：harness 合并门旁路 — reportNode 自合脱离裁判 verdict

## 症状
harness 子图（harness-task.graph.js）的 pre-merge gate 本身正确：`ci_pass → evaluate → 只有 evaluate_verdict==PASS 才 merge_pr`，且有独立裁判复核。但 reportNode（#3398 "假摔修复"）会把任何 CI 绿但未合的 PR 主动 `gh pr merge`，然后 `computedVerdict = 所有 sub_task merged ? PASS : FAIL`——全程不看裁判 verdict。结果：CI 绿但裁判 FAIL/未跑的 PR 会被强合并并算 PASS，把 v7.5.0 堵掉的同类洞从另一方向开回来。

## 根因假设（已读代码证实）
1. `runSubTaskNode` 返回的 sub_task 对象（harness-initiative.graph.js:1338-1354）**根本没透传 `evaluate_verdict`**——只有 status/pr_url/fix_round/cost_usd/ci_fail_type/evaluator_feedback。reportNode 拿不到裁判 verdict，这是洞的根。
2. reportNode 自合段（:1423-1440）无条件 merge CI 绿的 PR，没有 verdict gate。
3. `computedVerdict`（:1445-1447）仅看 `status === 'merged'`，把"已合"等价为 PASS。
4. orphan-pr-worker.js `hasActiveBrainTask`（:99-111）只查 `result->>'pr_url'`，但 harness initiative 跑 sub_task 时 PR 还没写进 result → 误判为孤儿 → 2h 后合掉还在等 evaluate 的 harness PR。

## 关联上下文
- 相关 Journey：Cecelia Harness Pipeline（唯一线）
- 相关 Issue：61885f9d-5279-43cb-a486-088e842c3fdf（P1）
- 历史决策：generator v7.5.0 删 `--auto`（#3342）；#3398 假摔修复引入自合
- harness sub_task PR 分支可靠模式：`cp-<MMDDHHMM>-ws-<init8>-...`（`-ws-<hex>` 段，普通 /dev 的 cp-slug 不撞）

## 修法
1. **透传 verdict**：`runSubTaskNode` 返回的 sub_task 增加 `evaluate_verdict: final.evaluate_verdict ?? null`。
2. **reportNode 自合 gate**：自合分支（:1426-1440）只在 `s.evaluate_verdict === 'PASS'` 时才执行 `gh pr merge`；否则不自合，保持非 merged（→ computedVerdict 自然 FAIL）。保住 #3398 假摔修复（真 PASS 的能自合），堵住假 PASS（没 PASS 的不许自合算 PASS）。
3. **orphan-pr-worker 豁免**：识别 `/^cp-\d{8,10}-ws-[0-9a-f]{6,8}/` 分支模式 → 跳过（action='skipped', reason='harness_subtask_pr'），不让外部 worker 偷合等裁判的 harness PR。

## Regression Test 计划
- `harness-initiative.graph.js` reportNode 单测：构造 sub_task `{status:'no_pr'/未合, pr_url, evaluate_verdict:'FAIL'}` + CI 绿 → 断言 reportNode **不调用** execFile gh pr merge，且 computedVerdict=FAIL。再构造 evaluate_verdict:'PASS' + 未合 → 断言**调用**自合且 verdict=PASS（保住假摔修复）。
- `runSubTaskNode` 单测：断言返回的 sub_task 含 `evaluate_verdict` 字段。
- `orphan-pr-worker` 单测：分支 `cp-06181506-ws-3f893d17-ws1` → 断言 action='skipped' reason='harness_subtask_pr'，不调用 mergePr。

## 验收标准
- [ ] failing test 先 commit（commit-1）
- [ ] 修复代码让 test 变绿（commit-2）
- [ ] reportNode 自合前校验 evaluate_verdict===PASS
- [ ] sub_task 透传 evaluate_verdict
- [ ] orphan-pr-worker 豁免 harness sub_task PR
- [ ] CI 全绿
