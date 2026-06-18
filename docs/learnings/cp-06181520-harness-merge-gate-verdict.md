# Learning: harness 合并门旁路 — reportNode 自合脱离裁判 verdict

> Issue 61885f9d / Decision de992930 / 分支 cp-0618150831-harness-merge-gate-verdict

### 根本原因

harness 子图（`harness-task.graph.js`）的 pre-merge gate 本身正确：`ci_pass → evaluate → 只有 evaluate_verdict==='PASS' 才 merge_pr`，且有独立裁判复核。但 PR 实际合并存在**旁路入口**绕过裁判：

1. **数据流断点**：`runSubTaskNode`（`harness-initiative.graph.js`）返回的 sub_task 对象没透传子图的 `evaluate_verdict` → reportNode 想 gate 也拿不到裁判结果。
2. **缺 gate**：#3398 "假摔修复" 让 reportNode 自合任何 CI 绿但未合的 PR，然后 `computedVerdict = 所有 merged ? PASS : FAIL`，全程不看 verdict。本意修假 FAIL（裁判 PASS 了但 CI auto-merge 抽风没合），副作用是 CI 绿但裁判 FAIL/未跑的 PR 被强合算 PASS——把 generator v7.5.0（#3342 删 `--auto`）堵掉的同类洞从另一方向开回来。
3. **外部偷合**：`orphan-pr-worker` 的 `hasActiveBrainTask` 只查 `result->>'pr_url'`，但 harness initiative 跑 sub_task 时 PR 还没写进 result → 误判孤儿 → 2h 后合掉还在等 evaluate 的 PR。

**触发链**：子图 evaluate FAIL → fix loop 放弃 → status=failed，但 PR 已 push 且 CI 绿 → reportNode 自合段无条件合 → computedVerdict 看到 merged → 算 PASS。

### 修复

1. `runSubTaskNode` 返回透传 `evaluate_verdict: final.evaluate_verdict ?? null`（打通数据流断点）。
2. reportNode 自合段加 gate：`if (s.evaluate_verdict !== 'PASS') return s`（不自合，保持非 merged → verdict FAIL）。**只 gate 自合，不动 merge-race 纠正段**——后者处理 PR 真被子图合了但 graph state 没刷新的合法 PASS，无 verdict 字段，加 gate 会破坏 #3398 假摔修复。
3. `orphan-pr-worker` 按 `/^cp-\d{8,10}-ws-[0-9a-f]{6,8}/` 分支模式豁免 harness sub_task PR（skip，reason=harness_subtask_pr）。

### 下次预防

- **任何"自动合并"动作必须 gate 在行为裁判 verdict 上**，不能信任 "CI 绿 + 已合" 当 PASS 代理——CI 验代码层，evaluator 验行为层，两层不可互替。
- 修"假 FAIL"时警惕引入"假 PASS"：放宽合并条件前先问"这条路径会不会让没过裁判的东西也合进去"。
- 跨 graph 节点边界传状态时，下游要用的字段必须显式透传，别假设它跟着走。
- [ ] 新增任何 PR 合并入口（worker/graph node/script）时，CI 加断言：harness sub_task PR（cp-*-ws-<hex>）不被该入口在 evaluate_verdict≠PASS 时合并。
- [ ] reportNode computedVerdict 若未来改为信任 merged，需同步确认所有 merged 来源都经过 evaluate PASS。
- [ ] 巡检其余合并入口（shepherd 已豁免 harness_mode；确认无新增旁路）。
