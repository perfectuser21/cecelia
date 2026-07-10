# 小改动 PrepPRD：协议卫生包（失败分类重试 + 告警去抖 + 副作用幂等）

Brain task: 9f4b0647-fcfd-475a-8241-7cf40d57a06f（作战清单 T2，plan_seq=4，P2）

## 改什么

三件套，全部在 `packages/brain`：

### 1. 失败分类重试 SSOT（retry-policy 表化）
- 新建 `src/lib/retry-policy.js`：导出「失败类别 → backoff 数组 + maxRetries」查表，四类各自数组：
  - `rate_limit`: [2min, 4min, 8min]（指数，沿用现状）
  - `network`: [5min, 10min, 15min]（线性长延迟，沿用现状）
  - `timeout`: [3min, 6min, 12min]（新独立类，从 NETWORK 拆出）
  - `server_error`: [1min, 5min, 15min]（新独立类，5xx 从 NETWORK_PATTERNS 拆出）
- `src/quarantine.js`：新增 `TIMEOUT` / `SERVER_ERROR` 两个 FAILURE_CLASS + pattern 拆分；`getRetryStrategy()`（约 L730）签名与返回结构（should_retry/next_run_at/needs_human_review/billing_pause/reason）**一字不动**，内部改为查 retry-policy 表；`failureClassTTL`（约 L176-182）同步补两个新类别条目。
- retry-policy.js 文件头显式豁免 `spawn/middleware/retry-circuit.js`（attempt 级零 sleep 进程内循环，不消费分钟级 backoff）并写明理由，防止后人再来"统一"。

### 2. 告警去抖（连续 N 次才响 + 冷却期，opt-in）
- 新建 `src/lib/alert-debounce.js`：按 eventKey 计数，`连续 ≥N 次才放行 + 放行后进入 cooldown 期内静默`；导出 `resetDebounce(eventKey)` 供恢复路径清零；计数 Map 上限 1000 + 过期 GC（抄 notifier.js:24-27 修 400MB 泄漏的写法）。
- `src/alerting.js` `raise()` 新增第 4 个可选参数 `{debounce:{n, cooldownMs}}`：**不传完全走老路径**（25 处现有调用方零行为变更）；P0 事件注释明令禁止套 debounce（首击即响）。
- 先只接 1 个已知抖动型调用点作为消费方示范（health-monitor 或 publish-monitor 类抖动 eventType）。

### 3. 副作用 dedupe_key 幂等 + 短期去重表
- 新 migration `326_side_effect_dedupe.sql`：表 `side_effect_dedupe(id, kind, dedupe_key varchar(255), created_at, expires_at)`，`UNIQUE(kind, dedupe_key)`。
- 新建 `src/lib/dedupe.js`：`claimDedupeKey(kind, key, ttlSec)`，SQL 用 `INSERT ... ON CONFLICT (kind, dedupe_key) DO UPDATE SET expires_at=... WHERE side_effect_dedupe.expires_at < NOW() RETURNING id`，靠 rowCount 判断抢占成败（过期即重占，无独立清理循环）；时间源全部 DB 端 NOW()。
- **fail-open 拍板写死在注释**：DB 错误 → catch → 返回 `{claimed:true, degraded:true}` + `raise('P2','dedupe_degraded')`。宁可重复不可丢失/停摆。
- 三入口接线：
  - 建任务：`src/actions.js createTask` 新增可选 `dedupe_key` 参数，claim 放在 goal_id 校验和现有 title 24h 去重之后、INSERT 之前；INSERT 抛错则同一 try/catch 内 DELETE 该 key；被去重时返回 `{success:true, deduplicated:true}`（沿用现有惯例）。
  - spawn：接在 `executor.js` 派发决策层（triggerCeceliaRun 入口附近，与 :3382 already-running 检查同层），key 用 task.id；**不改 spawn/spawn.js、不碰 harness-callback.js 的 containerId claim**。
  - 发通知：`src/notifier.js` 发送前可选 claim（带超时、异常全吞，保持 "never breaks main flow"），与现有 60s 内存限流共存（限流 vs 幂等，语义不同）。
- `routes/shared.js checkIdempotency`（内存 Map 5min）保留不动，本次不迁移（避免变成第 6 套的方式是文档注明它后续应迁到 dedupe 表）。

## 为什么改

作战清单 T2：Brain 的重试策略散在 5 层无 SSOT 且 timeout/5xx 无独立退避；告警去抖机制分散、无通用「连续 N 次 + 冷却」封装；三类副作用去重全是进程内内存 Map，Brain 蓝绿部署重启即清零，重复建任务/重复 spawn/重复告警无 DB 级防线。

## 关联上下文
- 相关 Journey/Ability：无（agent_ops 基础设施卫生）
- 相关历史决策：decisions/match 无命中；铁律命中 2 条均为 harness 专属，不适用
- 对抗审查：1 轮 Challenger+混沌收敛，9 条 issue 全部采纳修正（锚点函数名、opt-in、fail-open、接线层级、UNIQUE 复合键、claim-then-fail 泄漏、三层限流叠加测试）

## 影响范围
- `getRetryStrategy()` 返回结构不变 → `payload.failure_classification` 下游消费兼容；但 5xx 从 network 拆到 server_error 会改变新失败的分类标签（存量数据不动）
- `raise()` opt-in 参数 → 25 处现有调用方零变更
- `createTask` 新增可选参数 → 向后兼容
- notifier claim 异常全吞 → 通知主流程不受 DB 抖动影响

## 验收标准
- [ ] retry-policy 四类各自 backoff 数组，quarantine 单测覆盖 timeout/server_error 新分类 + failureClassTTL 新条目
- [ ] alert-debounce 单测：连续 N 次才放行、冷却期静默、resetDebounce 清零、Map 上限 GC；组合行为测试（debounce × P0 5min 限流 × notifier 60s 串联不吞真告警）
- [ ] dedupe 单测：并发双 claim 只成一个、过期重占、fail-open 降级返回 degraded、createTask INSERT 失败释放 key
- [ ] 三入口接线各有测试（deduplicated:true 返回契约）
- [ ] 新测试可单文件跑（brain 全量 vitest 有 OOM 前科）
- [ ] CI 全绿
