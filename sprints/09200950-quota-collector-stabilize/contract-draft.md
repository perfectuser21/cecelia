# Contract Draft — 配额采集器三处止血（刀 0）

> **被测对象**：`packages/brain/src/ops-model-accounts-collector.js` + `packages/brain/src/host-exec.js`
> **任务**：`424d9dd2-09b6-4152-944b-e5d7c3e6c7bd`
> **归位**：G5 管家·算力与基础设施调度 — step1「接单即选到有额度的执行体」
> **验证目标**：`ops_model_accounts` 的数据能不能当选号权威（刀 1「配额接进派单选号」的前置）

守卫全部落在 `tests/gp/g5/step1-quota-collector-stabilize.test.js`，真 import 被改模块、不 mock。
下列条目均已实跑通过，且三条变异测试逐一验证过守卫会报红（见 ## 变异验证）。

---

## Feature 1: 采集器自 gate（停止自造 429）

**行为描述**：scheduler 是「60s 轮询 + 模块自 gate」，本采集器此前裸调用，等于每分钟全量打 8 个账号的厂商 usage API（≈480 次/小时），把两个 Claude 号打成 429。现加 5min 自 gate；`only`（按需刷新单账号，刀 1 选号侧要用）与 `force` 可绕过。另加单轮总预算 60s，超预算账号留到下一轮。

**硬阈值**：`COLLECT_INTERVAL_MS >= 5*60*1000`；gate 命中时厂商调用次数 = 0；`only`/`force` 时不跳过。

- [x] [BEHAVIOR] 距上次采集不足一个周期 → 返回 `skipped=true, reason='self_gate'`，且 exec 接缝零调用、零 upsert
  Test: `npm test -w packages/brain -- ../../tests/gp/g5/step1-quota-collector-stabilize.test.js -t "距上次采集不足一个周期"`
- [x] [BEHAVIOR] 超过一个周期 → 正常采集（`skipped` 为假且 exec 被调用）
  Test: `npm test -w packages/brain -- ../../tests/gp/g5/step1-quota-collector-stabilize.test.js -t "超过一个周期"`
- [x] [BEHAVIOR] `only` 与 `force` 均能绕过 gate —— 刀 1 的按需刷新接缝不能被自 gate 掐死
  Test: `npm test -w packages/brain -- ../../tests/gp/g5/step1-quota-collector-stabilize.test.js -t "必须能绕过 gate"`
- [x] [BEHAVIOR] 单轮总预算耗尽 → 剩余账号本轮跳过并返回 `budget_exhausted=true`
  Test: `npm test -w packages/brain -- ../../tests/gp/g5/step1-quota-collector-stabilize.test.js -t "单轮全部账号的探测有总预算"`

---

## Feature 2: 异步化（不许同步掐死 Brain 事件循环）

**行为描述**：`defaultExec` 是 `execSync`，8 账号串行 × 30s 超时 = 最坏 240s 同步阻塞事件循环（dispatch tick 不跑、HTTP 不响应、kernel 租约续不上）。而 job 的 `timeoutMs` 走 `Promise.race`，对同步阻塞完全无效——那道超时闸是纸糊的。新增 `defaultExecAsync`（语义与同步版逐条对齐），采集器改用它；`defaultExec` 原样保留不惊动既有调用方。

**硬阈值**：采集器源码中不得出现裸 `defaultExec`（后面不接 `Async`），且必须出现 `defaultExecAsync`。

- [x] [BEHAVIOR] 采集器不再引用同步 `defaultExec`，只用异步接缝
  Test: `npm test -w packages/brain -- ../../tests/gp/g5/step1-quota-collector-stabilize.test.js -t "不得使用同步的 defaultExec"`
- [x] [ARTIFACT] `host-exec.js` 导出 `defaultExecAsync`，且原 `defaultExec` 仍在（既有调用方不受影响）
  Test: `bash -c "grep -q 'export async function defaultExecAsync' packages/brain/src/host-exec.js && grep -q 'export function defaultExec(' packages/brain/src/host-exec.js"`

---

## Feature 3: 失败不擦白历史读数

**行为描述**：旧实现失败后仍以 `EMPTY_SNAPSHOT` 走全列 upsert，一次抖动就把上一轮真实读数抹成 NULL——于是表里 NULL 的语义变成「最近一次采集失败」而不是「没查到」，读侧无从分辨，配额数据也就不能当选号权威。现拆出 `upsertModelAccountFailure`：只写 status/last_error/计数/时间戳，不碰 pct 列。

**硬阈值**：失败路径 SQL 不含 `five_hour_pct =` / `seven_day_pct =`；成功路径照常写 pct。

- [x] [BEHAVIOR] 采集失败时写库 SQL 不触碰 pct 列（上一轮真实读数留着）
  Test: `npm test -w packages/brain -- ../../tests/gp/g5/step1-quota-collector-stabilize.test.js -t "不得触碰 pct 列"`
- [x] [BEHAVIOR] 采集成功时正常写 pct（成功路径不受影响）
  Test: `npm test -w packages/brain -- ../../tests/gp/g5/step1-quota-collector-stabilize.test.js -t "采集成功时正常写 pct"`

---

## Feature 4: 单次失败不算数（主理人 0920 判定）

**行为描述**：一次查不到可能只是网络抖动。可重试类错误轮内重试 2 次（共 3 次，退避 1s→2s）；429 不重试（重试加剧限流，与 Feature 1 的根因同源），并新增独立分类 `rate_limited`——此前 429 归 `unknown`，与「真没查到」混为一谈；`key_expired`/`no_credential` 是确定性否定事实，不重试。连续失败计数在 SQL 里 `+1`/归零，status 用 `CASE` 在未达 3 轮前保持上一轮值（不做 SELECT 判态再 UPDATE，铁律 `761f242b`），连续 3 轮（15min）才告警一次。

**硬阈值**：可重试错误 exec 调用 3 次；429/key_expired/no_credential 各调用 1 次；`consecutive_failures` 在 SQL 内自增；告警仅在计数 == 3 时触发一次。

- [x] [BEHAVIOR] ssh/网络/超时类错误 → 轮内重试，第 3 次成功即算 `ok`
  Test: `npm test -w packages/brain -- ../../tests/gp/g5/step1-quota-collector-stabilize.test.js -t "第 3 次成功即算成功"`
- [x] [BEHAVIOR] 429 只调用一次（不重试），状态为独立分类 `rate_limited`
  Test: `npm test -w packages/brain -- ../../tests/gp/g5/step1-quota-collector-stabilize.test.js -t "429 一律不重试"`
- [x] [BEHAVIOR] `key_expired` / `no_credential` 不重试（确定性否定事实）
  Test: `npm test -w packages/brain -- ../../tests/gp/g5/step1-quota-collector-stabilize.test.js -t "确定性否定事实"`
- [x] [BEHAVIOR] 连续失败计数在 SQL 里自增，且用 CASE 决定是否落确定性 status（无 SELECT-then-UPDATE）
  Test: `npm test -w packages/brain -- ../../tests/gp/g5/step1-quota-collector-stabilize.test.js -t "连续失败计数在 SQL 里自增"`
- [x] [BEHAVIOR] 连续失败未达 3 次 → 不告警；刚好第 3 次 → 告警一次；第 4 次起不再重复
  Test: `npm test -w packages/brain -- ../../tests/gp/g5/step1-quota-collector-stabilize.test.js -t "连续失败"`
- [x] [BEHAVIOR] 成功一轮后连续失败计数归零
  Test: `npm test -w packages/brain -- ../../tests/gp/g5/step1-quota-collector-stabilize.test.js -t "计数归零"`
- [x] [ARTIFACT] migration 455 为 `ops_model_accounts` 加 `consecutive_failures` 列
  Test: `bash -c "test -f packages/brain/migrations/455_ops_model_accounts_failure_streak.sql && grep -q consecutive_failures packages/brain/migrations/455_ops_model_accounts_failure_streak.sql"`

---

## 变异验证（守卫 proven-to-fire）

守卫必须亲眼见它报红过一次才算守卫。三条变异逐一验过：

| 变异 | 报红的守卫 |
|---|---|
| 失败路径改回走全列 upsert | 「采集失败时写库不得触碰 pct 列」 |
| 去掉自 gate 的 return | 「距上次采集不足一个周期 → 跳过，且一次厂商调用都不发」 |
| `isRetryableStatus` 放开 429 | 「429 一律不重试」 |

还原后 15/15 全绿。

- [x] [BEHAVIOR] 全部守卫在未变异状态下通过
  Test: `npm test -w packages/brain -- ../../tests/gp/g5/step1-quota-collector-stabilize.test.js`

---

## 合并后需人工确认（不在 CI 内）

生产 `ops_model_accounts` 里 claude 两个号的 `last_error` 不再是 `anthropic usage HTTP 429`、pct 有真实数值。

- [x] [ARTIFACT] PrepPRD 与判定点登记表已落盘
  Test: `bash -c "test -f sprints/09200950-quota-collector-stabilize/prep-prd.md"`

---

## 不在本合同范围（刀 1）

账号 id 命名映射统一、`isAccountUsable` 扩到全 provider 读配额表、阈值收敛到单一来源常量（5h≥95 / 7d≥90）、登记口服务端强制补号写 `payload.executor_account`。
