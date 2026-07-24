# Contract DoD — Harness Kernel 收敛驱动恢复

**TASK_ID**: 50170af2-fefa-41a7-b0b4-dcf1a5d7b077
**Sprint**: 07231527-relay-50170af2
**Decision**: `9aeae77e-a4f2-47f7-a94f-d515546d1a32`

> 本 DoD 取代本 sprint 早期固定 fix 轮数、run 级 approval 幂等和短墙钟
> deadline 的验收语义。R7 最新裁决允许且要求修改
> `kernel-approval-bridge.test.js` T-17-c/d/e，使其穿过真实 Router。

---

## [BEHAVIOR] B-01 / R1+R7：按 SHA approval 幂等，测试穿真实 Router

同一 run 的 SHA-A 与 SHA-B 可各批准一次并各落一行
`verdict:human_review`；同一 SHA 的重复/并发批准仍只有一行，loser 返回
409。认证、stale SHA、request hop 和操作者校验保持 fail-closed。
T-17-c/d/e 禁止在测试体内复制生产 SQL 或路由分支。

**可验命令**：

```bash
cd packages/brain && npx --no-install vitest run \
  ../../tests/regression/relay-50170af2/kernel-approval-bridge.test.js \
  src/routes/__tests__/harness-kernel-approvals.test.js \
  ../../tests/regression/relay-50170af2/kernel-wiring-approval-route.integration.test.js \
  --reporter=verbose
```

**预期**：未认证 401、stale 409、同 SHA 重复 409、两个 SHA 各 202 且各
恰一行；所有断言穿过真实 Express Router。

---

## [BEHAVIOR] B-02 / R2：无固定 fix cap，8 小时活动 deadline

`fixRound` 仅作观测指标，任意高轮次只要有真实进展就继续。所有 append-only
日志行计入 `MAX_HOPS = 4096` 宽兜底，且收敛探测优先。新 run 初始
deadline 为 8 小时；当前 SHA 有开放人审 request 时 loop 与 watchdog 均
停表，approval 按 request `created_at` 补回等待时长。deadline / hop 仅能
FAILED；`done` / `failed` 不得被 fence 覆盖。

**可验命令**：

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

**预期**：多轮真实进展继续；8h、三道 fence、开放人审停表、approval
补时、watchdog 排除与终态 guard 全通过。

---

## [BEHAVIOR] B-03 / R3：judge 缺分类 → unknown 人审

judge FAIL 的 `failure_class` 缺失或 null 时，归一为 `unknown` 并返回
`wait:human_review`；不得默认派 `spawn:generator-fix`。

**可验命令**：

```bash
cd packages/brain && npx --no-install vitest run \
  src/orchestrator/__tests__/derive.test.js \
  ../../tests/regression/relay-50170af2/kernel-failure-class-routing.test.js \
  --reporter=verbose
```

**预期**：action 为 `wait:human_review`，reason 为
`unknown:awaiting_human_review`。

---

## [BEHAVIOR] B-04 / R4：callback SHA 服务端标准化并对账

callback claimed SHA 必须 trim、转小写、满足 40 位 hex，并与 approval
route 共用 resolver 获取的 GitHub 当前 head 完全一致。大写合法 SHA
仅以 resolver 的小写 SHA 落库；短 SHA、假 SHA、resolver 不可用或不匹配
均生成可回放 no-progress，最终 FAILED + 人工升级。

**可验命令**：

```bash
cd packages/brain && npx --no-install vitest run \
  src/routes/__tests__/harness-callback.test.js \
  ../../tests/regression/relay-50170af2/kernel-wiring-no-progress-callback.integration.test.js \
  --reporter=verbose
```

**预期**：artifact、decision、provider metadata 的自报值均不能绕过
resolver；大写/短/假 SHA 三个对抗场景全覆盖。

---

## [BEHAVIOR] B-05 / R5：无 PR 崩溃重复签名终局

没有 PR / `trigger_sha` 的 generator 崩溃使用服务端签名
`{role, error_code, failure_class}`。首次可 recovery，相同签名第二次必须
立即 FAILED + 人工升级，不等待 deadline。该规则有意从严。

**可验命令**：

```bash
cd packages/brain && npx --no-install vitest run \
  src/orchestrator/__tests__/counters.test.js \
  src/orchestrator/__tests__/derive.test.js \
  ../../tests/regression/relay-50170af2/kernel-convergence-signatures.test.js \
  --reporter=verbose
```

**预期**：第二次同签名 action 为 `mark_failed`，且无新 generator intent。

---

## [BEHAVIOR] B-06 / R6：evidence repair 重复签名受控

evaluator evidence repair 只使用合法数组型结构化 signature；自然语言不
参与。相同 signature 第二次出现进入 `wait:human_review + Bark`。人工
批准只解锁一次；批准后再次出现相同 signature 必须立即 FAILED，不得二次
人审。

**可验命令**：

```bash
cd packages/brain && npx --no-install vitest run \
  src/orchestrator/__tests__/counters.test.js \
  src/orchestrator/__tests__/derive.test.js \
  ../../tests/regression/relay-50170af2/kernel-convergence-signatures.test.js \
  --reporter=verbose
```

**预期**：首次 repair、第二次人审、批准后重复 FAILED 的三段状态完整。

---

## [BEHAVIOR] B-07：结构化失败集合收敛

Product fix 首先要求 resolver 确认的新 SHA。无结构化集合时，新 SHA 即
进展；有结构化集合时，集合规模创历史新低或精确集合从未出现才允许继续。
精确集合历史重现进入人审；连续 3 个结构化新集合未创历史新低也进入人审。
不读取 reason、feedback、summary。

**可验命令**：

```bash
cd packages/brain && npx --no-install vitest run \
  src/orchestrator/__tests__/ground-truth.test.js \
  src/orchestrator/__tests__/counters.test.js \
  src/orchestrator/__tests__/derive.test.js \
  ../../tests/regression/relay-50170af2/kernel-convergence-history.test.js \
  --reporter=verbose
```

**预期**：历史新低、新集合、集合重现、3 轮 patience、无结构化新 SHA
与 same-SHA 均有独立断言。

---

## [BEHAVIOR] B-08：patience 人工解锁固定为 1

集合重现或 3 轮 patience 人审获得批准后，仅允许观察下一个结构化轮次。
该轮未创历史新低时立即 FAILED，不得再次人审；创历史新低时清除人工观察
状态，恢复常规收敛模型。

**可验命令**：

```bash
cd packages/brain && npx --no-install vitest run \
  ../../tests/regression/relay-50170af2/kernel-convergence-history.test.js \
  ../../tests/regression/relay-50170af2/kernel-convergence-signatures.test.js \
  --reporter=verbose
```

**预期**：解锁后的第一个非新低结构化轮次直接 FAILED，日志中不存在第二个
patience review request。

---

## [BEHAVIOR] B-09：d707 与持久回放

使用真实 d707 decision-log fixture 回放；evidence failure 必须走 evidence
repair，same-SHA 或结构化签名振荡必须被收敛探测器截获。poll、blocked、
失败面、patience 与 approval 解锁均从 append-only DB 日志恢复，不依赖
进程内变量。

**可验命令**：

```bash
cd packages/brain && npx --no-install vitest run \
  ../../tests/regression/relay-50170af2/d707-replay.test.js \
  ../../tests/regression/relay-50170af2/kernel-persistent-counters.test.js \
  --reporter=verbose
```

**预期**：d707 不产生重复 fix 空转；退出原因来自 convergence /
no-progress，不来自固定轮数。

---

## [INTEGRATION] B-10：真 PostgreSQL 8/8 与禁 mock 边

正式 migrations 后，使用真实 PostgreSQL decision log、JSONB、advisory
lock、真实 loop→derive→dispatch→callback、真实 Router 与真实 attempt
store。仅 GitHub CLI 返回、容器枚举和 provider 外部进程允许最外层替身。

**可验命令**：

```bash
cd packages/brain && npx --no-install vitest run \
  src/__tests__/integration/kernel-wiring.pg.integration.test.js \
  --reporter=verbose
```

**预期**：8/8；approval 双 SHA、callback SHA 对账、收敛与 deadline 均
通过真实数据库接缝。

---

## DoD 完成标准

- [ ] R1–R7 每项均保留旧实现上的 Red commit 与最小 Green commit。
  Test: manual:red-green-commit-chain
- [ ] 全部 orchestrator unit 与 relay-50170af2 regression 绿色。
  Test: manual:full-kernel-regression
- [ ] 真 PostgreSQL kernel suite 8/8。
  Test: manual:kernel-postgresql-8-of-8
- [ ] `git diff --check`、facts-check、version-sync、`node --check` 通过。
  Test: manual:static-and-version-checks
- [ ] DevGate 通过，GitHub check rollup 无 non-green。
  Test: manual:devgate-and-github-rollup
- [ ] 独立 evaluator PASS，异厂 judge PASS。
  Test: manual:independent-dual-review
- [ ] PR #4226 已写回炉交接评论，保持未 merge，等待批准 token。
  Test: manual:pr-4226-handoff

---

## 执行顺序

1. 可执行合同；
2. R1/R7；
3. R4；
4. R2；
5. R3；
6. R5/R6；
7. Product failure-set convergence；
8. 版本、全量回归、真 PostgreSQL、DevGate；
9. 独立复审与 PR 交接。
