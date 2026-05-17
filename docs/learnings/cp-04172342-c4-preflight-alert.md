# Learning: C4 Pre-flight Cancel Alerting

Task: `61fd2d0d-7b4d-4c21-92b9-344b62dede74`
Branch: `cp-04172342-c4-preflight-alert`
PR: _TBD（push 后填入）_

## 发生的问题

今天发现 27 个 autonomous dev 任务被 pre-flight 静默 cancel，累计一周没人看见。
`packages/brain/src/tick.js` 在 pre-flight fail 分支只写了 `metadata.pre_flight_failed = true`，
没有任何告警通道，结果这些 cancel 全部进了"黑洞"。

### 根本原因

1. **只做观测不做告警**：pre-flight 设计时把 fail 视为"正常跳过"（继续看下一个 candidate），但
   从系统健康角度看，连续 cancel 意味着有上游 creator 在持续塞质量差的任务 —— 这属于
   "慢性毒药"，需要立即上浮。
2. **metadata 字段没有人定期扫**：`getPreFlightStats` 接口存在，但没有 tick 周期调用它的
   聚合，也没有任何 Dashboard 在看 failed_count，等于"埋了个只写日志的字段"。
3. **缺乏分层告警策略**：单次 cancel 只值 P2（每日汇总），但 24h 内连续 cancel 是
   结构性问题，必须升级 P0 立即推送。

## 修复方案

在 `pre-flight-check.js` 末尾新增 `alertOnPreFlightFail(pool, task, checkResult)`：
- 单次 fail → `raise('P2', 'pre_flight_cancel', msg)`（进 24h 汇总）
- 24h 累计 >= 3 → `raise('P0', 'pre_flight_burst', msg)`（飞书立即推送）

`tick.js` 改动极小（1 行），在已有的 UPDATE + recordDispatchResult 之间调用新函数。
函数内吞异常，告警失败不反向影响 dispatch 主流程。

## 下次预防

- [x] 单元测试覆盖：单次 fail / 阈值触发 / 空 issues / DB 失败吞异常 / SQL 条件正确
- [ ] 后续：给 Dashboard 加 pre_flight_stats 面板（另开任务）
- [ ] 后续：把这个"metadata 字段只写不读就等于埋雷"的模式加入 arch-review 巡检清单
- [ ] 下次设计任何 "metadata flag 记录失败但不影响主流程" 的逻辑时，必须同时交付
      告警通道 + 聚合阈值，否则默认 reject PRD
