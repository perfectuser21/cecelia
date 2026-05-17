## Harness Pipeline 稳定化 — verdict 丢失根因 (2026-04-15)

### 根本原因
`cecelia-run.sh` 在调用 webhook 之前抢跑了 `update-task` PATCH，把 task status 直接改为 completed。这让后续 `callback-processor` 和 `routes/execution.js` 的 UPDATE 守卫 `WHERE status='in_progress'` 永远失效 — agent 的 result 从未被写入 `tasks.result` 或 `tasks.payload.last_run_result`。结果最近 50 个 harness_evaluate 任务 84% 都是 result=null。

### 为什么今天的 autonomous + Research Proxy 有效
- 用户给了极粗的 PRD（"稳定当前的 harness pipeline" 5 字）
- Research Subagent（Opus）60 秒内做了深度调研：查 50 个任务统计 + 读 execution.js/callback-processor.js/cecelia-run.sh 代码 + 查 OKR + 查 callback_queue 表实际数据
- Subagent 精确定位根因（不是 verdict retry 不够，是 status 被抢跑），propose 1 个最小修复（4 文件），high confidence
- 主 agent 直接采纳，没问用户，Stage 2 Implementer 按 plan 执行 TDD 红绿

### 对照之前 PR
之前 #2341/#2342/#2343/#2355/#2322 都在假设 tasks.result 已被写入、围绕 retry/cleanup/monitoring 改，全部没碰根因。Research Subagent 的价值：跳出"症状 → 调 retry"的惯性，直接看写入路径。

### 下次预防
- [ ] autonomous 对粗 PRD 的处理模式已验证：Research Subagent → enriched PRD → Implementer 执行 → PR
- [ ] 涉及状态机变更（status transition）时, 优先用白名单而非单值守卫, 避免中间状态被误伤
- [ ] 多个写入入口（cecelia-run.sh + callback-processor + routes/execution）必须一致的时机或单一真相源
