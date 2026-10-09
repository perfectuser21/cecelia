# Bug PrepPRD：配额采集器三处止血（自造 429 / 同步掐死事件循环 / 失败擦白历史读数）

任务：`424d9dd2-09b6-4152-944b-e5d7c3e6c7bd`
归位：G5 管家 · 算力与基础设施调度 — step1「接单即选到有额度的执行体」
定位：刀 0，是「配额接进派单选号」（任务 `af677495`，决策 738c24f9）的前置。不修它，选号就是接在一条会自毁的数据源上。

## 症状

`ops_model_accounts` 表里两个 Claude 账号的 `five_hour_pct` / `seven_day_pct` 长期为 NULL，
`status=unknown`，`last_error='anthropic usage HTTP 429'`；Grok `key_expired`。
配额数据不可信 → 无法作为选号依据。

## 根因（0920 逐条验证）

### 根因 1：采集器没有自 gate，被 60s 轮询每分钟全量打 8 个账号

`scheduler-jobs.js:5-9` 声明调度模型是「统一 60s 轮询 + **模块自 gate**」，幂等由模块自己负责。
其余 job 的 description 都写明自带 gate（`arch-review` 4h 窗口、`ci-patrol` 08:00 窗口、
`feishu-task-ledger` 自 gate 60min）。而 `ops-model-accounts-collector`（`scheduler-jobs.js:110`）
的 handler 是裸的 `(pool) => runModelAccountsCollector(pool)`，函数体（collector:207-238）
是直接 for 循环采集，**没有任何时间 gate**。

后果：8 账号 × 60 次/小时 ≈ 480 次厂商 usage 调用/小时。Anthropic 的
`/api/oauth/usage` 有独立的高频限流（`account-usage.js:587-589` 已记录过这条教训），
于是两个 Claude 号恒 429。**这个 429 是我们自己造的。**

### 根因 2：`execSync` 串行 8 账号，最坏 240s 同步阻塞 Brain 事件循环

`host-exec.js:20` 的 `defaultExec` 用 `execSync`；collector:147-150 的 `defaultFetchUsage`
调它，`PROBE_TIMEOUT_MS=30_000`（collector:133），8 个账号**串行** for 循环（collector:212）。

最坏 8×30s = **240s 事件循环被同步卡死**。而 job 的 `timeoutMs:120_000`
（`scheduler-jobs.js:110`）走的是 `raceWithTimeout`（`scheduler-jobs.js:129-135`，Promise.race）
—— **对同步阻塞完全无效**，因为定时器根本没机会跑。

这 4 分钟里：dispatch tick 不跑、HTTP 不响应、kernel 租约续不上、心跳停。

### 根因 3：采集失败把上一轮真实读数擦成 NULL

collector:214 初始化 `snapshot = { ...EMPTY_SNAPSHOT }`，catch 分支（:228-231）
只设 `status` / `lastError`，**不回滚 snapshot**，然后 :233 无条件
`upsertModelAccount(pool, acct, snapshot, ...)`，而 upsert（:180-186）是
`five_hour_pct = EXCLUDED.five_hour_pct`。

于是 NULL 的真实语义是「**最近一次采集失败**」，不是「从来没查到」，更不含任何历史值。
一次抖动就把有效读数抹掉。

### 根因 3b（主理人 0920 补充）：单次失败就下结论，没有重试与跨轮确认

一次查不到可能只是网络抖动。当前代码单次失败即落 status 并擦白数据，
既没有轮内重试，也没有「连续 N 次才算数」的确认。

## 修法

### 修法 1：采集器自 gate 5min

`runModelAccountsCollector` 入口加时间闸：取 `MAX(last_checked_at)`，距今 < `COLLECT_INTERVAL_MS`（5min）
则直接返回 `{ skipped: true, reason: 'self_gate' }`。用表自身的 `last_checked_at` 做 gate，
天然幂等、无需新存储。

例外（必须绕过 gate）：
- `opts.only` 指定单账号（选号侧按需刷新单账号的接缝，刀 1 要用）
- `opts.force === true`

### 修法 2：异步化 exec

`host-exec.js` 新增 `defaultExecAsync`（`execFile` + promisify，同样的 timeout/maxBuffer/stdio 语义），
collector 的 `defaultFetchUsage` 改 async 并 await 它。
**保留原 `defaultExec` 不动**（其它调用方不受影响）。

并加全局预算：单轮全部账号探测总预算 ≤ 60s，超预算的剩余账号本轮跳过（保留上轮数据），
不再让单轮无限延长。

### 修法 3：失败不覆盖 pct + 分类重试 + 连续失败确认

**3a. 失败时只写 status/last_error/last_checked_at，不动 pct 列。**
upsert 拆成两条路径：成功 → 全列写；失败 → 部分列写（pct 列保持原值）。

**3b. 按错误类型决定是否轮内重试**（主理人 0920 拍板）：

| 错误类型 | 重试 | 理由 |
|---|---|---|
| ssh 不通 / 超时 / 网络 / 解析失败 | ✅ 重试 2 次（共 3 次尝试，退避 1s→2s） | 典型瞬时故障 |
| `rate_limited`（429） | ❌ 不重试 | 重试加剧限流——正是根因 1 要修的东西 |
| `key_expired` / `no_credential` | ❌ 不重试 | 确定性否定事实 |

需新增错误分类 `rate_limited`：当前 `classifyUsageError`（collector:111-115）把 429 归进
`unknown`，与「真没查到」混为一谈。

**3c. 连续失败计数，3 次才算数：**
表加列 `consecutive_failures INTEGER NOT NULL DEFAULT 0`（migration 455）。
- 成功 → 归零
- 失败 → +1；`consecutive_failures < 3` 时 **status 保持上一轮的值**，不落确定性失败、不告警
- `>= 3`（即 ≥15min 持续失败）→ 落确定性 status + 告警一次（走既有 `lib/alert-debounce.js`）

## 关联上下文

- 相关 Journey/能力格子：G5 step1「接单即选到有额度的执行体」
- 后继任务：`af677495`（配额接进派单选号，决策 738c24f9）
- 命中铁律：`29e7d8f8`（能力探针必须探真正要用的资源）、`3529e88f`（机械闸不得依赖 LLM 自愿配合）、
  `55f0d846`（jsonb `||` 是浅合并）
- 先例：`account-usage.js:585-613`（usage 429 ≠ 配额耗尽，B49 曾把健康账号判死导致 pipeline 卡死，
  修法是回退上次成功读数）——本次 3a 与它同源同解

## 判定点登记表

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|---|---|---|---|---|
| pct 为 NULL 时账号算不算可用 | ①当 0（乐观）②当 100（悲观）③弃权 | **③弃权**：不加分不减分，交给认证失败/真 429 回调等其它闸决定 | 主理人 0920 拍板。当 100 → 今天两个 claude 号全灭 + grok 已过期 → 只剩共因失败的 codex → 全线停派；当 0 → 真耗尽的号被反复选中，`capability-gate.js:190-196` 记录的 2026-08-19 三起生产事故（run 4c867fb4/2150e1b7/80459597）即此代价 | 全线停派 or 整跑作废 |
| 单次采集失败算不算真失败 | ①单次即判定 ②轮内重试 ③重试+连续 N 轮确认 | **③**：可重试类错误轮内重试 2 次；连续 3 轮失败才落确定性 status 并告警 | 主理人 0920 拍板："可能是网络抖动，连续三次失败你才能告诉我这是有问题的" | 误报账号故障 / 擦白有效数据 |
| 429 要不要重试 | ①一并重试 ②不重试退到下一轮 | **②不重试** | 429 是限流，立即重试加剧限流，与根因 1 同源 | 自造 429 雪上加霜 |

## 影响范围

- `packages/brain/src/ops-model-accounts-collector.js`（主改）
- `packages/brain/src/host-exec.js`（新增 async 接缝，不动原函数）
- `packages/brain/migrations/455_*.sql`（加 1 列）
- 读方 `routes/agent-ops.js:94`、`notion-push-sync.js:1137` 只做 `SELECT *` / 指定列，加列不影响
- **不动** `llm-capacity.js` / `account-usage.js` / `capability-gate.js` —— 那是刀 1 的范围

## 验收标准

- [ ] commit-1：failing test 先落（红灯先行）
- [ ] commit-2：实现让它变绿
- [ ] **自 gate**：连续调用两次 collector，第二次返回 `skipped`，且 exec 接缝调用次数不增加；`only`/`force` 能绕过
- [ ] **异步**：collector 不再 import 同步的 `defaultExec`；注入计时 exec 断言单轮总预算 ≤ 60s
- [ ] **失败不擦白**（变异测试锚）：先成功写一轮（pct=42），再注入 throw exec 跑一轮，断言库里 pct 仍是 42
      —— 把 catch 分支改回覆盖 NULL，此测试必须变红
- [ ] **重试**：注入前 2 次 throw、第 3 次成功的 exec，断言最终 status=ok 且 pct 落库
- [ ] **429 不重试**：注入恒抛 429 的 exec，断言 exec 只被调用 1 次，status 分类为 `rate_limited`
- [ ] **连续失败确认**：连续 2 轮失败时 status 保持上轮值且不告警；第 3 轮才落确定性 status + 告警 1 次
- [ ] 守卫落 `tests/gp/g5/step1-*.test.js`，真 import 被改模块、不 mock 它
- [ ] CI 全绿
- [ ] 部署后生产验证：`ops_model_accounts` 里 claude 两个号的 `last_error` 不再是 429，pct 有真实数值

## 不包含（刀 1 范围）

- 账号 id 命名映射统一（`account1` ↔ `claude-account1`）
- `isAccountUsable` 扩到全 provider、读配额表
- 阈值统一到单一来源常量（5h≥95 / 7d≥90）
- 登记口服务端强制补号、`payload.executor_account` 写入
