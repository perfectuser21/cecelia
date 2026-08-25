# Sprint Contract Draft (Round 1) — commander lease 过期有界重派根除 route_unknown 人审 [r72]

## 锚定父路声明

覆盖父路 F1「工厂 · 开发闭环」第 3 步（造完真验 · kernel 编排纯函数收敛边）。

## GP-Anchor

gp-anchor: skipped (product-map.json not found)

## Response Schema（推导来源: N/A）

N/A — 任务无 HTTP 响应。本 sprint 只改 `packages/brain/src/orchestrator/derive.js` 纯函数
的 commander infrastructure 重试路由，无新增/修改 API 端点，无 DB schema 变更。observable
是 `derive(observed)` 返回对象的 `{phase, action, reason, callbackHop}` 字段。

## 已知约束（来自回归测试）

- [回归测试] `tests/gp/f1/step3-route-unknown-review-approve-consume.test.js`（#5058，r70 案卷）→
  «route_unknown 人审批准候选头锚消费»：当前用 **单条** commander 过期收割即触发
  `wait:human_review(callback_infrastructure_route_unknown)` 并带 callbackHop 锚，批准后按候选头锚消费。
  **本 sprint 改变根因**（单次过期不再挂人审），故该冻结测试的 `routeUnknownChain()` 必须由
  generator 迁移为「达上限（5 次）才挂人审」的 production 形状（详见「## 禁 mock 边清单」与 DoD
  ARTIFACT），以在新语义下**保留** #5058 的消费锚回归覆盖，不得删除该文件的任一断言语义。
- [回归测试] `packages/brain/src/orchestrator/__tests__/derive.test.js` →
  «routes the latest distinct expired-attempt infrastructure terminal effect like a callback»
  （role=generator）+ «runner failure retries bounded»：非 commander 角色的 infrastructure/
  runner_failure 重派语义必须逐字不变。
- [MAP_NOT_CONFIGURED] 本 attempt 为 fleet-worker 离线执行（runtime_resources.postgres=false，
  Brain API 不可达），Unified Map scope/repo 未注入，`must_run_assertions` 取上述两条冻结回归测试。

## Golden Path

[commander attempt 被 lease 过期收割（effect:expired_attempt_reconciled, commander, infrastructure_blocked）]
→ [derive 纯函数按 decision_log 行时序判定：commander 是监理角色，infrastructure 类失败降级续跑]
→ [主链在当前 phase 续跑（commander 由 coordinator 独立重派），无人工介入；累计达上限 5 次后 fail-closed 回落人审]

---

### Step 1: commander attempt 被 lease 过期收割
**来源**: `[FROM_PRD]` — sprint-prd.md「Golden Path」第 1 条 + 背景段（r70/r71 双实证）

**可观测行为**: decision_log 出现 `spawn:commander`，随后出现 `effect:expired_attempt_reconciled`
（detail: `role=commander`, `status=failed`, `failure_class=infrastructure_blocked`,
`signature=worker_attempt_replacement_required_after_lease`），该收割行未被消费、晚于最近一次 spawn。

**验证命令**:
```bash
# 真 import derive.js，传入 r70 复刻链，断言当前（未修）行为 = 现状 route_unknown（RED 基线）
cd /workspace && npx vitest run tests/gp/f1/step3-commander-infra-retry-bounded.test.js \
  -t "commander infra 单次过期" --no-cache --reporter=dot
# 修前：该用例 FAIL（现状 derive 返回 wait:human_review）；修后：PASS（主链续跑）
```

**硬阈值**: 修后 `derive(singleExpiredChain).action !== 'wait:human_review'` 且
`reason !== 'callback_infrastructure_route_unknown'`（对应验证命令 exit 0）。

---

### Step 2: derive 识别 commander 为 infrastructure 降级续跑角色，主链续跑
**来源**: `[FROM_PRD]` — sprint-prd.md「Golden Path」第 2/3 条 + ASSUMPTION（重派 phase/action 由 proposer codify）

**可观测行为**: 低于上限时，commander 的 infrastructure 收割对主链**完全透明** —— `attemptCallbackRoute`
对 role=commander 且 infrastructure_blocked 返回「非阻塞」，derive 落回主链在当前 phase 的决策
（commander 的实际重派由 `commander-coordinator` 独立完成，derive 不发 spawn:commander——该 action 需
coordinator context，dispatcher.js:984 无 context 会抛错）。观测面 = `derive(withCommanderExpired).action`
等于同快照**去掉** commander 回调后的主链 action。

**验证命令**:
```bash
cd /workspace && npx vitest run tests/gp/f1/step3-commander-infra-retry-bounded.test.js \
  -t "过期对主链透明" --no-cache --reporter=dot
# 断言 derive(withExpired).action === derive(withoutCallback).action === 'spawn:judge'（本快照主链）
```

**硬阈值**: `derive(withExpired).action === derive(baselineNoCallback).action`（exit 0）。

**codify 依据（读源确认）**:
- `packages/brain/src/orchestrator/derive.js:296` `INFRA_RETRY_ACTION_BY_ROLE` 无 commander 条目 →
  `infrastructureRetryForCallback('commander')` 返回 undefined → 现状 route_unknown（根因）。
- `packages/brain/src/orchestrator/dispatcher.js:122,984` `spawn:commander` 需 coordinator bundle，
  故 derive **不得**发 spawn:commander；降级续跑（返回非阻塞让主链前进）= 与 r60 案卷
  `step3-commander-degrade-continue.test.js`「监理非承重墙」原则一致的最小安全实现。

---

### Step 3: 有界兜底——累计达上限 5 次 fail-closed 回落人审带 hop 锚
**来源**: `[FROM_PRD]` — sprint-prd.md「边界情况 · 有界兜底」+ Invariant「fail-closed」

**可观测行为**: 同一 run 内 commander 的 infrastructure 类失败（`expired_attempt_reconciled`/
`attempt_callback` + `failure_class=infrastructure_blocked`）累计**达 5 次**后，derive 仍返回
`wait:human_review`，`reason='callback_infrastructure_route_unknown'`，并带 `callbackHop`=触发该轮的
最新收割行 hop（供 #5058 消费锚闭环，禁止无限重派）。

**验证命令**:
```bash
cd /workspace && npx vitest run tests/gp/f1/step3-commander-infra-retry-bounded.test.js \
  -t "累计达上限5" --no-cache --reporter=dot
```

**硬阈值**: `derive(nExpiredChain(5)).action === 'wait:human_review'` 且
`reason === 'callback_infrastructure_route_unknown'` 且 `callbackHop === 115`（exit 0）。

---

### Step 4: 隔离——非 commander 角色 / 非 infrastructure 失败类语义不变
**来源**: `[FROM_PRD]` — sprint-prd.md「边界情况 · 角色隔离 / 失败类隔离」

**可观测行为**:
- 角色隔离：planner 的 infrastructure 收割仍 `{phase:'planning', action:'spawn:planner', reason:'callback_infrastructure_blocked'}`。
- 失败类隔离：commander 的 `account_exhausted` 收割仍 `{action:'wait:human_review', reason:'callback_account_exhausted_route_unknown'}`（本 sprint 只碰 infrastructure_blocked 分支）。

**验证命令**:
```bash
cd /workspace && npx vitest run tests/gp/f1/step3-commander-infra-retry-bounded.test.js \
  -t "角色隔离" --no-cache --reporter=dot
cd /workspace && npx vitest run tests/gp/f1/step3-commander-infra-retry-bounded.test.js \
  -t "失败类隔离" --no-cache --reporter=dot
```

**硬阈值**: 两条隔离用例均 exit 0（语义逐字不变）。

---

## 禁 mock 边清单

本单改动落在 kernel 状态机（derive.js 的 attempt-callback 路由）+ 跨模块数据传递（读
orchestrator_decision_log 行时序），属「状态机 / 跨模块数据传递」类，故：

- **代码（derive.js）↔ orchestrator_decision_log 行**：本单改写该判定边——冻结测试必须传入**真实
  形状的 decisionLog 行**（`spawn:commander` / `effect:expired_attempt_reconciled` /
  `verdict:attempt_callback`），真 `import { derive }` 执行，**禁止** `vi.mock`/stub derive 或其内部
  helper（`infrastructureRetryForCallback` / `latestUnconsumedAttemptResult` /
  新增 `commanderInfrastructureFailureCount`）。
- **derive ↔ dispatcher 契约边**：commander 降级续跑不得发 `spawn:commander`（dispatcher 需
  coordinator bundle）——此边由「主链透明」用例（action 等于无回调基线）守，禁止 mock dispatcher。
- 纯函数、无 DB、无网络：除被改边外无更外层依赖，无需 mock 任何东西。

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A。所有断言真 import derive.js 真执行，无 force_*/stub/假数据。）

## 八要素需求规范

| 要素 | 说明 | 本次答案 |
|------|------|----------|
| **FR（做什么）** | 功能需求 | commander 的 infrastructure 类失败纳入 derive 重试路由：低于上限降级续跑（不挂人审），达上限 fail-closed 回落人审 |
| **NFR（做得多好）** | 非功能 | 纯函数判定无延迟约束；重派上限 5 次/run |
| **Invariant（永不违反）** | 不变量 | ①fail-closed：达上限必回落 wait:human_review 禁无限重派；②纯函数：只读 decision_log 行时序禁引入新状态存储；③消费锚：route_unknown 请求行必带触发 callback hop 锚；④角色/失败类隔离：非 commander、非 infrastructure 语义不变 |
| **判定点（怎么知道）** | 判断假设 | 见下方登记表 |
| **保质期（何时过期）** | 失效 | N/A（纯函数常量 CAP=5，随代码演进，无 token/数据保质期） |
| **死亡告警（停了谁知道）** | 告警 | 达上限回落人审即为「commander 反复过期」的告警载体（人审队列可见）；冻结回归测试守其活性 |
| **失败语义（挂了怎么办）** | 故障 | 见下方失败语义声明（fail-closed 拦截，达上限挂人审） |
| **效果确认（已发≠已生效）** | 回执 | 通过 `derive()` 返回对象字段断言（vitest 冻结测试），可机检可复跑 |

### 判定点登记表

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| ⚠️ commander 收割是否属 infrastructure 类（应降级续跑而非挂人审） | A. 读 detail.failure_class===infrastructure_blocked; B. 读 signature 字符串匹配 | A. failure_class===infrastructure_blocked + status∈{failed,blocked} | failure_class 是 kernel 权威分类字段，signature 是自由文本易漂 | 误判会把产品失败/语义拒绝当基础设施降级续跑（漏掉真问题）——故只碰 infrastructure_blocked，其余分支逐字不变 |
| ⚠️ 是否已达重派上限（该 fail-closed） | A. 计数同 run 内 commander infrastructure 收割/失败回调条数≥5; B. 计数距上次人审的条数 | A. `commanderInfrastructureFailureCount(decisionLog) >= 5` | 纯函数可重放，只依赖 decision_log 行 | 计数偏小→无限重派（违反 fail-closed）；偏大→过早挂人审（回到每轮人审病根）。上限 5 为 thin_prd 显式值 |

> `⚠️` 判定点误判后果严重（漏掉真问题 / 无限重派）。PrepPRD 已在 thin_prd 显式拍板「上限 5、只碰 infrastructure_blocked」，故不再升拍板；如运行观测到 5 次仍不足以覆盖抖动，另立任务调参。

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| commander lease 过期（infrastructure，< 5 次） | 不挂人审，主链在当前 phase 续跑 | 是（纯函数按 decision_log 重放，同输入同输出） | commander 由 coordinator 独立重派 |
| commander infrastructure 累计达 5 次 | 回落 wait:human_review（route_unknown，带 callbackHop 锚） | 是（人审批准后按 #5058 候选头锚消费续跑） | fail-closed：人工介入 |
| commander 非 infrastructure 失败（account_exhausted 等） | 语义不变（本 sprint 不碰） | 不变 | 不变 |

### 输入对抗面

N/A —— 本 sprint 是 kernel 内部纯函数，不接受外部 agent 输入，无 prompt injection 面。

---

## E2E 验收（final-e2e 跑 — target_environment=local_api，纯 node/vitest 真 import）

**journey_type**: autonomous
**target_environment**: local_api（本地 evaluator 直跑 vitest 真 import derive.js；runtime_resources.postgres=false，本 sprint 纯函数无 DB/无 API，无需真库）

```bash
#!/bin/bash
set -euo pipefail
cd /workspace

# 1. F1 gp/f1 冻结回归测试（真 import derive.js，7 条：单次续跑 / 主链透明 / 上限内4次续跑 /
#    达上限5 fail-closed / 角色隔离 / 失败类隔离 / 纯函数可重放）—— 修后全绿
npx vitest run tests/gp/f1/step3-commander-infra-retry-bounded.test.js --no-cache --reporter=dot

# 2. sprint 冻结合同测试（同断言，seal 闸要求 sprints/<dir>/tests/ 至少一行冻结测试）
npx vitest run sprints/08251420-kernel-r72-commander-retry/tests/commander-infra-retry-bounded.test.ts --no-cache --reporter=dot

# 3. #5058 消费锚回归（generator 迁移为达上限交替链后）—— 新语义下保留 route_unknown 批准消费覆盖
npx vitest run tests/gp/f1/step3-route-unknown-review-approve-consume.test.js --no-cache --reporter=dot

# 4. 既有 brain derive 单测不回归（子 shell 用包内 vitest 配置，验 generator/planner 隔离未破）
( cd packages/brain && npx vitest run --no-cache ./src/orchestrator/__tests__/derive.test.js --reporter=dot )

echo "✅ r72 commander 有界重派 Golden Path 验证通过（全绿 + 无回归）"
```

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作（默认；纯函数状态机，风险面窄）
高风险面:
- 错输入: `decisionLog` 传入 `failure_class` 缺失/为 null 的 commander 收割行 → 应落回原有分支（不被误计入 5 次上限，不误触降级续跑）。
- 重复提交: 同一 hop 的收割行重复出现 / decisionLog 数组乱序 → 计数与判定必须以 hop 升序稳定（纯函数可重放，同输入同输出）。
- 中途中断: cap 边界 —— 恰好第 5 条 vs 第 4 条 vs 第 6 条 commander infrastructure 收割，验证 `>=5` 边界不偏移一位（4→续跑、5→人审）。
- 边界值: commander 收割与 generator/planner 收割**混合**出现在同一 decisionLog → 计数只数 commander 且只数 infrastructure_blocked，不串味（角色/失败类隔离不被污染）。
发现分级: P0/P1（无限重派 / 该续跑却挂人审 / 隔离串味把非 commander 语义改坏）→ 阻塞 merge；P2/P3 → 记 findings 不阻塞

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| commander 有界重派（冻结·seal 必需） | `sprints/08251420-kernel-r72-commander-retry/tests/commander-infra-retry-bounded.test.ts` | commander infra 单次过期 / 过期对主链透明 / 累计达上限5 / 角色隔离 / 失败类隔离 / 纯函数可重放 | → 3 failures（当前 derive 未修：单次过期、主链透明、上限内4次三条 RED） |
| commander 有界重派（F1 造完真验） | `tests/gp/f1/step3-commander-infra-retry-bounded.test.js` | commander infra 单次过期 / 过期对主链透明 / 累计达上限5 / 角色隔离 / 失败类隔离 / 纯函数可重放 | → 3 failures（同上） |

> `commander infra 单次过期` 等覆盖名均为对应 `it()` 名的字面子串（可 `grep -F` 命中）。
