# Contract Draft — Harness Kernel 收敛驱动恢复（Sprint 07231527）

**TASK_ID**: 50170af2-fefa-41a7-b0b4-dcf1a5d7b077
**Sprint**: 07231527-relay-50170af2
**Version**: 2.0
**Date**: 2026-07-23
**Status**: APPROVED FOR REWORK
**Decision**: `9aeae77e-a4f2-47f7-a94f-d515546d1a32`

---

## 背景、范围与优先级

PR #4220 的历史事故和 PR #4226 第一轮实现证明了 deadline、持久计数、
failure-class 路由、no-progress 与 approval bridge 必须接入真实调用链。
独立复审进一步确认 R1–R7：原终止模型仍会死锁、误放或无限空转。

本合同以批准后的
`docs/superpowers/specs/2026-07-23-kernel-convergence-rework-design.md`
为规范来源。早期固定 fix 轮数、run 级 approval 幂等和短墙钟 deadline
描述均已废止，不得作为测试预期。R7 的最新裁决覆盖旧的
`kernel-approval-bridge.test.js@868ee83cb` 不可修改要求：T-17-c/d/e
必须穿过真实 Router。

实现范围：

- `packages/brain/src/orchestrator/`：常量、ground truth、计数回放、derive、
  loop、gates；
- `packages/brain/src/routes/`：approval、callback、共享 PR head resolver；
- `packages/brain/src/harness-skill-relay.js` 与
  `packages/brain/src/harness-relay-watchdog.js`；
- `tests/regression/relay-50170af2/`、真实 Router 测试与真 PostgreSQL
  integration。

不改 #4223 的审批认证语义，不 merge PR #4226。

---

## Golden Path

### GP-1：服务端可验证的新 SHA

1. `spawn:generator-fix` intent 保存当前 resolver SHA 为 `trigger_sha`，
   同时保存结构化 `failure_set` 与确定性 `failure_set_key`。
2. callback claimed SHA 先 trim、小写并校验 40 位 hex。
3. approval 与 callback 使用同一 GitHub PR head resolver。
4. 只有 claimed SHA 与 resolver SHA 完全相同才落权威 callback SHA。
5. resolver SHA 等于 `trigger_sha`，或格式/对账失败，立即
   `FAILED + 人工升级`，不再 spawn。

### GP-2：结构化失败面收敛

1. CI 失败集合只取 GitHub `statusCheckRollup` 中失败 check 名，排序去重。
2. evaluator / judge 只取合法数组型 `failure_signature`。
3. 自然语言 reason、feedback、summary 永不参与比较。
4. resolver 确认新 SHA 后：
   - 无结构化集合：允许继续；
   - 集合规模创历史新低：允许继续并重置 patience；
   - 精确集合为历史新集合：允许探索；
   - 精确集合历史重现：`wait:human_review + Bark`；
   - 连续 3 个新集合未创历史新低：`wait:human_review + Bark`。
5. approval 解锁后 patience 固定为 1；下一个结构化轮次仍未创历史新低，
   立即 FAILED，不得二次人审；创历史新低则恢复常规模型。

### GP-3：无 PR 崩溃与 evidence repair

1. 无 PR generator 崩溃签名由服务端生成：
   `{role, error_code, failure_class}`。
2. 相同崩溃签名第二次出现立即 FAILED；该从严策略是有意的。
3. evidence repair 仅使用结构化 evidence signature。
4. 相同 evidence signature 第二次出现进入人审；批准后再次重复立即
   FAILED。

### GP-4：failure_class 保守路由

| 来源 / `failure_class` | 动作 |
|---|---|
| product failure | 在 SHA 与收敛 gate 通过后 `spawn:generator-fix` |
| evidence_invalid | `spawn:evaluator-evidence-repair` |
| environment_recovery 第二次同服务端签名 | `mark_failed` |
| needs_context | `wait:human_review` |
| contract_invalid | `mark_failed` |
| judge FAIL 缺失/null | 归一为 `unknown` → `wait:human_review` |

缺分类不得默认派 generator。

### GP-5：8 小时自动化活动 deadline

1. 新 kernel run 的 `deadline_at` 初始为 8 小时。
2. collect、derive、dispatch 与 DONE 后 fence 均接线。
3. 存在当前 SHA 的开放 `effect:human_review_requested` 时，loop 与 relay
   watchdog 均跳过 deadline 终止。
4. approval 必须引用 request hop，并在同一事务中按 request
   `created_at` 将暂停时长加回 deadline。
5. SHA 改变使旧 request 失效时恢复 deadline 判定。
6. deadline / hop 触发只写 FAILED；`markRunFailed` 使用
   `WHERE phase NOT IN ('done','failed')`，不得覆盖终态。

### GP-6：按 SHA approval 幂等

1. approval 校验 token、task/run、request hop、操作者和当前 GitHub SHA。
2. 判重键为 `(run_id, action='verdict:human_review', pr_head_sha)`。
3. 同 SHA 重复批准返回 409；同 run 的 SHA-A 与 SHA-B 可各批准一次。
4. 每个 SHA 的并发批准通过 advisory lock 保证恰一行。
5. approval 只解除等待，不产生 evaluator/judge PASS，不绕过 merge gate。

### GP-7：持久回放与宽兜底

1. `orchestrator_decision_log` 是唯一收敛历史，不新增可变 JSON 双账本。
2. pollCount、blockedStreak、失败面、patience 与 approval 解锁在重启后均
   从日志恢复。
3. `fixRound` 保留为诊断指标，无任何路由终止语义。
4. `MAX_HOPS = 4096`，按所有新日志行计数，只在收敛探测之后作为防死循环
   宽兜底。

---

## E2E 验收

### E2E-1：R1/R7 真实 approval Router

通过 Express 挂载生产 Router，验证：

- 未认证 401；
- stale SHA 409；
- 同 SHA 重复批准 409；
- 同 run 的两个 GitHub head SHA 各返回 202，decision log 各恰一行；
- T-17-c/d/e 不包含复制生产 SQL/分支的内联逻辑。

```bash
cd packages/brain && npx --no-install vitest run \
  ../../tests/regression/relay-50170af2/kernel-approval-bridge.test.js \
  src/routes/__tests__/harness-kernel-approvals.test.js \
  ../../tests/regression/relay-50170af2/kernel-wiring-approval-route.integration.test.js \
  --reporter=verbose
```

### E2E-2：R4 callback SHA 对账

大写合法 SHA 只以 resolver 确认的小写形式落库；短 SHA 与格式合法但假的
SHA 均形成可回放 no-progress 并终局。artifact、decision 与 provider
metadata 都不能选择权威 head。

```bash
cd packages/brain && npx --no-install vitest run \
  src/routes/__tests__/harness-callback.test.js \
  ../../tests/regression/relay-50170af2/kernel-wiring-no-progress-callback.integration.test.js \
  --reporter=verbose
```

### E2E-3：R2 活动 deadline 与终态 guard

验证任意高 `fixRound` 的真实进展仍可继续、初始 deadline 为 8 小时、开放
人审在 loop/watchdog 停表、approval 补回等待时长，以及 `done` / `failed`
不被 fence 覆盖。

```bash
cd packages/brain && npx --no-install vitest run \
  src/orchestrator/__tests__/constants.test.js \
  src/orchestrator/__tests__/gates.test.js \
  src/orchestrator/__tests__/loop.test.js \
  ../../tests/regression/relay-50170af2/kernel-deadline.test.js \
  ../../tests/regression/relay-50170af2/kernel-wiring-deadline.integration.test.js \
  ../../tests/regression/relay-50170af2/kernel-wiring-fix-round.integration.test.js \
  --reporter=verbose
```

### E2E-4：R3/R5/R6 路由与签名

验证 judge 缺分类进入人审、无 PR 同崩溃签名第二次 FAILED、evidence 同签名
第二次人审，以及批准后再次重复直接 FAILED。

```bash
cd packages/brain && npx --no-install vitest run \
  src/orchestrator/__tests__/counters.test.js \
  src/orchestrator/__tests__/derive.test.js \
  ../../tests/regression/relay-50170af2/kernel-failure-class-routing.test.js \
  ../../tests/regression/relay-50170af2/kernel-convergence-signatures.test.js \
  --reporter=verbose
```

### E2E-5：完整失败面历史与 d707

覆盖历史新低、新集合、集合重现、连续 3 个非新低集合、无结构化集合、
same-SHA、patience=1 人工解锁，并要求 d707 回放只能以结构化收敛 /
no-progress 退出。

```bash
cd packages/brain && npx --no-install vitest run \
  ../../tests/regression/relay-50170af2/kernel-convergence-history.test.js \
  ../../tests/regression/relay-50170af2/d707-replay.test.js \
  --reporter=verbose
```

### E2E-6：真 PostgreSQL 接缝

正式 migrations 后使用真实 PostgreSQL、真实 decision log、真实
loop→derive→dispatch→callback 与真实 approval Router，要求 8/8。
仅 GitHub CLI、容器枚举和 provider 进程允许最外层替身。

```bash
cd packages/brain && npx --no-install vitest run \
  src/__tests__/integration/kernel-wiring.pg.integration.test.js \
  --reporter=verbose
```

---

## Test Contract

| Workstream | Test File | 预期 Red | Green 合同 |
|---|---|---|---|
| R1/R7 approval | `kernel-approval-bridge.test.js` + route integration | 第二 SHA 409；mock 复制逻辑恒真 | 真 Router、双 SHA 各一行 |
| R2 budget | `kernel-deadline.test.js` + wiring integrations | 固定 cap / 旧 deadline / 终态覆盖 | 8h 活动时钟、停表、guard、4096 hop |
| R3 unknown | `kernel-failure-class-routing.test.js` | judge 缺分类派 generator | unknown 人审 |
| R4 SHA | `kernel-wiring-no-progress-callback.integration.test.js` | 大写/短/假 SHA 可落库 | resolver 对账与 terminal |
| R5/R6 signature | `kernel-convergence-signatures.test.js` | 重复签名可无限派 | 崩溃 FAILED；evidence 人审/解锁后 FAILED |
| 收敛历史 | `kernel-convergence-history.test.js` | 固定轮数或无振荡探测 | 新低、新集合、重现、patience |
| d707 | `d707-replay.test.js` | 重复 fix 或旧 cap 退出 | 结构化 no-progress / convergence |
| 真 PostgreSQL | `kernel-wiring.pg.integration.test.js` | 接缝缺失 | 8/8 |

所有 R 项都必须先有旧实现上的 Red commit，再有最小 Green commit。不得修改
测试来迁就实现；R7 修改测试是为了消除恒真 mock 并扩大到真实调用链。

---

## 禁 mock 边

- PostgreSQL decision log INSERT、JSONB、advisory lock、回读和 append-only；
- loop ↔ ground truth ↔ counters ↔ derive ↔ dispatch ↔ callback；
- approval auth、真实 Router mount、事务、按 SHA 并发幂等；
- GitHub resolver 的比较逻辑；测试可替换最外层 `gh` 执行结果，但不能
  让 callback 自报值成为权威；
- 重启恢复必须复用同一 `run_id` 与数据库。

---

## 回滚与交接

- 非 `kernel-v1` 任务走旧 one-session/controller 路径；
- 本回炉不改 LangGraph，不碰 #4223/#4219 已有成果；
- 回归、真 PostgreSQL、DevGate、独立 evaluator、异厂 judge 与 GitHub
  check rollup 全绿后，只写 PR #4226 交接评论；
- 没有独立复审 PASS 与批准 token 时，不 merge。
