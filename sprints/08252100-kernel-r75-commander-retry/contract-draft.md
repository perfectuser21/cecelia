# Sprint Contract Draft (Round 2) — commander lease 过期有界自动重派 [r75]

## 锚定父路声明

覆盖父路 F1「工厂 · 开发闭环」第 3 步「造完真验」（journey `e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29` / step `aad25bdb-bdd6-47f4-9a99-e1176e23ac8b`）——本 sprint 修 kernel 编排器 derive.js 的 callback 路由：commander lease 过期不再每轮挂 route_unknown 人审，纳入有界 infrastructure 重试。

## GP-Anchor

gp-anchor: skipped (product-map.json not found)

## Response Schema（推导来源: PRD 字面 — 纯函数返回对象，非 HTTP）

本 sprint 无 HTTP 端点，改的是 kernel 纯函数 `derive(observed)` 的返回决策对象。契约锚定 `derive` 返回对象字段（既有 schema，不新增字段名）：

- `action` (string)：本轮编排动作。commander infra 过期未达上限时其值 **≠** `"wait:human_review"`；达上限时 **=** `"wait:human_review"`。
- `reason` (string)：未达上限时 **≠** `"callback_infrastructure_route_unknown"`；达上限时 **=** `"callback_infrastructure_route_unknown"`。
- `callbackHop` (number)：仅达上限的 fail-closed 决策对象携带，值 = `Number(row.hop)`（触发本次挂人审的最后一条 expired 行 hop），与 #5058 diagnostic 消费锚兼容。

**禁用字段名**：不得新增/改名 `action`/`reason`/`callbackHop` 之外的返回键；不新增派发动作枚举（沿用既有 `spawn:*` 族）。
**Error / 边界**：非 commander 角色、非 infrastructure 类失败的返回语义**完全不变**（沿用既有分支）。

---

## Golden Path

[commander attempt lease 过期被收割器 reconcile] → [derive 重放 decisionLog 按 commander infra 过期累计序号分流] → [未达上限：不挂人审，主链继续（coordinator 重派）/ 达上限：fail-closed 挂人审带 callbackHop 锚]

### Step 1: commander attempt lease 过期落 expired 行
**来源**: `[FROM_PRD]` — Golden Path 第 1 点 / 背景段直接定义

**可观测行为**: 收割器在 `orchestrator_decision_log` 落一行 `effect:expired_attempt_reconciled`（`detail.role=commander`, `status=failed`, `failure_class=infrastructure_blocked`）。本 sprint **不改收割器**，仅消费该行时序。

**验证命令**（构造该行喂给 derive，见 Step 2/3 断言；纯函数无 IO）:
```bash
# 该行形状由测试 fixture expiredCommander(hop) 复刻 r70 hop112 实录
node -e "process.exit(0)"  # 形状锚点见 tests/gp/f1/step3-commander-lease-expired-retry.test.js
```
**硬阈值**: expired 行 role=commander 且 failure_class=infrastructure_blocked（fixture 逐字段复刻）。

---

### Step 2: derive 重放 decisionLog，按 commander infra 过期累计序号分流（未达上限 → 不挂人审）
**来源**: `[FROM_PRD]` — Golden Path 第 2、3 点 + 要求 1

**可观测行为**: `derive(observed)` 统计该 run decisionLog 里 role=commander 且 failure_class=infrastructure_blocked 的 `effect:expired_attempt_reconciled` 行、hop ≤ 当前行 hop 的条数（= 当前行在序列里的序号）。序号 **< 5** 时 `attemptCallbackRoute` 不再返回 `wait:human_review`（返回不阻塞路由，主链继续；commander 是监理角色，实际重派由 `commanderCoordinator` 在下一 tick 独立完成，重派安全无副作用）。

**验证命令**:
```bash
cd "${WORKSPACE_PATH:-/workspace}" && npx vitest run tests/gp/f1/step3-commander-lease-expired-retry.test.js -t "单条 commander" --reporter=dot 2>&1 | grep -qE "Tests +1 passed"
# 期望：derive 返回 action ≠ wait:human_review 且 reason ≠ callback_infrastructure_route_unknown
```
**硬阈值**: 单条 / 累计 4 条（第 5 条前）过期 → `action ≠ "wait:human_review"`。

---

### Step 3: 达上限（第 5 条 expired）→ fail-closed 挂人审带 callbackHop 锚
**来源**: `[FROM_PRD]` — Golden Path 第 4 点 + 要求 2 + Invariant「fail-closed 带锚」

**可观测行为**: 累计序号 **≥ 5** 时 `attemptCallbackRoute` 返回 `{ action: "wait:human_review", reason: "callback_infrastructure_route_unknown", callbackHop: Number(row.hop) }`。带 callbackHop 令 #5058 `diagnosticConsumedCallbackHops` 双锚定成立，人 approve 后可被正常消费出口（run 有出口不死等）。

**验证命令**:
```bash
cd "${WORKSPACE_PATH:-/workspace}" && npx vitest run tests/gp/f1/step3-commander-lease-expired-retry.test.js -t "达上限 第5条" --reporter=dot 2>&1 | grep -qE "Tests +1 passed"
# 期望：action=wait:human_review, reason=callback_infrastructure_route_unknown, callbackHop=112（第5条 expired 行 hop）
```
**硬阈值**: 第 5 条 expired → wait:human_review + reason=callback_infrastructure_route_unknown + callbackHop=112。

---

### Step 4: 既有 #5058 消费闭环在「达上限」场景下仍成立
**来源**: `[FROM_PRD]` — 要求 3 + 边界情况第 4 点（本 sprint claim 并更新既有回归测试）

**可观测行为**: `tests/gp/f1/step3-route-unknown-review-approve-consume.test.js` 的 route_unknown 场景铺垫升级为「已达重试上限（5 条 expired，末条 hop=112）」，callbackHop / 请求行 callback_hop=112 锚定不变；人 approve 后消费 hop112 → 下一条未消费行为 hop109（序号 4 < 5）→ 不挂人审，run 继续。断言语义不变（达上限 wait + callbackHop，approve 后消费出口）。新增一条 r75 子用例覆盖「未达上限（单条）不挂人审」。

**验证命令**:
```bash
cd "${WORKSPACE_PATH:-/workspace}" && npx vitest run tests/gp/f1/step3-route-unknown-review-approve-consume.test.js --reporter=dot 2>&1 | grep -qE "Tests +6 passed"
```
**硬阈值**: 该文件 6 用例全绿。

---

## 已知约束（来自回归测试 + 累积 FR）

- [tests/gp/f1/step3-route-unknown-review-approve-consume.test.js #5058] → route_unknown 人审批准后需被候选头锚 + callback_hop 双锚消费，否则死等；本 sprint 把其 route_unknown 前提升级为「达上限」，不得破坏该消费闭环。
- [tests/gp/f1/step3-publisher-head-lag-retry.test.js] → publisher headRefOid 读滞后重试语义（本 sprint 不触碰）。
- [累积FR] context-manifest: unavailable（postgres=false，本地无 Brain server；F1 line 累积 FR 见 PRD「累积 FR」段=本 line 暂无历史）。
- must_run_assertions: `[MAP_NOT_CONFIGURED]`（task.payload.map_scope/map_repo 为空，postgres=false 无法查 map；不回退领域硬编码）。

---

## 历史约束三源加载（EVA v2）

1. **铁律清单 → INV 覆盖**（见 contract-dod.md INV 段逐条映射）。
2. **累积 FR**：context-manifest unavailable（无 DB）；PRD「累积 FR」段=本 line 暂无历史，N/A。
3. **回归测试约束**：见上「已知约束」段。

---

## 八要素需求规范

| 要素 | 说明 | 本次答案 |
|------|------|----------|
| **FR（做什么）** | | commander infra 类过期纳入有界（上限 5）自动重试；未达上限不挂人审，达上限 fail-closed 挂人审带 callbackHop 锚 |
| **NFR（做得多好）** | | 纯函数，无 IO/时钟/随机；单次 derive 判定 O(n) 扫 decisionLog，n=hop 数 |
| **Invariant（永不违反）** | | ①纯函数可重放（只依赖 decisionLog 行时序）②达上限必 wait+callbackHop（禁静默放行/丢锚）③测试禁 mock 被改的边 |
| **判定点（怎么知道）** | | 见下方判定点登记表 |
| **保质期（何时过期）** | | 重试上限=5 为常量，随 run 生命周期；无 token/凭据过期问题 |
| **死亡告警（停了谁知道）** | | 达上限落人审请求行（既有 human_review 通道 + Bark），主理人可见；未达上限的重派由 coordinator 既有告警链覆盖 |
| **失败语义（挂了怎么办）** | | fail-closed：达上限拦截（挂人审带锚），不放行；纯函数无重试幂等问题（同 decisionLog 同判定） |
| **效果确认（已发≠已生效）** | | 达上限决策必带 callbackHop，令后续 diagnosticConsumedCallbackHops 可锚定消费；由 #5058 消费测试确认闭环 |

### 判定点登记表

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| commander infra 过期是否达重试上限 | A. 数全 run 该类 expired 行总数; B. 数 hop≤当前行的该类 expired 行序号 | B. hop≤当前行序号 | 保证有界判定单调——approve 消费末条后，前序条按各自序号（4/3/...）仍 < 上限判"重派"，不会因总数=5 而全部误判达上限死等 | 静默丢数据/死等（若用总数：approve 消费末条后前序条仍算达上限 → 仍 wait → 消费无效死等，回归 r70 病） |
| commander 过期归哪类失败 | A. 认 failure_class 字段; B. 认 signature 字符串 | A. failure_class=infrastructure_blocked | 收割器权威写 failure_class；signature 是诊断辅助非分类依据 | 误把 account_exhausted 当 infra → 该走轮换账号的走了重派 |

> 本任务无「真机/RPA/外部真实世界」接缝判定点（纯函数重放 DB 行）。

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| commander infra 过期未达上限 | 不挂人审，返回不阻塞路由，主链继续（coordinator 重派） | 是（同 decisionLog 同判定） | 无需降级 |
| commander infra 过期达上限（≥5） | fail-closed 挂 wait:human_review + callbackHop 锚 | 是 | 人审通道兜底，approve 后消费出口 |
| 非 commander / 非 infra 失败 | 语义完全不变（既有分支） | — | — |

### 输入对抗面

N/A — 本 sprint 是 kernel 内部纯函数，输入为系统自身 append-only decisionLog（非对外暴露 agent 输入）。

---

## 禁 mock 边清单

本单改动属「状态机 / 派发决策」类（kernel 编排器 callback 路由分流），依 v9.12 硬规则：

- 代码 ↔ derive.js `attemptCallbackRoute` commander infra 分支（本单改的就是这条边，测试必须真 import `derive.js` 调 `derive(observed)`，禁 vi.mock/stub 该函数或 `infrastructureRetryForCallback`）
- derive 判定 ↔ `orchestrator_decision_log` 行序列（测试用真数组 decisionLog 喂入，禁 mock 行时序）

（纯函数改动，无 DB 写路径 / 无跨进程边；相邻 `commanderCoordinator` 重派属既有独立机制，本单不改亦不 mock。）

## 未覆盖真实链路清单

（本合同无 force_*/stub/假数据 mock 豁免，N/A —— 纯函数真 import 全链路验证。真实调用方 shape / 第三方真调均 N/A：无设备-服务端接缝、无第三方 API。）

---

## E2E 验收（final-e2e 跑 — target_environment=local_api，纯 vitest + 版本同步，无 DB/浏览器）

**journey_type**: autonomous
**target_environment**: local_api（postgres=false — 纯 kernel 函数，E2E 仅需 npx vitest + check-version-sync，无 Brain server / psql / 浏览器）

```bash
#!/bin/bash
set -euo pipefail
cd "${WORKSPACE_PATH:-/workspace}"

# 1. 三测试文件全绿：冻结合同测试 + gp/f1 新 RED 测试 + 既有 #5058 更新测试
#    三者均在根 vitest include（sprints/**、tests/**），从仓库根跑即可
if ! npx vitest run --no-cache \
  sprints/08252100-kernel-r75-commander-retry/tests/commander-lease-expired-retry-bounded.test.ts \
  tests/gp/f1/step3-commander-lease-expired-retry.test.js \
  tests/gp/f1/step3-route-unknown-review-approve-consume.test.js \
  --reporter=dot > /tmp/r75-e2e.log 2>&1; then
  cat /tmp/r75-e2e.log
  echo "FAIL: 合同三测试文件未全绿"
  exit 1
fi
cat /tmp/r75-e2e.log
grep -qE "Tests +18 passed" /tmp/r75-e2e.log || { echo "FAIL: 期望 18 passed（3 文件共 18 用例）"; exit 1; }

# 2. derive.js 已落地 commander 有界重试实现（真 import 断言已由上面测试覆盖，此处防呆再校常量存在）
grep -q "COMMANDER_INFRA_RETRY_CAP" packages/brain/src/orchestrator/derive.js \
  || { echo "FAIL: derive.js 未含 commander 有界重试实现（COMMANDER_INFRA_RETRY_CAP）"; exit 1; }

# 3. Brain 版本四处同步（package.json / package-lock.json / .brain-versions / DEFINITION.md）
bash scripts/check-version-sync.sh || { echo "FAIL: 版本四处不同步"; exit 1; }

echo "OK: r75 commander lease 过期有界自动重派 Golden Path 验证通过"
```

**通过标准**: 脚本 exit 0（三测试文件 18 passed + derive 含实现 + 版本四处同步）。

---

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作（纯函数改动，风险面小）
高风险面:
- 错输入: decisionLog 里 expired 行 detail 缺 role / 缺 failure_class → derive 不得崩溃，应按"非匹配"忽略（不计入 commander infra 计数）
- 重复提交: 同一 expired 行重复出现（相同 hop）→ 计数不得因去重歧义误判（hop 唯一，天然幂等）
- 中途中断: approve 消费末条 expired 后紧接又来一条新 expired（hop 更大）→ 新条序号应 = 之前总数+1，达上限判定正确
- 边界值: 恰好第 5 条 / 第 4 条 / 第 6 条；空 decisionLog；commander 与其它角色 expired 行交错
发现分级: P0/P1（丢数据/静默放行/死等）→ 阻塞 merge；P2/P3 → 记 findings 不阻塞

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| commander 有界重试（冻结合同） | `sprints/08252100-kernel-r75-commander-retry/tests/commander-lease-expired-retry-bounded.test.ts` | 单条 commander infra 过期（<上限）不再挂人审 / 边界 累计4条（第5条前）仍不挂人审 | → 2 failed（修前 wait，修后不 wait） |
| commander 有界重试（F1 gp 闸） | `tests/gp/f1/step3-commander-lease-expired-retry.test.js` | 单条 commander infra 过期（<上限）不再挂人审 / 边界 累计4条（第5条前）仍不挂人审 / 达上限 第5条expired / 超上限 第6条expired / 负向 非commander角色（planner）infra过期语义不变 / 负向 commander非infra失败（account_exhausted）语义不变 | → 2 failed |
| #5058 消费闭环（既有更新） | `tests/gp/f1/step3-route-unknown-review-approve-consume.test.js` | 达重试上限（5 条 expired）route_unknown 决策对象带 callbackHop / r75 未达上限（单条 commander 过期，<5）→ 不再挂人审 / 本地候选（pr=null）批准 → 候选头锚双匹配消费 | → 2 failed（rebase 到达上限场景后修前红） |

> Test File 列为完整真实路径（封印闸 assertTestContractResolvable + finalizer HEAD 树校验用此列解析）。冻结合同测试 = 首行 `sprints/<sprint_dir>/tests/` 那份；其余为补充/gp 闸行。
> **R2 修正（封印闸 FROZEN_CONTRACT_TEST_CONTRACT_UNRESOLVABLE 根除）**：本表「BEHAVIOR 覆盖」列每个覆盖名必须是对应 `it()` 名的**字面子串**（v9.5 规则）。R1 第 3 行两个覆盖名（`…（<5）不再挂人审`、`…批准 候选头锚…`）遗漏了 `it()` 名里 `（<5）` 与 `批准` 之后的 `→ ` 箭头，非连续子串 → assertTestContractResolvable 用 CI 同一解析链解析不到 → 封印拒。R2 已补齐 `→ `（`…（<5）→ 不再挂人审`、`…批准 → 候选头锚…`），三行全部覆盖名经 `grep -F` 逐条命中 `it()` 名（见 red-evidence.md「R2 覆盖名解析自证」）。测试文件本体与实现口径一字未改（R1 已 APPROVED）。
