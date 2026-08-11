# Sprint Contract Draft (Round 1)

**journey_type**: autonomous
**target_environment**: local_api（纯 Brain 后端选号逻辑；本 attempt postgres=false → 行为验证走 vitest，DB 真派发属接缝，见「未覆盖真实链路清单」）

gp-anchor: skipped (product-map.json not found)
contract-gate: applies (packages/brain/src/lib/contract-gate.js 存在，cecelia worktree)

## 锚定父路声明

覆盖父路 F1 开发闭环 journey e6f803f2 · 步1「接单进车间即分档」(3bf6c116)：本 sprint 修复该父路派发环节的账号选号裂脑（capped 账号被喂任务→429 判死），属该步「动作=修复」。

---

## Response Schema（推导来源: PRD 无 HTTP 响应 → 函数级契约由 api_registry N/A，属内部模块改动）

**HTTP 响应**: `N/A — 任务无 HTTP 响应`（纯 Brain 内部派发/选号逻辑，无新增/改动端点）。

本 sprint 契约的「可机检 oracle」是模块级函数契约，测试逐条 codify：

### `expandUnresolvedAccountTargets(targets, opts?)`（packages/brain/src/orchestrator/preflight/execution-targets.js）

新增**可选**第二入参 `opts`（缺省时行为与既有静态白名单展开**完全一致**，零回归）：

```
opts = {
  isAccountCapped?: (target) => boolean,               // capped 谓词；数据源 account-usage.isSpendingCapped
  accountUsage?: { [accountId]: { five_hour_pct?: number, seven_day_pct?: number } },
  sevenDayCapPct?: number                              // seven_day 硬过滤阈值，缺省 = SEVEN_DAY_CAP_PCT(95)
}
```

- `opts` 提供时，展开后候选按序处理：① 剔除 `isAccountCapped(target) === true` 的账号；② 剔除 `seven_day_pct >= sevenDayCapPct` 的账号（**硬过滤，只看 seven_day，不看 seven_day_omelette**）；③ 存活者按 `five_hour_pct` 升序（缺省按 0）**稳定**排序（并列保持白名单声明顺序）。
- `opts` 缺省、或 `isAccountCapped` 抛错、或 `accountUsage` 缺 key → 该账号按「可用/五时 0」处理，**绝不 crash、绝不误剔除好账号**（降级铁律）。
- **禁用字段**：过滤判据禁止使用 `seven_day_omelette_pct` 作为唯一/首要依据（该字段可能缺失，缺失按 0 会误判 capped 账号为健康——正是当天事故根因）。

### `isAccountSevenDayCapped(usageRow, capPct?)` + `SEVEN_DAY_CAP_PCT`（packages/brain/src/account-usage.js，新增导出）

单一事实源的 seven_day 硬过滤谓词，两条路径（kernel expand 与 relay selectBestAccount）共用：

```
SEVEN_DAY_CAP_PCT = 95
isAccountSevenDayCapped(usageRow, capPct = SEVEN_DAY_CAP_PCT) => (usageRow?.seven_day_pct ?? 0) >= capPct
```

---

## 已知约束（来自回归测试 + 铁律 + 累积 FR）

- [回归测试] `packages/brain/src/orchestrator/preflight/execution-targets.test.js` → `expandUnresolvedAccountTargets` 无 opts 时必须保持白名单声明顺序 `[account1, account2]` / codex `[team2, team1, team3, team4, team5]` / model 字段保留 / 白名单外组合展开为空。**本 sprint 的 opts 扩展不得破坏这些既有断言。**
- [回归测试] `packages/brain/src/orchestrator/preflight/execution-targets-capped.test.js` → `resolveExecutionTarget` 的 `is_account_capped` 短路/降级/blocked 语义（4 条）不得回退。
- [回归测试] `src/__tests__/account-usage.test.js`（71）/ `src/spawn/middleware/__tests__/account-rotation.test.js`（8）/ `src/orchestrator/__tests__/dispatcher.test.js` → 既有选号/轮换/派发行为零回归。
- [累积FR] 本 line 暂无历史（PRD `## 累积 FR` 段：本 line 暂无）；context-manifest 端点本环境不可达（postgres=false / 无 Brain server）→ 记 `context-manifest: unavailable`，不静默跳过。
- [设计契约] `execution-targets.js:58-70` 注释：is_account_capped 谓词由调用方从 account-usage 单一事实源注入；CAPPED 与 exhausted 同等跳过；未注入/抛错 → 按 `!capped` 语义安全处理。

## 历史约束三源加载（铁律 → INV 映射）

| 铁律（PRD Invariant 段） | 本 sprint 映射 |
|---|---|
| [降级铁律] capped 谓词未注入/抛错 → 按 `!capped` 安全处理，绝不 crash/误跳好账号 | → INV-1（DoD B-04/B-05 覆盖：无 opts 保持声明顺序；谓词抛错不 throw、账号全保留）|
| [validation-clock] evaluator PR 校验时钟 fail-closed（gear=hotfix 例外）| N/A：本 sprint 不改 evaluator/judge 流程（PRD 边界）|
| [证据排序] evaluator .brain-result.json 一手证据排进 judge 窗口 | N/A：proposer 侧不产 evaluator 证据；本条约束 evaluator 角色 |
| [验证命令实跑] 合同验证命令写入前须实跑确认 exit code 语义（vitest include 范围外绿态也 exit 1）| → 已遵守：所有 BEHAVIOR 命令均已实跑（见 E2E 验收记录）。sprint 测试经**根 vitest 配置**（`sprints/**` 在 include）从 `/workspace` 跑；零回归测试经 **packages/brain vitest**（`src/**` 在 include）跑——两者 include 范围均已核实，不踩「范围外 exit 1」坑 |

---

## Golden Path

[kernel 派发 task] → [Step 1 展开候选] → [Step 2 注入 capped 谓词 + seven_day 硬过滤 + five_hour 次级排序] → [Step 3 解析出非 capped 账号] → [Step 4 人工钉号入口打通] → [attempt 落非 capped 账号]

### Step 1: kernel 派发 account 未解析的候选，按白名单展开
**来源**: `[FROM_PRD]` — PRD 缺陷链第 2 环 / 预期受影响文件 execution-targets.js。

**可观测行为**: `expandUnresolvedAccountTargets([{provider:'claude',account:null,machine:'us-mac-m4'}])`（无 opts）展开为 `[account1, account2]`，保持白名单声明顺序（既有行为，零回归基线）。

**验证命令**:
```bash
cd /workspace && npx vitest run sprints/08121550-account-capped-wiring/tests/account-capped-wiring.test.ts -t "B-04" --reporter=dot
# 期望：exit 0（声明顺序 [account1, account2] 不变）
```
**硬阈值**: exit 0；无 opts 时展开结果与既有断言逐字相等。

---

### Step 2: 注入 capped 谓词 + seven_day 硬过滤 + five_hour 次级排序
**来源**: `[FROM_PRD]` — PRD 必须实现第 1/2/4 环 + Golden Path 步骤 2。

**可观测行为**:
- account1 CAPPED（谓词真值）→ 从候选中剔除；
- account1 `seven_day=100`、`five_hour=0`、`seven_day_omelette` 字段缺失 → 硬过滤剔除（不因 omelette 缺失按 0 判健康）；
- 两账号 seven_day 均低、仅 five_hour 不同 → 存活者按 five_hour 升序。

**验证命令**:
```bash
cd /workspace && npx vitest run sprints/08121550-account-capped-wiring/tests/account-capped-wiring.test.ts -t "B-02" --reporter=dot
cd /workspace && npx vitest run sprints/08121550-account-capped-wiring/tests/account-capped-wiring.test.ts -t "B-03" --reporter=dot
# 期望：B-02 剔除 seven_day=100 账号；B-03 five_hour 升序 [account2, account1]
```
**硬阈值**: exit 0；`isAccountSevenDayCapped({seven_day_pct:100})===true`、`SEVEN_DAY_CAP_PCT===95`。

---

### Step 3: 解析出非 capped 账号（核心红线）
**来源**: `[FROM_PRD]` — PRD 验收断言「核心红线」+ Golden Path 步骤 3。

**可观测行为**: account1 CAPPED + seven_day=100、account2 正常 → 展开候选排除 account1，`resolveExecutionTarget` 解析出的 `target.account === 'account2'`（解析出 account1 即判失败）。

**验证命令**:
```bash
cd /workspace && npx vitest run sprints/08121550-account-capped-wiring/tests/account-capped-wiring.test.ts -t "B-01" --reporter=dot
# 期望：exit 0（expanded===['account2']，resolved.target.account==='account2'）
```
**硬阈值**: exit 0；解析账号 === account2。

---

### Step 4: 打通人工钉号入口（第 5 环）
**来源**: `[FROM_PRD]` — PRD 必须实现第 5 环 + 预期受影响文件 harness-skill-relay.js。

**可观测行为**: `spawnSkillRelaySession` 构造 `acctOpts` 时，若 `task.payload.CECELIA_CREDENTIALS` 存在，把它带进 `acctOpts.env`，`account-rotation.resolveAccount` 收到该显式凭据（既有 explicit 入口生效）。

**验证命令**:
```bash
cd /workspace && npx vitest run sprints/08121550-account-capped-wiring/tests/manual-pin-relay.test.ts -t "B-06" --reporter=dot
# 期望：exit 0（resolveAccount 收到 env.CECELIA_CREDENTIALS === 'creds-account2'）
```
**硬阈值**: exit 0；resolveAccount 收到的 env.CECELIA_CREDENTIALS === payload 值。

---

### Step 5: 降级铁律不回归（谓词未注入 / 抛错）
**来源**: `[AI_ADDED]` — GAN Round 1 Proposer 加入，理由：PRD Invariant「降级铁律」是本单最高优先安全线，必须有 1:1 可执行守卫，防止「接线」引入 crash 或误剔除好账号的回归。

**可观测行为**: 不注入 opts → 保持声明顺序；`isAccountCapped` 抛错 → 不 crash 且两账号全保留。

**验证命令**:
```bash
cd /workspace && npx vitest run sprints/08121550-account-capped-wiring/tests/account-capped-wiring.test.ts -t "降级铁律" --reporter=dot
# 期望：exit 0（B-04 + B-05 均绿）
```
**硬阈值**: exit 0；抛错路径不 throw、账号集合 == {account1, account2}。

---

## 禁 mock 边清单

本单涉及**派发/选号决策**（dispatcher 注入谓词）、**跨模块数据传递**（capped/额度数据在 account-usage → dispatcher → execution-targets → resolveExecutionTarget 间接力）、**DB 读路径**（account-usage 读 account_usage_cache）——按 v9.12 硬规则，被改的边禁 mock：

- `expandUnresolvedAccountTargets` ↔ 额度/capped 过滤排序逻辑（本单改了该函数）→ 测试**真调**该函数，断言真实返回，不 `vi.mock`/stub 它。
- `expandUnresolvedAccountTargets` → `resolveExecutionTarget` 候选接力（本单靠这条边把过滤后的候选交给解析器）→ 测试真调两者串联（B-01），不 mock。
- `harness-skill-relay` 构造 acctOpts ↔ `account-rotation.resolveAccount` 透传（本单改了 acctOpts 构造）→ 测试**真调** `spawnSkillRelaySession`（acctOpts 构造逻辑真实执行），仅把 `resolveAccountFn` 注入为**捕获间谍**（account-rotation 是外层依赖边界，非被改逻辑本身），断言它收到的 env 携带凭据。

**允许注入（非被改的边，属外层数据源边界）**：`isAccountCapped` 谓词与 `accountUsage` 数据（代表 account-usage 从 DB 读到的用量快照）以内存值注入——因为本 attempt postgres=false，真 DB 读属接缝（见下）；被改的**选择/过滤/排序逻辑本身**全部真跑，未被替身顶替。

---

## 真实调用方请求 shape

`N/A` — 本单无「外部设备/agent 调服务端」的新请求 shape。`CECELIA_CREDENTIALS` 是 Brain 内部 `task.payload` 字段（运维钉号入口），非外部调用方认证；`account-rotation.resolveAccount` 既有 explicit 入口 `opts.env.CECELIA_CREDENTIALS` 不变，本单只是把 payload 值接进去。

## 未覆盖真实链路清单（含 mock 豁免登记）

本 attempt `runtime_resources.postgres=false`，以下真实链路点在**本地 evaluator 环境无法真跑**，登记如下（controller 会原样呈现进 PR 描述，不静默）：

| 真实链路点 | 为什么本环境未覆盖 | 真验证补位计划 |
|---|---|---|
| dispatcher 真派发一个 task → `harness_attempts.account_id` 落**非 capped** 账号（PRD「集成」断言）| postgres=false，本 attempt 无 DB，无法起真派发+查 attempt 表 | generator 新增 pg 集成测试（`src/__tests__/integration/*.pg.integration.test.js`）并登记进 `vitest.config.js` 的 `POSTGRES_INTEGRATION_TESTS`，由 **brain-integration** CI job（真 Postgres）执行；本地标 `logic-done-pending` |
| account-usage 从真实 `account_usage_cache` 读 `is_spending_capped` / `seven_day_pct`（单一事实源真读）| postgres=false | 单测以注入 `accountUsage`/`isAccountCapped` 快照覆盖过滤逻辑；真 DB 读由上条 pg 集成测试 + 既有 `account-usage.test.js`（含 `__setAccountUsageForTest` 注入）覆盖 |
| dispatcher 端到端真注入 `is_account_capped: (t)=>isSpendingCapped(t.account)` 谓词到 expand/resolve | dispatcher 走 preflightGate/DB，端到端真派发属集成层 | 纯逻辑（过滤/排序/接力）由 B-01~B-05 单测覆盖；dispatcher 接线由零回归 `dispatcher.test.js` + 上条 pg 集成测试守 |

（无 `force_*`/假图类 mock；上述均为 postgres=false 导致的 DB 接缝，非逻辑 mock 豁免。）

### 接缝清单（接缝 vs 逻辑）

- **逻辑断言（环境无关，CI 绿 = 真 done）**：expand 过滤/排序、resolve 候选接力、`isAccountSevenDayCapped` 单一事实源、acctOpts 透传——全部 vitest 覆盖（B-01~B-06 + 零回归）。
- **接缝断言（真目标验，本环境 postgres=false → 标 `logic-done-pending`）**：`harness_attempts.account_id` 落非 capped 账号（真 PG）——由 brain-integration CI 真验，未真验前不标 done。

---

## 八要素需求规范

| 要素 | 说明 | 本次答案 |
|------|------|----------|
| **FR（做什么）** | 系统对外承诺做什么 | kernel 选号在派发前剔除 CAPPED 账号 + seven_day 打满账号，five_hour 仅次级排序；payload 钉号生效；capped/额度判定单一事实源 account-usage |
| **NFR（做得多好）** | 性能/可靠性/并发阈值 | seven_day 硬过滤阈值默认 >=95%（可配 `sevenDayCapPct`/`SEVEN_DAY_CAP_PCT`）；纯内存函数，无新增 I/O；无延迟 SLA（PrepPRD 未指定）|
| **Invariant（永不违反）** | 不变量 | 降级铁律：谓词未注入/抛错 → 按 `!capped` 处理，绝不 crash / 误剔好账号；无 opts 时展开顺序不变（零回归）|
| **判定点（怎么知道）** | 对模糊现实的判断假设 | 见下方登记表 |
| **保质期（何时过期）** | 何时失效 | seven_day 阈值随 Anthropic 配额政策可能调整 → 抽成可配常量 `SEVEN_DAY_CAP_PCT`，改一处即可退役旧阈值 |
| **死亡告警（停了谁知道）** | 停摆谁多久知道 | capped 谓词降级 / 显式账号已 capped 轮换 / all_targets_exhausted 均写 Brain 日志（`[account-usage]`/`[skill-relay]`）；全号 capped → resolveExecutionTarget 返回 blocked（非静默假死），既有告警链消费 |
| **失败语义（挂了怎么办）** | 故障放行/拦截 | 见下方失败语义声明 |
| **效果确认（已发≠已生效）** | 回执确认 | 选号结果由 `harness_attempts.account_id` 落库确认（真 PG，属接缝，brain-integration 验）；本地由函数返回值 + resolve 结果确认 |

### 判定点登记表（对模糊现实的判断假设）

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| ⚠️ 账号 seven_day 额度是否打满（真正导致 429 的维度）| A. 看 `seven_day_pct >= 95`; B. 看 `seven_day_omelette_pct >= 95` | A. `seven_day_pct >= SEVEN_DAY_CAP_PCT(95)` | omelette 字段可能缺失（缺失→按 0→误判健康），seven_day 才是 429 真因（PRD 第 4 环实证）| **静默把任务喂给已打满账号 → 429 判死、烧钱（当天 9b3a2609 烧 $7.75）**，面客 P0 任务无产出 |
| 账号是否 spending-capped | A. account-usage.isSpendingCapped（读 account_usage_cache 单一事实源）; B. 各路径自维护 | A. isSpendingCapped 单一事实源 | PRD 第 3/第 4 要求消除双系统裂脑 | 两套选号器分叉，capped 只在一套生效（当天 kernel-v1 仍落 account1）|
| （示例：微信群是否发送成功） | A. 监听按钮变灰; B. 读聊天记录 API | — | — | — |

> ⚠️ 行属「升拍板点主动请教用户」级别；本阈值 PrepPRD 已显式拍板「默认 >=95% 且可配」（PRD 假设段 + NFR），无需再确认。

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| capped 谓词未注入 | 按 `!capped` 处理（放行，账号全可用）| 是（纯函数无副作用）| 退化为既有静态白名单顺序 |
| capped 谓词抛错（account-usage 取数失败）| 捕获 → 按 `!capped` 处理，不 crash | 是 | 该账号按可用；不因取数失败误剔好账号 |
| accountUsage 缺某账号 key | 该账号 five_hour 按 0、seven_day 按 0（未打满）| 是 | 账号保留参与排序，不误剔除 |
| 全部账号 capped/exhausted | resolveExecutionTarget 返回 `blocked` + `all_execution_targets_exhausted`（非静默假死）| 是 | 上游 derive.js account_exhausted 非终态重派 |
| 显式钉号账号已 capped | 按既有 account-rotation fallback 轮换并记日志 | 是 | 轮换到下一可用账号 |

### 输入对抗面

`N/A` — 本单无对外暴露 agent / 外部可写入接口；`CECELIA_CREDENTIALS` 来自受信 Brain 内部 `task.payload`（运维/调度写入），非外部不可信输入。

---

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作（默认）
高风险面:
- 错输入: `accountUsage` 传畸形值（`seven_day_pct: "abc"` / `null` / `NaN` / 负数）→ 断言不 crash 且不把畸形账号误判为最优
- 重复提交: 同一 target 在候选里出现两次（显式 + 展开）→ 断言去重后仍按额度过滤/排序一次
- 中途中断: `isAccountCapped` 对部分账号抛错、部分正常 → 断言仅抛错账号按可用、正常账号照常过滤
- 边界值: `seven_day_pct` 恰好 = 95（阈值边界，`>=` 应剔除）/ = 94.999（应保留）；`five_hour_pct` 并列相等 → 断言稳定保持声明顺序
发现分级: P0/P1（选出 capped 账号 / crash / 误剔所有好账号）→ 阻塞 merge；P2/P3 → 记 findings 不阻塞

---

## E2E 验收

> journey_type=autonomous，target_environment=local_api。本 attempt postgres=false，DB 真派发属接缝（见「未覆盖真实链路清单」）；本脚本为 evaluator 模式 B final-e2e，跑 Golden Path 全程选号逻辑（sprint 行为红线全绿 + 既有单测零回归）。sprint 测试经根 vitest（`sprints/**` 在 include）从 /workspace 跑；零回归经 packages/brain vitest（`src/**` 在 include）跑。

```bash
#!/bin/bash
set -euo pipefail
cd "${WORKSPACE_PATH:-/workspace}"

# 1. Golden Path Step 1-5：本 sprint 行为红线全绿
#    （展开顺序零回归 + capped 接线 + seven_day 硬过滤 + five_hour 次级排序 + 核心红线 account2 + 人工钉号 + 降级铁律）
npx vitest run \
  sprints/08121550-account-capped-wiring/tests/account-capped-wiring.test.ts \
  sprints/08121550-account-capped-wiring/tests/manual-pin-relay.test.ts \
  --reporter=dot

# 2. 零回归：dispatcher / execution-targets / account-usage / account-rotation 既有单测全绿
cd packages/brain
npx vitest run \
  src/orchestrator/preflight/execution-targets.test.js \
  src/orchestrator/preflight/execution-targets-capped.test.js \
  src/orchestrator/__tests__/dispatcher.test.js \
  src/__tests__/account-usage.test.js \
  src/spawn/middleware/__tests__/account-rotation.test.js \
  --reporter=dot

echo "OK: Golden Path 账号选号验证通过（capped 接线 + seven_day 硬过滤 + five_hour 次级排序 + 人工钉号 + 零回归）"
```

**通过标准**: 脚本 exit 0（两段 vitest 均 exit 0）。
**接缝提醒**: `harness_attempts.account_id` 落非 capped 账号的真 DB 断言由 brain-integration CI（真 Postgres）覆盖，不在本脚本（postgres=false）。

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| capped 接线 + seven_day 硬过滤 + 次级排序 + 降级铁律 | `tests/account-capped-wiring.test.ts` | `B-01`、`B-02`、`B-03`、`B-04`、`B-05` | Round1 实跑：3 failed(B-01/B-02/B-03) / 2 passed(B-04/B-05 降级铁律守卫) |
| 人工钉号透传 | `tests/manual-pin-relay.test.ts` | `B-06` | Round1 实跑：1 failed（capturedEnv.CECELIA_CREDENTIALS === undefined）|

> 「BEHAVIOR 覆盖」列 `B-0N` 均为对应 `it('B-0N ...')` 测试名的字面子串（`grep -F 'B-01' tests/account-capped-wiring.test.ts` 命中）；「降级铁律」为 B-04/B-05 共同子串。
