# PRD: 协议卫生包（失败分类重试 + 告警去抖 + 副作用幂等）

Brain task: 9f4b0647-fcfd-475a-8241-7cf40d57a06f（作战清单 T2，P2，plan_seq=4）
设计文档: docs/superpowers/specs/2026-07-09-protocol-hygiene-pack-design.md
实施计划: docs/superpowers/plans/2026-07-09-protocol-hygiene-pack.md
Decision: 4ea9dcc5（设计拍板，含 fail-open）

## 背景

Brain 三个协议卫生缺口：
1. 重试策略散在 5 层无 SSOT，timeout / 5xx 无独立 backoff（都混在 network 里）。
2. 告警缺通用「连续 N 次才响 + 冷却期」封装，去抖机制分散 4 处。
3. 三类副作用入口（建任务/spawn/发通知）去重全是进程内内存 Map，蓝绿部署重启即清零。

## 方案（三件套）

1. `src/lib/retry-policy.js`：四类失败各自 backoff 数组的查表 SSOT + `isTransientClass()` 集中瞬态判定；quarantine.js 拆出 TIMEOUT/SERVER_ERROR 类别，getRetryStrategy 查表化（签名返回结构不变）；4 处下游枚举同步防韧性回归。
2. `src/lib/alert-debounce.js`：连续 N 次才放行 + 冷却期（opt-in）；raise() 第 4 可选参数，25 处存量调用零变更；P0 禁套；account-usage token_expiring_soon 示范接入。
3. migration 326 `side_effect_dedupe` 表 + `src/lib/dedupe.js`（ON CONFLICT 过期重占原子 claim，fail-open + P2 降级告警）；三入口接线：createTask 可选 dedupe_key / executor 派发层 spawn claim（TTL 120s，资源检查之后 claim 防泄漏）/ notifier 可选 dedupeKey（异常全吞照发）。

## 成功标准

- 5xx/ETIMEDOUT 失败按各自 backoff 数组重试且不被误计失败/误隔离（isTransientClass 全链一致）
- 抖动型告警可 opt-in 去抖，且三层限流串联不吞第一次真告警
- 同 dedupe_key 的副作用跨 Brain 重启只发生一次；dedupe 表故障时 fail-open 放行不停摆
- spawn 去重命中不计入 cecelia-run 熔断
