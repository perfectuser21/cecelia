# Learning: auth_fail_count_24h 被 pipeline_rescue 任务污染

**Branch**: cp-04080846-7fdf70bf-597c-40df-acfd-38d335  
**Date**: 2026-04-08  
**Task**: [SelfDrive] [紧急-P1] 基础设施认证层故障深度排查与恢复

---

### 根本原因

当某个账号（如 account3）发生 auth 故障时，Brain 会将大量 pipeline_rescue 任务派发给该账号。这些 rescue 任务也因 auth 失败而被 quarantined，标记 `failure_class: auth`。

结果：`/credentials/health` 和 `scanAuthLayerHealth` 在统计 `auth_fail_count_24h` 时，把这些 pipeline_rescue 失败计入了真实 auth 失败次数，导致：
- account3 显示 130 次"auth 失败"（实际只是 pipeline_rescue 失败的连锁反应）
- 指标被污染，无法区分"真实凭据失效"与"rescue storm 扩散"
- 告警阈值（3次/4h）被大量历史 rescue 失败触发风险增加

### 修复

在两处 SQL 查询加 `AND task_type != 'pipeline_rescue'`：
1. `infra-status.js` — GET `/credentials/health` 的 `auth_fail_count` 子查询
2. `credential-expiry-checker.js` — `scanAuthLayerHealth` 的速率统计查询

### 下次预防

- [ ] auth 失败统计指标必须始终排除 `pipeline_rescue`：这类任务是"救援工具"，其失败是派发账号 auth 问题的间接结果，不是独立的凭据失效信号
- [ ] 新增涉及 `failure_class` 统计的查询时，先确认是否需要排除 infrastructure-only task_type（`pipeline_rescue`、`dept_heartbeat` 等）
- [ ] Brain 代码部署后需要重启进程才能加载新功能（Node.js 不热更新）；PR 合并后若 Brain 未重启，新功能不生效
