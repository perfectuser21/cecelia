## Brain {VERSION} — 回执唯一键补 assertion_ref_snapshot：同格多条业务探针回执不再互吞（链 bf5088a3 棒3a-3）

- 迁移 477：`journey_assertion_receipts` 唯一键从 409 的四列 `(run_id, journey_step_link_id, source_sha, impact_contract_hash)` 改为五列补 `assertion_ref_snapshot`（NULLS NOT DISTINCT，幂等 DROP/CREATE IF EXISTS）。09-27 生产实证 run `social-keyword-leadgen-crontab-auto09262230__a1.delivery` judged=3 只落 1 行——业务探针 sha/hash 皆 NULL，后两条被当重复 DO NOTHING 吞掉，FAIL 行丢失致晨报「断言红灯」失明。harness 行一格一断言且 ref 固定，去重语义不变（pg 集成有断言）。
- `persistTrustedEvaluatorReceipts` / `persistBusinessProbeReceipt` 的 ON CONFLICT 列集同步五列；后者不再静默：返回 `{receipt, persisted, skipped:{probe_key, reason}}`（duplicate / db_error:<code>:<msg>）。
- `business-probe-judge` 汇总日志 `judged=N persisted=N skipped=M`，skipped 非零 `console.warn` 点名 probe_key=reason；返回值带 `persisted` / `skipped`。
