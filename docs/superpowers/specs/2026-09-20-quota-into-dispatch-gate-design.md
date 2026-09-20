# 刀1 PR1：模型账号配额接进派单选号（核心闸）

> Brain task `36fd9416` ／ 决策 `738c24f9`（本体）、`129e7fcf`（范围修正）
> 五条 `judgment` 判定点：`7c4bf8d2` `54eb79e2` `8ead32b5` `4165f599` `2b38338e`
> 归位 **G5**「管家 · 算力与基础设施调度」step1「接单即选到有额度的执行体」

## 问题

刀0 把 `ops_model_accounts` 从假账本修成真值（生产实证：`claude-account1` 5h=11/7d=32、`claude-account2` 5h=16/7d=76），但**没有任何派发路径读它**。

`capability-gate.js:197` 是唯一真正参与 kernel attempt 派发的账号闸，它调用 `account-usage.js:688` 的 `isAccountUsable`，而后者只认 `ACCOUNTS = ['account1','account2']`；传 `team1..5` / `grok` 时 `u` 为 `undefined` → `:704 return true`。**8 个号里 6 个在选号层面没有任何额度判据。**

## 架构

### 新增：`packages/brain/src/orchestrator/preflight/account-quota-ledger.js`

判据模块。单一职责：把 `ops_model_accounts` 的一行翻译成一个三态裁决。

```
loadQuotaLedger(deps)      一次 SELECT 全表 8 行 → 进程内缓存（TTL 30s）
judgeAccount(row, { now }) → { verdict, reason, pct }
createAccountQuotaGate({ loadLedger, runtimeMarkerCheck, now })
```

**为什么是三态而不是布尔**：当前布尔把「数据说这个号满了」和「我读不到数据」压成同一个 `true`，这正是 2026-08-19 三起事故的根因形状（`capability-gate.js:190-196` 案卷）。

判据顺序（固定，判定点 `4165f599`）：

| 顺序 | 条件 | 裁决 | reason |
|---|---|---|---|
| 1 | 表里无此账号行 | `unknown` | `no_ledger_row` |
| 2 | `consecutive_failures > 0` | `unknown` | `reading_unverified` |
| 3 | `status ∈ {key_expired, no_credential}` | `unusable` | `credential_invalid` |
| 4 | `status = rate_limited` | `unknown` | `collector_rate_limited` |
| 5 | `five_hour_pct >= 95` | `unusable` | `five_hour_exhausted` |
| 6 | `seven_day_pct >= 90` | `unusable` | `seven_day_exhausted` |
| 7 | 两个 pct 皆 NULL | `unknown` | `pct_unknown` |
| 8 | 其余 | `usable` | — |

第 2 条是新鲜度判据（判定点 `8ead32b5`）：采集失败走 `upsertModelAccountFailure`，**不擦 pct、<3 轮保持上轮 status、却照刷 `last_checked_at`**（collector:228-247），所以时间戳不是新鲜度证据，`consecutive_failures` 才是。本刀不设陈旧时间阈值。

第 4 条不判死（判定点 `4165f599`）：`rate_limited` 判死会重演 B49 事故——`account-usage.js:585-613` 的注释记着「429 ≠ 配额耗尽，曾把健康账号判死导致 pipeline 卡死」。

**阈值边界**：`five_hour_pct` / `seven_day_pct` 是 `INTEGER` 列（migration 449:9-10），浮点由 PG 取整。所以「7d ≥ 90」的真实触发点是原始值 **89.5**，「5h ≥ 95」是 **94.5**。边界测试按 89.5/94.5 构造。

**与内存标记取 OR，不是替换**：`ops_model_accounts` 没有 `capped` / `authFailed` 列，而 `account-usage.js:690` 的 `isSpendingCapped` / `isAuthFailed` 是真撞 429 后由回调打上的。拍板输入③「NULL 弃权，交给真 429 回调决定」正依赖这条链——替换掉它，NULL 情形就彻底无人兜底。任一判死即判死。

### 阈值常量（只收敛派发闸这一组）

在判据模块导出：

```js
export const DISPATCH_GATE_FIVE_HOUR_PCT = 95;
export const DISPATCH_GATE_SEVEN_DAY_PCT = 90;
export const LEDGER_CACHE_TTL_MS = 30_000;
export const LEDGER_UNAVAILABLE_FAIL_CLOSED_MS = 15 * 60 * 1000;
```

**显式不动**（范围决策 `129e7fcf`）：

| 常量 | 位置 | 为什么不动 |
|---|---|---|
| `USAGE_THRESHOLD=80`、`SONNET_7D=100`、`OPUS_7D=95`、`HAIKU_7D=100` | `account-usage.js:19-22` | `:47` 的 5h 闸被 sonnet/opus/haiku **三档共用**，7d 侧三个阈值语义各异；收敛成单一 7d≥90 会让 haiku 在 90 就判不可用——而 haiku 的定位恰是「总量快满时的最后一档」，等于废掉兜底 |
| `QUOTA_LOW_PCT=90`、`QUOTA_CRITICAL_PCT=98` | `quota-guard.js:19-20` | 语义是**全局调度刹车**（>90 只派 P0/P1，>98 全停），经 `slot-allocator.js:637-643` 收编，不是账号可用性判据。收敛=把全局暂停线从 98 降到 95 |

`ops_model_accounts` 缺 `sonnet` / `omelette` / `extra_used` / 7d-reset 列，**只喂派发闸**，禁止当 `selectBestAccount` 的数据源。

### 账号 id 映射

`ops-model-accounts-collector.js` 的 `MODEL_ACCOUNTS` 每条补显式 `runtime_account_id`，并导出双向映射。

**禁止拼串规则**：表侧 `claude-account1` / `codex-team1` / `grok`，运行时侧 `account1` / `team1` / `grok`。`${provider}-${account}` 对 grok 得到 `grok-grok`，对不上——所谓「禁手写正则」最后还是要写一条特例。显式字段才是单一来源。

一致性守卫仿 `tests/gp/g5/step1-codex-account-pool-consistency.test.js`：`execution-targets.js` 的 `VERIFIED_TARGETS` 每个 account 都能映射到一条 ledger 行，反之亦然。

### 改造：`capability-gate.js`

```
循环前：  const quota = await probe(() => deps.loadAccountQuota(candidates))   ← 一次，不逐候选
循环内：  查 map
            unusable → fallbackReason='account_quota_exhausted'，记 perCandidateReason，continue
            unknown  → 放行，记 degraded
循环后：  无 selectedTarget 且存在因配额判死的候选
            → 保底：在判死候选里取 pct 最低的，照常走 providerAuth 探针
            → 成功则 selectedTarget + fallback_reason='account_quota_degraded_admit' + P0
```

四处关键点：

1. **包进 `probe()`**。当前 `:200` 是候选循环里唯一的裸 `await`——同循环的 `getMachineHealth` / `getMachineCapacity` / `probeProviderAuth` 全部走 `withTimeout`。判据改成读 PG 之后，一次 hang 住的查询会**无限期挂住整个 dispatch hop**，既不 fail-open 也不 fail-close，而是挂死且无任何 fallbackReason（us-vps postgres/tailscale bind race 已有先例）。
2. **一次读全表，不逐候选查询**。候选最坏是 codex 5 账号 × 计算机器 + claude 2 + grok 十几个；gate 自己的 `snapshotTtlMs` 只有 1 秒，没有可复用缓存层。原注释明写「不发网络请求，走本地缓存，中间件在派发热路径上」。
3. **保底放行**（判定点 `7c4bf8d2`）。`loop.js:1917-1924` 把 `infrastructure_blocked` 显式排除在 blocked-streak 之外，直接 `sleep(90s) + continue`——全灭不是判死，是**静默转圈到 run deadline**，且只发 P1 每小时汇总。按拍板阈值 7d≥90，现网 `claude-account2` 已到 76，周末尾 8 号同时越线不是极端情形。
4. **废除静默 catch**。`:199-202` 的 `catch { usable = true }` 吞掉异常且不记录任何东西——闸门消失且零痕迹。改为 `unknown` + `evidence.account_quota_gate_error` + 去抖告警。

`fallbackReason` 当前是单变量，后一个候选会盖掉前一个（`:205`），最终还统一成 `all_execution_targets_exhausted`。新增 per-candidate reason 数组进 evidence，让「8 个号分别为什么不能用」事后可查。

### 改造：`run.js`

`:280-282` 注入层的裸 `catch → true` 改为带 reason 的显式上报。

**fail-open 有三层**（`account-usage.js:704` / `run.js:280-282` / `capability-gate.js:199-202`），任一层吞异常都还原成「全部账号放行」。只对一层做变异测试等于假绿。

### 读不到数据的处置（判定点 `54eb79e2`）

`loadQuotaLedger` 失败（PG 挂 / 超时 / 表空 / 表不存在 42P01）→ 全部账号 `unknown('ledger_unavailable')`，记录首次失败时刻；**持续 ≥ 15 分钟**转 `unusable('ledger_unavailable_fail_closed')`。

> 明示假设：15 分钟 = 采集器自 gate 5min × `FAILURE_STREAK_THRESHOLD = 3`，与既有失败语义同源。

无论哪种都必须写 `evidence.account_quota_gate_degraded` + 去抖告警——**禁止静默**。

## 数据流

```
ops_model_accounts (PG, 采集器每 5min upsert)
        │  loadQuotaLedger  一次 SELECT，进程内缓存 30s
        ▼
  judgeAccount  三态裁决 ──OR── isSpendingCapped / isAuthFailed（内存标记，真 429 回调）
        │
        ▼
  capability-gate 候选循环（在 probe() 超时保护内）
        │  unusable → 跳过   unknown → 放行+degraded
        ▼
  全灭 → 保底放行 pct 最低的号 + P0 + degraded 标记
```

## 错误处理

| 场景 | 处置 |
|---|---|
| PG hang / 超时 | `probe()` 超时 → `unknown` + `account_quota_probe_timeout` + 告警 |
| PG 连接被拒 / 表不存在 | 全 `unknown('ledger_unavailable')`；≥15min 转 fail-closed |
| 表空 | 同上（系统未就绪），不静默 fail-open |
| 某账号无行 | `unknown('no_ledger_row')` + 映射一致性守卫应在 CI 就拦住 |
| 判据函数抛异常 | `unknown` + `evidence.account_quota_gate_error` + 去抖告警（**不再** `usable=true`） |
| 8 个号全判死 | 保底放行 pct 最低者 + P0 |
| 并发 run 涌向同一个号 | 本刀只在同 pct 档位加抖动；软预留/租约另立 |

## 测试策略

| 档 | 范围 | 跑在哪 |
|---|---|---|
| **unit** | `judgeAccount` 八条分支全覆盖；边界按 INTEGER 真实进位点 89.5/94.5；映射双向一致性 + 变异；保底放行；fail-closed 计时；**三层 fail-open 各自注入抛错** | `brain-unit`（无 PG，判据必须可注入 `deps.query`） |
| **integration** | 真 PG 读 `ops_model_accounts` | `brain-integration`（起 pgvector service + 跑 migration） |
| **GP 守卫** | `tests/gp/g5/step2-quota-gate-into-dispatch.test.js`，**真 import `capability-gate.js` 与 `account-quota-ledger.js`，不 `vi.mock`** | CI 闸 `lint-gp-anchor-artifact`（碰 `packages/brain/src/orchestrator/` 必须带） |

**变异测试是验收硬条件**（feedback：守卫必须变异测试才算数）：

1. 把 `capability-gate.js` 的 catch 改回 `usable = true` → 测试必红
2. 把 `run.js` 注入层改回裸 `catch → true` → 测试必红
3. 把 `judgeAccount` 改成恒返回 `usable` → 测试必红
4. 改错任一 `runtime_account_id` → 一致性测试必红

每条都要亲眼看它红过一次，没见过它报红的守卫不算守卫。

## 显式不做

- `ops_model_accounts` 补 tier 维度列（`sonnet` / `omelette` / `extra_used` / 7d-reset）
- pct 列 `INTEGER → NUMERIC(5,2)`（本刀按真实边界写测试，不改 schema）
- 采集器进程级互斥（DB advisory lock）
- 配额软预留 / 租约
- 清理 `execution-targets.js` 的死闸 `is_account_capped` 与 `derive.js:651-653` 的错误注释
- **PR2 内容**：dispatcher 跨 provider 扩池、`task-tasks.js` 白名单扩 grok、grok 探针 7d 真读

## 禁区

- **禁止**把判据加进 `execution-targets.js:76 resolveExecutionTarget`——全仓无生产调用方，`capability-gate.test.js:53-54` 记录过两次改错地方的教训
- **禁止**在登记口代写 `payload.executor_account`——`dispatcher.js:1109` 仅在 `account == null` 时展开白名单，补号会让候选塌缩成单账号
- **禁止**把 `ops_model_accounts` 当 `selectBestAccount` 的数据源
