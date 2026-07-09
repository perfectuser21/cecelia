# 设计文档：协议卫生包（失败分类重试 + 告警去抖 + 副作用幂等）

- 日期：2026-07-09
- Brain task：9f4b0647-fcfd-475a-8241-7cf40d57a06f（作战清单 T2，P2）
- Decision：4ea9dcc5（设计拍板）
- PrepPRD：docs/superpowers/specs/2026-07-09-protocol-hygiene-pack-prep-prd.md

## 目标

Brain 三个协议卫生缺口一次补齐：
1. 失败分类重试策略无 SSOT，timeout / 5xx 服务器错误没有独立 backoff。
2. 告警缺少通用「连续 N 次才响 + 冷却期」封装，去抖机制分散在 4 处各自为政。
3. 三类副作用入口（建任务 / spawn / 发通知）的去重全是进程内内存 Map，蓝绿部署重启即清零，无 DB 级幂等防线。

## 非目标

- 不统一 spawn 层 `retry-circuit.js`（attempt 级零 sleep 进程内循环，语义不同，显式豁免）。
- 不改 `raise()` 全局语义（25 处调用方零行为变更）。
- 不迁移 `routes/shared.js checkIdempotency`（内存 5min，保留，注释标注后续迁移方向）。
- 不碰 `harness-callback.js` 的 containerId claim 机制。
- 不动存量 `payload.failure_classification` 数据。

## 方案（三个组件）

### 组件 1：retry-policy 表化 SSOT

**新文件 `src/lib/retry-policy.js`**：纯查表模块，导出 `RETRY_POLICY`：

| 类别 | backoff 数组 | maxRetries | 语义 |
|---|---|---|---|
| `rate_limit` | [2, 4, 8] min | 3 | 指数（沿用现状） |
| `network` | [5, 10, 15] min | 3 | 线性长延迟（沿用现状） |
| `timeout` | [3, 6, 12] min | 3 | 新独立类 |
| `server_error` | [1, 5, 15] min | 3 | 新独立类（5xx） |

导出 `getBackoffMs(failureClass, retryCount)` 纯函数。文件头注释显式豁免 `spawn/middleware/retry-circuit.js` 并写明理由。

**改 `src/quarantine.js`**：
- `FAILURE_CLASS` 新增 `TIMEOUT` / `SERVER_ERROR`；`SERVER_ERROR_PATTERNS`（5xx / internal server error / service unavailable / bad gateway）和 `TIMEOUT_PATTERNS`（ETIMEDOUT / timed out）从 `NETWORK_PATTERNS` 拆出，分类顺序：rate_limit → server_error → timeout → network（更具体的先匹配）。
- `getRetryStrategy()`（约 L730）**签名与返回结构一字不动**（should_retry / next_run_at / needs_human_review / billing_pause / reason），内部 backoff 计算改查 retry-policy 表。
- `failureClassTTL`（约 L176-182）补 `timeout` / `server_error` 条目（否则新分类落默认 30min 分支）。

**下游瞬态判定同步（硬性，漏了会造成韧性回归——5xx/timeout 被误计失败误隔离）**：
- `src/lib/retry-policy.js` 导出 `isTransientClass(cls)` 帮助函数，集中判定 `['rate_limit','network','timeout','server_error','auth']` 类瞬态语义，替换下游散落的类别枚举：
  - `src/callback-processor.js:284`（transient API error 判定，决定 skipCount 不累计失败）
  - `src/routes/execution.js:680`（同类判定）
  - `src/quarantine.js:885`（`checkSystemicFailurePattern` 类别白名单，补新类别）
  - `src/routes/task-tasks.js:35`（类别枚举常量，补新类别）
- `src/thalamus.js:850-869` 有第二份独立分类 pattern 表（5xx/timeout 仍映射 `network`）：本次不重写该表（范围控制），但加 TODO 注释标注与 quarantine 分类不一致的风险及迁移方向。

### 组件 2：alert-debounce（opt-in）

**新文件 `src/lib/alert-debounce.js`**：
- `shouldFire(eventKey, {n, cooldownMs})`：按 eventKey 连续计数，`≥n` 才放行；放行后进入 cooldown 静默期。
- `resetDebounce(eventKey)`：成功/恢复路径清零计数。
- 内存 Map 上限 1000 + 过期 GC（抄 `notifier.js:24-27` 修 400MB 泄漏的写法）。接受重启清零的限制（P2 卫生包，不落 DB）。

**改 `src/alerting.js`**：`raise(level, eventType, message, opts)` 新增可选 `opts.debounce = {n, cooldownMs}`；不传完全走老路径。P0 分支注释明令禁止套 debounce（首击即响）。

**消费方示范**：接 1 个已知抖动型调用点（health-monitor 的 failCount 告警），验证三层串联（debounce → P0/P1 限流 → notifier 60s）不吞真告警。

### 组件 3：side_effect_dedupe 表 + 三入口接线

**Migration `326_side_effect_dedupe.sql`**：
```sql
CREATE TABLE side_effect_dedupe (
  id BIGSERIAL PRIMARY KEY,
  kind TEXT NOT NULL,
  dedupe_key VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  UNIQUE (kind, dedupe_key)
);
```

**新文件 `src/lib/dedupe.js`**：`claimDedupeKey(kind, key, ttlSec)`：
```sql
INSERT INTO side_effect_dedupe (kind, dedupe_key, expires_at)
VALUES ($1, $2, NOW() + ($3 || ' seconds')::interval)
ON CONFLICT (kind, dedupe_key)
  DO UPDATE SET expires_at = EXCLUDED.expires_at, created_at = NOW()
  WHERE side_effect_dedupe.expires_at < NOW()
RETURNING id;
```
- rowCount=1 → `{claimed:true}`；rowCount=0 → `{claimed:false}`。过期即重占，**无独立清理循环**（wave2 断链前科），janitor 每日 DELETE 兜底不在本 PR。
- 时间源全部 DB 端 NOW()，禁 JS Date.now() 混入。
- `releaseDedupeKey(kind, key)`：claim 后副作用执行失败时释放。
- **fail-open 拍板（注释写死）**：任何 DB 错误 → `{claimed:true, degraded:true}` + `raise('P2','dedupe_degraded')`。理由：通知宁可重复不可丢；spawn fail-closed 等于 DB 抖动全系统停派。
- key 超长由调用方 hash（lib 内对 >255 字符抛错提示）。

**三入口接线**：
1. **建任务** `src/actions.js createTask`：新增可选 `dedupe_key` 参数；claim 位置在 goal_id 校验和现有 title 24h 去重之后、INSERT 之前；INSERT 抛错同一 catch 内 `releaseDedupeKey`；被去重返回 `{success:true, deduplicated:true}`（沿用现有惯例）。kind=`create_task`。
2. **spawn** `src/executor.js` 派发决策层（triggerCeceliaRun 入口，与 :3382 already-running 检查同层）：key=task.id，kind=`spawn`，TTL 短（默认 120s，防 tick 重入双 spawn），被去重直接 return 已有派发结果语义。不改 `spawn/spawn.js`。
3. **发通知** `src/notifier.js`：`sendFeishu`/`sendBark` 支持可选 `dedupeKey` 参数，claim 异常全吞 + 带超时（保持 "never breaks main flow"），与 60s 内存限流共存（限流≠幂等）。kind=`notify`。

## 错误路径汇总

| 场景 | 行为 |
|---|---|
| dedupe 表 DB 挂/超时 | fail-open：claimed:true + degraded:true + P2 降级告警 |
| claim 成功后 INSERT tasks 失败 | releaseDedupeKey，TTL 内合法重试不被误挡 |
| 并发双 claim 同 key | ON CONFLICT 原子性，恰好一个 rowCount=1 |
| debounce 冷却结束后恢复期单次失败 | resetDebounce 由成功路径调用清零，不告警 |
| notifier DB 慢 | claim 带超时 + 异常全吞，通知照发 |

## 测试策略

档位：**unit 为主 + 少量 integration**（无 UI、无端到端行为面，E2E 不适用）。

- **unit（vitest，mock pg）**：
  - retry-policy：四类 backoff 查表、越界 retryCount、未知类别兜底；`isTransientClass` 对新旧类别的判定（回归断言：server_error/timeout 与 network 同为瞬态，不触发 repeated_failure 隔离路径）。
  - quarantine 分类：5xx → server_error、ETIMEDOUT → timeout、ECONNREFUSED → network、429 → rate_limit；failureClassTTL 新条目；getRetryStrategy 返回结构不变（回归断言字段名）。
  - alert-debounce：连续 N 次才放行、未连续被 reset 清零、冷却期静默、冷却结束恢复、Map 1000 上限 GC（fake timers）。
  - 组合行为：debounce 放行后 P0 5min 限流 + notifier 60s 限流串联，第一次真告警必达（防三层筛子吞真告警）。
  - dedupe：claim/重复 claim/过期重占/release/fail-open degraded/超长 key 抛错（mock pg 断言 SQL）。
  - createTask：带 dedupe_key 重复调用返回 deduplicated:true；INSERT 抛错释放 key。
  - executor 派发：同 task.id 二次派发被挡。
- **integration（真 DB，走 brain-integration 白名单）**：side_effect_dedupe 并发双 claim 竞态一条。
- 所有新测试可单文件跑（brain 全量 vitest 有环境级 OOM 前科）。

## 兼容性

- `getRetryStrategy` 返回结构不变 → 下游 `payload.failure_classification` 消费兼容；新失败的 5xx/timeout 分类标签变化是本任务的目的本身。
- `raise()` / `createTask` / `sendFeishu` 均为新增可选参数，存量调用零变更。
- migration 编号 326（当前最新 325），纯新增表无存量数据风险。
