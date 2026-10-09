# 小改动 PrepPRD：接棒收口到状态机层——所有任务终态写入必经 finalizeTask / afterTerminalTransition

Brain 任务 `384de1e7-3373-4441-9ca3-cb922ca6cfbf`（链 bf5088a3 第 2 棒，决策 105a5868 / 69cd802f）。主理人已拍板本链手工完成，任务描述即已确认的 PRD。

## 改什么

1. 新增 `packages/brain/src/lib/task-terminal.js`——任务终态写入的唯一收口：
   - `finalizeTask(db, taskId, status, opts)`：把任务写成终态（completed / completed_no_pr / failed / archived）的唯一 SQL 构造器（列白名单、jsonb 合并、CAS 前置状态、额外 WHERE），写完自动跑 `afterTerminalTransition`。
   - `afterTerminalTransition(pool, taskId, status, { sessionId })`：终态钩子。completed / completed_no_pr → 接棒（确保 handoff、落 next_steps）；failed / archived → 不接棒但留统一出口。动态 SQL 写入者（PATCH 路由、回调事务）写完后必须调它。
   - `TASK_STATUS_WRITER_REGISTRY`：参数化 `status = $N` 写入者的登记表（模块、是否可能写终态、理由）。
2. `lib/task-status-transitions.js` 新增 `RELAY_TERMINAL_STATUSES = ['completed','completed_no_pr']`；`lib/relay-baton.js` 的 `relayOnComplete` 改认 RELAY_TERMINAL_STATUSES（completed_no_pr 也接棒）。
3. 仓库内所有字面量直写终态的站点（executor / monitor-loop / crystallize-orchestrator / harness-attempt-run / routes/harness / routes/eval / shepherd / publish-monitor / post-publish-data-collector / postdeploy-verifier / pr-callback-handler / openclaw-agent-executor / routing/device-delegation / dispatcher / worker-pool-dispatch / task-error-report / decision-executor / dispatch-helpers / notion-push-sync）改经 `finalizeTask`。
4. 参数化写入者（routes/tasks.js PATCH、routes/task-task-patch.js PATCH、callback-processor、routes/execution.js 回调、task-updater）写完后调 `afterTerminalTransition`；task-updater 的终态分支直接委托 `finalizeTask`。
5. 机械守卫 `__tests__/task-terminal-write-guard.test.js`：扫描 `src/**/*.js`（排除测试），任何 `UPDATE tasks ... SET ... status = '<终态>'` 出现在 hub 之外 → 红；任何 `status = $N` / `status = $${...}` 的 UPDATE tasks 未登记 → 红；登记为"可能写终态"的模块源码里必须出现 `afterTerminalTransition(` 或 `finalizeTask(` → 否则红。

## 为什么改

09-22 七层审计查实：链式触发只挂在 `PATCH /tasks` 一条路径；executor / monitor-loop / crystallize / attempt-run 等直接 `UPDATE tasks SET status='completed'` 绕过接棒；openclaw-agent 收割写 `completed_no_pr` 而 relay-baton 只认 completed → 秋米任务 100% 不接棒。接力棒 09-23 拍板：completed 必有 handoff，缺则合成标 synthesized。

## 关联上下文

- 决策 105a5868（链 bf5088a3）、69cd802f、2e756506（挂 F1）。
- 前一棒 66db3dfb（parent_task_id / sequence_no 真列）。
- 任务描述里的 ③skill relay 落 step 行 ④work-commander 派发 step 行 ⑤task_dependencies 硬边统一 ⑥断链晨报 AMBER 不在本棒（主会话切分：本棒只做"终态→接棒收口 + completed_no_pr 接棒 + 机械守卫"），进 handoff.next_steps。

## 影响范围

- 行为变化：所有非 PATCH 的 completed 路径现在也会合成 handoff（synthesized）并按 next_steps 登记下一棒；completed_no_pr 同。failed / archived 行为不变（只是改走同一函数）。
- 终态写入统一清 claimed_by / claimed_at，completed 类统一 `completed_at = COALESCE(completed_at, NOW())`。
- 事务内（client）写入的回调路径：UPDATE 留在事务里，接棒钩子在 COMMIT 后用 pool 跑（createRoutedTask 需要 `db.connect()`）。
- 接棒失败一律吞成 warn，不阻塞原调用方。

## 判定点登记表

（本任务无接缝判定点，N/A——纯逻辑 + 静态扫描。）

## 验收标准

- [ ] 守卫测试先红（复现：源码里存在 hub 之外的字面量终态写入）再绿；proven-to-fire：在临时文件里放一条直写终态 SQL，守卫立刻报红。
- [ ] `relay-baton` 单测：status=completed_no_pr 也接棒；in_progress 不接棒。
- [ ] `task-terminal` 单测：finalizeTask 生成的 SQL 含 status 字面量 + claimed 清空 + CAS；relay 钩子被调；failed 不接棒；异常吞成 warn。
- [ ] 全部受影响单测更新通过；brain vitest 全绿（既有环境红：硬连 cecelia 库的集成测试 / bluegreen-deploy-contract，说明即可）。
- [ ] smoke：`packages/brain/scripts/smoke/task-terminal-relay-hub-smoke.sh` 登记 allowlist。
- [ ] CI 全绿（Deploy Preview 503 既有红除外）。
- gp-anchor: skipped (product-map.json not found, non-zenithjoy-workspace repo)
