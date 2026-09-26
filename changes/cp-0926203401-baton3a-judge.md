## Brain {VERSION} — 棒3a 判定：run.finished → 比对探针 → 写回执 → cell 翻色（任务 33aa2bc4）

- 决策 702949b6 / 95e29afd / b56e37b4：task_runs 记"活动发生了"，本棒接"活动做对了"的判定线
- `lib/task-run.js` finishRun 补终态成功后单点 `emit('run.finished','task-run',{runId,taskId,status,result})`（五条执行路径共用，fail-open，只加事件不加写）
- `event-bus.js` 加进程内 `on/off`，`emit` 落库后同步派发给订阅者（订阅者抛错只 warn）
- 新 `lib/business-probe-judge.js`：按 task payload.anchor.journey_id + result.stage 查 `step_probes ⋈ journey_step_links`，op 集合 `>= == <= not_null_all`，expect.value / expect.ref→metrics.<k>；observed 缺失/带 error → FAIL（probe_missing / probe_error）；判定写回执并 UPDATE cell_status（PASS→green / FAIL&error→red / FAIL&warn→pending，同 cell 取最坏）；server.js 启动订阅
- `impact-contract/assertion-receipts.js` 新增 `persistBusinessProbeReceipt`（占位约定：executor_kind=business_probe_runner、source_repo=zenithjoy-workspace、command_argv=["probe",key]、source_sha/machine_id NULL、assertion_ref_snapshot=probe:<key>、assertion_digest=spec_hash）；`persistTrustedEvaluatorReceipts` 不动
- 迁移 475（474 号已被棒2 step_probes 占用）：`journey_assertion_receipts.executor_kind` CHECK 放宽为两值；verdict_chk 按 executor_kind 分支（brain 原式不动；probe 只要求 PASS↔exit 0+证据非空 / FAIL↔exit≠0）；合并闸 SQL 仍只认 brain_assertion_runner（断言测试钉住）
- 两处 resolver（`lib/map-state-resolver.js` / `map/state-resolver.js`）对 business_probe_runner 回执只看最近一条 verdict（PASS→green / FAIL→red），不比 sha/repo；`map/state-resolver.js` 抽纯函数 `resolveReceiptState`
- pg 集成 `business-probe-judge.pg.integration.test.js`（真库端到端：finishRun → 真 event-bus → 回执行 → cell_status；重复判定幂等；已终态不重判；brain_assertion_runner 原式未放宽）+ F1 step4 步骤断言 `tests/gp/f1/step4-business-probe-receipt.test.js`
