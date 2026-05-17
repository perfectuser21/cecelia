# Learning: Harness Generator 按 Workstreams 循环产多 PR + Evaluator 按 PR 分别验收

branch: cp-0419172128-harness-multi-ws
date: 2026-04-19

## 背景

LangGraph Harness Pipeline 的 Proposer 已经把合同拆成 `## Workstreams` 区块（WS1/WS2...），但 Generator 节点只跑一次、只提一个 PR（真实案例 task 8b4a13eb 的 #2407 把 WS1+WS2 打包进同一个 PR）。Pipeline=Initiative，Task=PR=Workstream 这条语义在代码里没落地。

## 根本原因

`harness-graph.js` 的 state schema 只有单值 `pr_url / pr_branch / evaluator_verdict / eval_feedback`，Generator/Evaluator 都是「一次性」函数：

- Generator 从 state.eval_feedback 读 Fix 反馈，push 一个 PR，写 state.pr_url。
- Evaluator 对 state.pr_url 跑一次 harness_evaluate，写 state.evaluator_verdict。
- Fix 循环 `evaluator FAIL → generator`，但 Generator 无法知道「只改 WS2 那一条」，只能又把所有 WS 改一遍（或者按 PRD 的任意选择混合提交）。

根因就是 state 没有「每 WS 一个 slot」的数组字段，Generator 缺乏「我现在只负责 WS-N」的作用域限定，Evaluator 也没有「单 PR 一次验收」的入口。

## 下次预防

- [ ] LangGraph state schema 设计时，凡是「循环多次、每次产物需单独跟踪」的字段，默认用数组，不用单值。
- [ ] Fix 循环设计时，上游节点必须有办法从 state 看出「哪些需要重做」，不能只给一个整体 verdict。这次通过 `ws_verdicts` 让 Generator Fix 模式自动只跑 FAIL 的 WS。
- [ ] Docker 节点 prompt 里明确「作用域限定（CRITICAL）」段，告诉 Claude Code「你只负责 WS-N，其他 WS 的代码一行不动」。不给就会混合改。
- [ ] 向后兼容通过「老字段仍保留，值 = 数组的第 0 位」实现，避免一刀切改全量下游代码。
- [ ] Brain 的 `cecelia_events` onStep payload 要把数组字段也序列化进去，否则 Dashboard 拿不到多 WS 状态。

## 改动面

- `packages/brain/src/harness-graph.js`
  - HarnessState 新增 `workstreams / pr_urls / pr_branches / ws_verdicts / ws_feedbacks` 5 个 Annotation。
  - 新增 export `parseWorkstreams(contract)`：正则解析合同 `## Workstreams` 区块，兜底单 WS default。
  - Proposer 节点末尾 `parseWorkstreams(output)` 写入 state.workstreams。
  - Generator 节点按 workstreams 循环产独立 PR，Fix 模式只跑上轮 FAIL 的 WS，prompt 含「作用域限定」段 + 强制分支名含 `wsN`。
  - Evaluator 节点按 pr_urls 循环 `harness_evaluate`，已 PASS 的 WS 直接跳过，无 PR 的 WS 直接 FAIL；汇总 `evaluator_verdict`（全 PASS 才 PASS）。

- `packages/brain/src/harness-graph-runner.js`：onStep 的 state_snapshot 扩展 5 个多 WS 字段。

- `packages/brain/src/routes/harness.js` + `packages/brain/src/routes/status.js`：
  - `buildLangGraphInfo()` 和 `summarizeLangGraphEvents()` 从 cecelia_events 聚合 workstreams / pr_urls / ws_verdicts 返回前端。

- `apps/dashboard/src/pages/harness-pipeline/HarnessPipelineDetailPage.tsx`：新增 `WorkstreamRunsList` 组件，每 WS 一行显示 name + DoD file + PR 链接 + PASS/FAIL + 失败反馈折叠。

- `apps/dashboard/src/pages/harness-pipeline/HarnessPipelinePage.tsx`：列表页 pr 列在多 PR 时显示 "N PRs"，单 PR 保留原 "PR #N" 链接。

- `packages/brain/src/__tests__/harness-graph-multi-ws.test.js`：19 个新单测覆盖 parseWorkstreams / proposer / generator / evaluator 和图级 E2E 多 WS/单 WS 两种场景。

## 验证

- 新测试 19/19 通过
- 原测试（harness-graph.test.js 10, harness-pipelines-list.test.js 9）无回归
- Brain 完整 vitest suite：6175 passed / 34 skipped
- Dashboard 相关 4 个测试文件 49 test 全过
