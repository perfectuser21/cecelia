# Sprint Contract Draft (Round 1)

**Sprint**: Diff Impact Gate 透传确定性 reason_code + fail-closed 出口（r19 / r23 全链验证）
**journey_type**: autonomous
**target_environment**: local_api
**contract-gate**: present (cecelia worktree, packages/brain/src/lib/contract-gate.js 存在，走代码层 gate)

## 锚定父路声明

覆盖父路 journey e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29 / step aad25bdb-bdd6-47f4-9a99-e1176e23ac8b（Diff Impact Gate 编码后闸 fail-closed 出口）第 1-3 步。

gp-anchor: skipped (product-map.json not found)

## Response Schema（推导来源: PRD 明确 — evaluateDiffGate 返回对象，无 HTTP 端点）

本 sprint 无新增 HTTP 端点：被测对象是内部函数 `evaluateDiffGate(...)` 的返回 verdict 对象。
PRD Golden Path 第 2/3 步逐字定义了 3a 分支的返回字段，codify 如下。

### 函数: `evaluateDiffGate({ db, taskId, mapClient, headRevision, changedFiles, repo })` → Promise<verdict>

**确定性 stale 结论（`freshness.status ≠ 'fresh'` 且 `freshness.reason_code` 非空）**:
```json
{"gate": "impact_unknown", "reason": "<Mapper 原始 reason_code>", "reason_code": "<同上>", "retryable": false}
```
- `gate` (string, 必填): 字面量 `"impact_unknown"` — 来源 PRD 第 3 步
- `reason` (string, 必填): **原样透传** `mapperResult.freshness.reason_code` — 来源 PRD 第 2 步
- `reason_code` (string, 必填): 同 `reason`，携带确定性码 — 来源 PRD 第 2 步
- `retryable` (boolean, 必填): 字面 `false`（fail-closed 终态）— 来源 PRD 第 2/3 步

**真·瞬时 stale（`reason_code` 为 null/缺失，或 `freshness` 整体缺失）**:
```json
{"gate": "impact_unknown", "reason": "mapper_stale", "retryable": true}
```
- `reason` (string, 必填): 字面量 `"mapper_stale"` — 来源 PRD 边界情况
- `retryable` (boolean, 必填): 字面 `true`（可重试，不误杀）— 来源 PRD 边界情况

**Mapper 不可达（`mapperFn` throw）** — 本 sprint 不改，回归保护:
```json
{"gate": "impact_unknown", "reason": "mapper_unavailable", "retryable": true}
```

**禁用字段名 / 禁止行为**:
- 禁止在确定性 stale 分支返回 `reason: "mapper_stale"`（就是被修的 bug 本体）
- 禁止在确定性 stale 分支返回 `retryable: true`（fail-closed 终态要求 false）
- 禁止改动 `freshness.status === 'fresh'` 分支、revision/digest 对账、compare 流程（范围外）
- 禁止改动 `structure-gate.js`（同名 `mapper_stale`，本 sprint 明确不动）

## Golden Path

[编码任务进入 Diff Impact Gate] → [Mapper 复算返回确定性 stale 结论（携带 reason_code）] → [gate 透传真实 reason_code 并以 fail-closed 终态出口，orchestrator 停止空转]

### Step 1: 编码任务过 Diff Impact Gate，evaluateDiffGate 调用 Mapper 复算影响半径
**来源**: `[FROM_PRD]` — PRD Golden Path 第 1 步

**可观测行为**: `evaluateDiffGate` 读取 active impact contract 后调用注入的 Mapper（`mapClient`），
Mapper 返回 `{ freshness: { status: 'stale'|'unknown', reason_code: '<确定性码>' }, ... }`。

**验证命令**:
```bash
(cd packages/brain && npx vitest run --no-cache ./src/impact-contract/__tests__/diff-gate.test.js -t '步骤3a' 2>&1) | grep -Eq 'Tests .* passed' || { echo "FAIL: 3a 用例未全过"; exit 1; }
```
**硬阈值**: 步骤3a describe 下 5 条用例全 pass（无 failed）。

---

### Step 2: gate 检测 freshness.status ≠ 'fresh' → 按是否确定性判定透传与 retryable
**来源**: `[FROM_PRD]` — PRD Golden Path 第 2 步 + Invariant [fail-closed]/[不误杀]

**可观测行为**:
- `freshness.reason_code` 非空 → verdict `reason` 与 `reason_code` 原样等于该 code，`retryable=false`。
- `freshness.reason_code` 为 null / 缺失（含 `freshness` 整体缺失）→ 保留 `reason='mapper_stale'`, `retryable=true`。

**验证命令**:
```bash
(cd packages/brain && npx vitest run --no-cache ./src/impact-contract/__tests__/diff-gate.test.js -t '确定性 stale 结论透传 reason_code' 2>&1) | grep -Eq '1 passed|Tests .* passed' || { echo "FAIL: 确定性透传未通过"; exit 1; }
```
**硬阈值**: 确定性用例 pass，且断言 `reason==reason_code=='projection_revision_mismatch'` 且 `retryable==false`。

---

### Step 3: 可观测出口 — 确定性场景 gate='impact_unknown'、reason=<原始 code>、retryable=false，orchestrator 不再重试
**来源**: `[FROM_PRD]` — PRD Golden Path 第 3 步

**可观测行为**: 确定性 stale 时真实卡点码被暴露到 verdict（经 harness-gates.js gateReceipt line 30-31
`reason ?? reason_code`、`retryable ?? false` 透传，无需改 wiring）；瞬时 stale 仍可重试。

**验证命令**:
```bash
(cd packages/brain && npx vitest run --no-cache ./src/impact-contract/__tests__/diff-gate.test.js 2>&1) | grep -Eq 'Test Files .* passed' || { echo "FAIL: diff-gate 全量回归未通过"; exit 1; }
```
**硬阈值**: 整个 diff-gate.test.js 文件 pass（回归 + 新增全绿），无 failed。

---

## 已知约束（来自回归测试 + 累积 FR）

- [diff-gate.test.js] → evaluateDiffGate 需 DB + mapClient；Mapper 通过依赖注入构造确定性投影
- [diff-gate.test.js] → 没有 active contract 时 fail-closed，且不调用 Mapper（`reason:'contract_missing', retryable:false`）
- [diff-gate.test.js] → revision_mismatch / manifest_digest_mismatch 等对账失败保留 `retryable:true`（本 sprint 不动）
- [structure-gate.test.js] → 同名 `mapper_stale` 在编码前闸（structure-gate）语义独立，本 sprint 不得触碰
- [map-client.test.js] → `freshness: { status, reason_code }` 契约存在；stale 旧 revision 证据带 `reason_code:'projection_revision_mismatch'`
- [累积FR] context-manifest: 本 line（journey e6f803f2）golden-paths 均为 planned，无已验收历史行为，无回退风险
- [MAP_NOT_CONFIGURED] task.payload 未带 map_scope/map_repo，Unified Map 影响半径未注入，按 PRD 范围硬边界执行

## 历史约束三源加载

1. **铁律清单 → INV 覆盖**（见 contract-dod.md INV-1 / INV-2）
2. **累积 FR**（context-manifest）: 本 line 无已验收行为，`[累积FR] N/A`
3. **回归测试约束**: 见上「已知约束」

## 八要素需求规范

| 要素 | 说明 | 本次答案 |
|------|------|----------|
| **FR（做什么）** | Diff Gate 3a 分支：确定性 stale 透传 reason_code + fail-closed；瞬时 stale 保留可重试 | 见 Golden Path Step 1-3 |
| **NFR（做得多好）** | 纯分支逻辑，无新增 IO；判定 O(1)，无额外 Mapper 调用 | 无新增延迟 |
| **Invariant（永不违反）** | [fail-closed] 不可判定→impact_unknown 绝不假绿；[不误杀] 仅确定性码置 retryable=false | INV-1 / INV-2 |
| **判定点（怎么知道）** | 「是否确定性结论」= `freshness.reason_code` 非空/为空 | 见判定点登记表 |
| **保质期（何时过期）** | 无时效资源；reason_code 语义由 Mapper 侧维护（范围外） | N/A |
| **死亡告警（停了谁知道）** | 该分支回退到旧行为 → orchestrator 重现 `deny:impact:mapper_stale` 无限重试；由 harness run 卡死可观测 | 回归测试永久守卫 |
| **失败语义（挂了怎么办）** | 见失败语义声明表 | 见下 |
| **效果确认（已发≠已生效）** | 每条路径由 evaluateDiffGate 返回对象的 reason/reason_code/retryable 三字段确认 | 单测断言三字段 |

### 判定点登记表（对模糊现实的判断假设）

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| （示例：微信群是否发送成功） | A. 监听按钮变灰; B. 读聊天记录 API | A | 聊天记录 API 不稳定 | 静默丢消息 |
| ⚠️ Mapper 结论是否「确定性不可恢复」 | A. `freshness.reason_code` 非空即确定性; B. 维护确定性码白名单枚举 | A. reason_code 非空即确定性 | PRD ASSUMPTION：确定性结论以非空 reason_code 标识；map-client 已透出该字段 | 误判：把瞬时 stale 当确定性→置 retryable=false→误杀可恢复场景（漏放行）；反向：把确定性当瞬时→retryable=true→回退到无限重试空转 |

> ⚠️ 判定点已在 PrepPRD/PRD ASSUMPTION 中明确采用「reason_code 非空 = 确定性」口径，notes 无待确认项。

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| 确定性 stale（reason_code 非空） | 返回 impact_unknown + 真实 code，`retryable:false` 终态，orchestrator 停 | 是（纯函数无副作用；同输入同输出） | 无重试，暴露真实卡点等人工/上游修复 |
| 瞬时 stale（reason_code 空/缺失） | 返回 mapper_stale，`retryable:true` | 是 | orchestrator 可重试复算 |
| Mapper throw（不可达） | 返回 mapper_unavailable，`retryable:true`（本 sprint 不改） | 是 | orchestrator 可重试 |

### 输入对抗面（对外暴露 agent 必填）

N/A — 本 sprint 是 Brain 内部 harness 编码闸逻辑，无对外暴露 agent / 无外部用户可写入入口。

## 真实调用方请求 shape

N/A — 无「设备/agent 调服务端」场景。`evaluateDiffGate` 的调用方是同进程内 harness-gates.js
（`diffGate = evaluateDiffGate` 依赖注入），非跨进程/跨设备调用方；`mapClient` 是同进程注入函数。

## 未覆盖真实链路清单

- **Mapper（map-client HTTP 客户端）| 单测以注入 mapClient 替身控制成本 | 真验证补位**：map-client.test.js 已覆盖真实
  `freshness:{status,reason_code}` 契约（含 stale + `reason_code:'projection_revision_mismatch'`），
  本 sprint 被改的边（diff-gate 3a 分支逻辑）真实执行、不 mock；Mapper 作为外层边界注入替身属合规豁免。
- 无第三方 API、无支付/短信/LLM 依赖，规则 B 不适用。

## 禁 mock 边清单

本单改动属「状态机 / 终态判定」类（gate verdict 的 retryable 终态判定），按 v9.12 硬规则列禁 mock 边：

- **evaluateDiffGate 3a 分支逻辑 ↔ mapperResult.freshness（被改的边）**：测试必须真实调用 `evaluateDiffGate`，
  由真实 3a 逻辑读取 Mapper 返回的 `freshness.status`/`freshness.reason_code` 并计算 verdict——
  **禁止** stub/mock `evaluateDiffGate` 本身或其内部分支；`mapClient` 是被读取的**外层数据源**（合法注入替身），
  但 3a 的「读取→判定→透传」这条边必须真跑。
- **代码 ↔ DB（getActiveImpactContract）**：本 sprint 3a 分支在对账/写 gap 之前返回，**不触达任何 DB 写路径**；
  db 仅被 stub 返回 active contract 行（外层读边界），无 INSERT/UPDATE。故无 Postgres 依赖（runtime postgres:false 相容）。

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作（默认；纯逻辑分支，风险面有限）
高风险面:
- 错输入: `freshness.reason_code` 为空字符串 `''`（应视为「空」走瞬时 stale，还是确定性？本合同口径：`''` 为 falsy → 瞬时 stale retryable=true）；`freshness` 为 `null` / `undefined`
- 重复提交: 同一 verdict 多次求值幂等（纯函数，无副作用，应恒等）
- 中途中断: 不适用（无异步等待、无跨节点状态）
- 边界值: `status` 为非 `'fresh'` 的其它任意值（`'stale'`/`'unknown'`/`'expired'`）+ reason_code 非空 → 均应透传 fail-closed
发现分级: P0/P1（把瞬时 stale 误杀成 retryable=false，或把确定性 stale 漏成 retryable=true）→ 阻塞 merge；P2/P3 → 记 findings

## E2E 验收（final-e2e 跑 — target_environment=local_api，纯逻辑单测 oracle）

**journey_type**: autonomous
**target_environment**: local_api
**说明**: 本 sprint 无新增 HTTP 端点、无 DB 写路径（3a 分支在对账前返回），被测为 Brain 内部 gate
逻辑（环境无关的**逻辑断言**，CI/单测绿 = 真 done）。故 E2E 以「子 shell 切进 packages/brain 用其自身
vitest 配置跑目标测试文件」为 oracle（遵守 9.25.0 vitest 工作目录死规则，禁止从仓库根跑 packages/brain/src/**）。
无 Postgres 依赖（runtime postgres:false 相容：db 为 stub，mapClient 为注入替身）。

```bash
#!/bin/bash
set -euo pipefail

# 被测：Diff Impact Gate 步骤3a 确定性 reason_code 透传 + fail-closed 出口
# oracle：packages/brain 自身 vitest 配置跑 diff-gate.test.js（含新增 5 条 3a 回归用例）
cd "$(git rev-parse --show-toplevel)"

# 1. 目标文件全量回归（新增 3a 用例 + 原有 4 类情形回归，必须全绿）
(cd packages/brain && npx vitest run --no-cache ./src/impact-contract/__tests__/diff-gate.test.js --reporter=basic) \
  > /tmp/diff-gate-e2e.log 2>&1 || { echo "FAIL: diff-gate.test.js 未全绿"; tail -40 /tmp/diff-gate-e2e.log; exit 1; }
grep -Eq 'Test Files[[:space:]]+1 passed' /tmp/diff-gate-e2e.log || { echo "FAIL: Test Files 未 1 passed"; tail -40 /tmp/diff-gate-e2e.log; exit 1; }

# 2. 3a describe 子集单独复跑（确定性 + 瞬时 + 缺失 + throw 五路径）
(cd packages/brain && npx vitest run --no-cache ./src/impact-contract/__tests__/diff-gate.test.js -t '步骤3a' --reporter=basic) \
  > /tmp/diff-gate-3a.log 2>&1 || { echo "FAIL: 步骤3a 用例未全过"; tail -40 /tmp/diff-gate-3a.log; exit 1; }
grep -Eq 'Tests[[:space:]]+5 passed' /tmp/diff-gate-3a.log || { echo "FAIL: 3a 应 5 passed"; tail -40 /tmp/diff-gate-3a.log; exit 1; }

# 3. 防回退守卫：源码 3a 分支必须真的读取 reason_code 并可置 retryable:false（防「测试改了代码没改」假绿）
grep -Eq 'reason_code' packages/brain/src/impact-contract/diff-gate.js || { echo "FAIL: diff-gate.js 未透传 reason_code"; exit 1; }

echo "✅ Diff Impact Gate 3a 确定性透传 + fail-closed E2E 验证通过"
```

**通过标准**: 脚本 exit 0（diff-gate.test.js 全绿 + 步骤3a 5 passed + 源码含 reason_code 透传）。

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 3a 确定性 stale 透传 fail-closed | `packages/brain/src/impact-contract/__tests__/diff-gate.test.js` | 确定性 stale 结论透传 reason_code / unknown status 携带 reason_code 同样透传 / 瞬时 stale 无 reason_code 保留 mapper_stale / freshness 完全缺失视为瞬时 stale / Mapper 抛错仍为 mapper_unavailable | 已实测 RED：2 failed（确定性 + unknown 透传）\| 3 passed（瞬时/缺失/throw 守卫）
