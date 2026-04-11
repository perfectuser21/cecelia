# Learning: Brain Quota 感知调度

## 根本原因
API Quota 耗尽时 Brain 仍在派发任务，凭据告警任务（task_type: research）本身也因 quota 耗尽而死亡，
堆积在 quarantined 状态，形成正反馈循环：quota 低 → 任务失败 → 更多告警任务 → quota 更低。

## 修复方案
1. 新增 `quota-guard.js`：基于最优账号 five_hour_pct 动态限制调度范围
   - > 90% 已用 → 仅派 P0/P1
   - > 98% 已用 → 暂停全部调度
2. `tick.js` `dispatchNextTask()` 新增 0b 步骤（billing pause 后）调用 quota guard
3. `credential-expiry-checker.js` 改用 `raise()`（Feishu 推送）代替创建 research 任务
4. `cancelCredentialAlertTasks()` 批量清理历史 quarantined 凭据告警任务

## 下次预防
- [ ] 凭据告警、系统健康告警等"纯通知"功能不应创建需要 Claude API 的任务
- [ ] quota guard 阈值（90%/98%）可通过 env var 调整（未实现，后续可扩展）
- [ ] `selectNextDispatchableTask` 已支持 `options.priorityFilter`，其他调用方可复用
