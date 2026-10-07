## Brain {VERSION} — 通用活动执行器进 main（自 #5783 拆出）

- 新增 `src/orchestrator/activity-{contract,runtime,process,event-sink}.js` 与 CLI `scripts/activity-contract-run.js`：按设计时契约顺序调用 json-stdio-v1 活动，含预算/超时/失败闭集/finalize、可选事件账；内容与草稿 PR #5783（466099e0）逐字一致
- Commander 售后接班、事件账 PG 集成测试与 CI 数据库接线仍留在 #5783
- coding workflow（PR #6020）不再依赖 #5783 分支；`coding_spec` 契约测试改用真实 `parseActivityContract` 回归
