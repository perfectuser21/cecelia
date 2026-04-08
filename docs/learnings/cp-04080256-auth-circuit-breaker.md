# Learning: Auth 失败账号熔断机制

## 任务
fix(brain): auth失败账号自动剔除 — 防止级联quarantine

## 根因分析

### 背景
PRD 要求分析"24h任务成功率39%根因"并修复至少1个单点。

### 根因库（完整分析）

通过 DB 分析最近 24h 失败任务：

| 失败类型 | 数量 | 占比 | 来源 |
|---------|------|------|------|
| auth 失败 (quarantined) | 186 | 60% | account3 API key 2026-04-06~07 失效 |
| no_error_message (canceled) | 120 | 39% | content_publish批量取消、task-cleanup等路径不写error_message |
| task_error (代码执行失败) | 3 | <1% | 正常业务失败 |

**关键发现**：
1. **auth 失败是主因**：`payload.failure_class = 'auth'` 的任务占 quarantined 总量的 100%，全部是 account3 在特定时段（约17h）内 API key 失效导致
2. **无防御机制**：`selectBestAccount` 只考虑额度用量和 spending_cap，当某账号 auth 失败时，新任务仍会继续派到该账号，形成级联失败
3. **SelfDrive 已有缓解**：auth 失败已从成功率计算中排除（避免恐慌死循环），但没有从源头阻断

### 根本原因
`account-usage.js` 的 `selectBestAccount` 缺少 auth 失败熔断逻辑。对比：`billing_cap` 有 `markSpendingCap`/`isSpendingCapped` 机制，auth 失败缺同等保护。

### 修复方案
参照 spending cap 模式，添加：
- `_authFailureMap` 内存 Map
- `markAuthFailure(accountId, resetTime=2h)`
- `isAuthFailed(accountId)` + 自动过期
- `loadAuthFailuresFromDB()` 重启恢复
- `execution.js` auth 路径触发 `markAuthFailure`
- `isAccountEligibleForTier` 检查 `authFailed`

## 下次预防

- [ ] 新增账号级别的系统性失败类型时（auth/billing/resource），必须同时在 `selectBestAccount` 中添加对应的剔除机制
- [ ] auth 失败不应无声地 quarantine，应触发账号熔断 + 日志 `[auth-circuit-breaker]`
- [ ] DB migration 命名格式：`NNN_描述.sql`，EXPECTED_SCHEMA_VERSION 同步更新
