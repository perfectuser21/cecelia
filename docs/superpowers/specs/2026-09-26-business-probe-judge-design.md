# 棒3a 判定（Brain 侧）：run.finished → 比对探针 → 写回执 → cell 翻色

任务 33aa2bc4 · 决策 702949b6 / 95e29afd / b56e37b4 · 锚 journey afa6abca（line02/keyword_acquisition keep-green）

## 问题

task_runs 只记录"活动发生了"（棒1），step_probes 只登记"该测什么"（棒2），没人把两者对起来判"做对了没"。本棒接这根线，判定结果进 `journey_assertion_receipts`（唯一验证账本）并翻 cell。

## 架构（一条线四段）

```
finishRun(UPDATE task_runs 成功)
  └─ emit('run.finished', 'task-run', {runId, taskId, status, result})     [event-bus 进程内订阅 + 落库]
       └─ business-probe-judge.handleRunFinished
            ├─ tasks.payload.anchor.journey_id + result.stage → step_probes ⋈ journey_step_links
            ├─ judgeProbes(specs, result) 纯比对（>= == <= not_null_all；expect.value | expect.ref→metrics.<k>）
            ├─ persistBusinessProbeReceipt → journey_assertion_receipts(executor_kind=business_probe_runner)
            └─ UPDATE journey_step_links.cell_status（PASS→green / FAIL&error→red / FAIL&warn→pending）
resolver（两处）：receipt.executor_kind=business_probe_runner → 只看最近一条 verdict，不比 sha/repo
合并闸 harness-gates：SQL 仍只认 brain_assertion_runner（加断言测试钉住）
```

## 组件

| 组件 | 改动 | 依赖 |
|---|---|---|
| `event-bus.js` | 加 `on/off`；`emit` 落库后同步派发给订阅者，每个 handler 单独 try/catch | 无 |
| `lib/task-run.js` | finishRun RETURNING 补 task_id/status/result；updated=true 时 emit（`deps.emit` 可注入，默认动态 import event-bus） | 单写守卫不受影响（只加事件不加写） |
| `lib/business-probe-judge.js` | `judgeProbes`（纯）/ `cellStatusFor`（纯）/ `handleRunFinished({pool})` / `registerBusinessProbeJudge()` | step_probes（棒2 合同）、journey_step_links |
| `impact-contract/assertion-receipts.js` | 新增 `persistBusinessProbeReceipt(db, input)`；`persistTrustedEvaluatorReceipts` 不动 | 迁移 475 |
| 迁移 475 | executor_kind CHECK 放宽为两值；verdict_chk 增 business_probe_runner 分支（PASS: exit_code=0 ∧ scenario_evidence≠{}；FAIL: exit_code≠0） | 374/409 |
| `lib/map-state-resolver.js` | SELECT 补 executor_kind；`resolveEvidenceState` 在 receipt 存在后先走 probe 分支 | 无 |
| `map/state-resolver.js` | 抽纯函数 `resolveReceiptState(receiptInfo)`；getLatestReceipt 补 executor_kind | 无 |
| `server.js` | 启动 `registerBusinessProbeJudge()`（BRAIN_EVALUATOR_MODE 之后） | 无 |

## 回执字段占位约定（business_probe_runner）

executor_kind=business_probe_runner · verdict PASS|FAIL · exit_code 0|1 · source_repo="zenithjoy-workspace"（占位） · command_argv=["probe", key] · source_sha NULL · machine_id NULL · assertion_ref_snapshot=`probe:<key>` · assertion_digest=step_probes.spec_hash · run_id=task_runs.run_id · started_at/completed_at=probed_at 或 now · scenario_count=1 · scenario_evidence={observed, expected, op, severity, reason?} · synthetic=false。

## 判定规则

| 情形 | verdict | reason |
|---|---|---|
| observed 缺失（probes 无该 key） | FAIL | probe_missing |
| 探针带 error | FAIL | probe_error |
| expect.ref 在 metrics 找不到 | FAIL | ref_unresolved |
| op 不在集合 | FAIL | op_unsupported |
| not_null_all：observed 为数组/对象，全部非 null | PASS/FAIL | value_mismatch |
| >= == <= 数值/字符串比较 | PASS/FAIL | value_mismatch |

无匹配 step_probes → 不写回执、不翻色（旁路静默）。result.probes 接受数组 `[{key,...}]` 或对象 `{key:{...}}`。

## 错误处理

全程 fail-open：judge 内任何异常只 console.warn，永不拖垮 finishRun 调用方。回执写入用 ON CONFLICT (run_id, journey_step_link_id, source_sha, impact_contract_hash) DO NOTHING（同一 run 重复判定幂等）。

## 测试策略

- unit（本 PR）：event-bus on/emit 派发与隔离；finishRun 事件（pool+emit 注入，updated=false 不发）；judgeProbes 比对矩阵/缺失/error/ref；cellStatusFor；persistBusinessProbeReceipt SQL 参数；两处 resolver 分支；harness-gates SQL 含 executor_kind 过滤；迁移 475 结构断言。
- pg integration：待棒2 的 step_probes 迁移合入 main 后补 `business-probe-judge.pg.integration.test.js`（真库端到端：finishRun → 回执行 → cell_status）。
- smoke：`packages/brain/scripts/smoke/business-probe-judge-smoke.sh`（node 注入 mock pool 跑 judge 全链 + 接线 grep）。

## 不包含

step_probes 迁移（棒2）、task_runs.result 填 probes（棒1）、Workspace 侧探针执行（棒3b）。
