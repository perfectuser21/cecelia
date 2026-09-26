# 棒3a 判定 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans（本会话禁派子代理，inline 执行）。Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** finishRun 终态 → `run.finished` 事件 → business-probe-judge 比对 step_probes 与 task_runs.result.probes → 写 journey_assertion_receipts(business_probe_runner) → journey_step_links.cell_status 翻色。

**Architecture:** event-bus 加进程内订阅；task-run.js 单点发事件；判定纯逻辑与 DB 副作用分层（judgeProbes/cellStatusFor 纯函数，handleRunFinished 走注入 pool）；回执写入新函数；两处 resolver 按 executor_kind 分支；迁移 475 放宽回执表 CHECK。

**Tech Stack:** Node ESM, vitest, pg, PostgreSQL 迁移 SQL。

## Global Constraints

- 禁碰版本五件套；条目写 `changes/cp-0926203401-baton3a-judge.md`（`## Brain {VERSION} — 标题`）
- 不加 step_probes 迁移；不动 `persistTrustedEvaluatorReceipts`
- task_runs 只有 lib/task-run.js 能写（单写守卫）
- 全程 fail-open，永不抛到 finishRun 调用方
- 回执占位约定：source_repo="zenithjoy-workspace"、command_argv=["probe", key]、source_sha/machine_id NULL

---

### Task 1: event-bus 进程内订阅
**Files:** Modify `packages/brain/src/event-bus.js`；Test `packages/brain/src/__tests__/event-bus.test.js`
**Produces:** `on(eventType, handler) → unsubscribe fn`、`off(eventType, handler)`、`emit(type, source, payload)` 落库后同步 await 每个 handler（各自 try/catch）。
- [ ] 失败测试：on 后 emit 派发 payload；handler 抛错不影响其他 handler 与 emit 返回；off 后不再收
- [ ] 实现 `const listeners = new Map()`
- [ ] 跑测试通过

### Task 2: finishRun 发 run.finished
**Files:** Modify `packages/brain/src/lib/task-run.js:140-163`；Test `packages/brain/src/lib/__tests__/task-run-finish-event.test.js`
**Produces:** `finishRun(input, { pool, emit })`；RETURNING `id, task_id, status, result`；`updated===true` → `emit('run.finished','task-run',{runId, taskId, status, result})`。
- [ ] 失败测试：pool mock 返回 1 行 → emit 被调一次含 taskId/result；返回 0 行 → 不调；emit 抛错 → 仍返回 {updated:true}
- [ ] 实现（deps.emit ?? 动态 import event-bus）
- [ ] 通过

### Task 3: 迁移 475
**Files:** Create `packages/brain/migrations/475_business_probe_receipts.sql` + `rollback/475_business_probe_receipts.down.sql`；Test `packages/brain/src/__tests__/migration-475-business-probe-receipts.test.js`
- [ ] 失败测试：结构断言（DROP 旧 executor_kind CHECK/新 CHECK 两值/verdict_chk 含 business_probe_runner 分支/schema_version 475/回滚恢复）
- [ ] 写 SQL：`ALTER TABLE journey_assertion_receipts DROP CONSTRAINT IF EXISTS journey_assertion_receipts_executor_kind_check; ADD CONSTRAINT ... CHECK (executor_kind IN ('brain_assertion_runner','business_probe_runner'))`；verdict_chk 重建为 `(executor_kind='brain_assertion_runner' AND <原式>) OR (executor_kind='business_probe_runner' AND ((verdict='PASS' AND exit_code=0 AND scenario_evidence<>'{}') OR (verdict='FAIL' AND exit_code<>0)))`
- [ ] 通过

### Task 4: persistBusinessProbeReceipt
**Files:** Modify `packages/brain/src/impact-contract/assertion-receipts.js`；Test `packages/brain/src/impact-contract/__tests__/business-probe-receipt.test.js`
**Produces:** `persistBusinessProbeReceipt(db, { journeyStepLinkId, assertionRevision, probeKey, specHash, runId, verdict, evidence, probedAt })` → 回执行或 null（冲突）。
- [ ] 失败测试：SQL 含 INSERT INTO journey_assertion_receipts、参数顺序（executor_kind 'business_probe_runner'、argv ["probe",key]、exit_code 0/1、assertion_ref_snapshot probe:key、source_repo zenithjoy-workspace）；spec_hash 非 64hex 抛错
- [ ] 实现
- [ ] 通过

### Task 5: business-probe-judge
**Files:** Create `packages/brain/src/lib/business-probe-judge.js`；Test `packages/brain/src/lib/__tests__/business-probe-judge.test.js`
**Produces:** `judgeProbes(specs, result) → [{key, verdict, reason?, observed, expected, op, severity, probed_at}]`；`cellStatusFor(verdict, severity) → 'green'|'red'|'pending'`；`normalizeProbes(probes) → Map`；`handleRunFinished(payload, {pool, persist})`；`registerBusinessProbeJudge({pool, on})`。
- [ ] 失败测试：比对矩阵四 op（含 ref 解析 metrics.x）、缺 observed、error、ref 不存在、op 非法、不同 stage 的 spec 被跳过；cellStatusFor 三态；handleRunFinished：task 无 anchor→不查 probes；有匹配→persist 调用+UPDATE journey_step_links；异常不抛
- [ ] 实现
- [ ] 通过

### Task 6: 两处 resolver 分支 + gates 断言
**Files:** Modify `packages/brain/src/lib/map-state-resolver.js`（SELECT 补 executor_kind；resolveEvidenceState probe 分支）、`packages/brain/src/map/state-resolver.js`（抽 `resolveReceiptState`；getLatestReceipt 补 executor_kind）；Tests 追加至 `lib/__tests__/map-state-resolver.test.js`、`map/__tests__/state-resolver.test.js`、`impact-contract/__tests__/harness-gates.test.js`
- [ ] 失败测试：business_probe_runner PASS→green(reason probe_receipt_pass) 即使 sha 不匹配；FAIL→red；brain_assertion_runner 行为不变；verifyImpactMergeFence 的 SQL 含 `executor_kind = 'brain_assertion_runner'`
- [ ] 实现
- [ ] 通过

### Task 7: 接线 + smoke + changes + DoD
**Files:** Modify `packages/brain/server.js`；Create `packages/brain/scripts/smoke/business-probe-judge-smoke.sh`；Modify `packages/quality/smoke-allowlist.txt`；Create `changes/cp-0926203401-baton3a-judge.md`、`.dod.md`
- [ ] server.js 在 callback worker 之后 `registerBusinessProbeJudge({ pool })`
- [ ] smoke：node 注入 mock pool 跑 judge 全链（PASS→green/FAIL error→red/缺 observed→FAIL）+ grep 接线
- [ ] DevGate 三件 + `npx vitest run` 相关文件 + smoke 本地跑

### Task 8: PR
- [ ] push，开 PR（描述含占位约定、pg 集成待棒2）；等 CI；merge；PATCH 任务 completed
