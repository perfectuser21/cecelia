# Learning: proactiveTokenCheck 不应清除 API 401 设置的 auth_failed

**分支**: cp-04110954-fix-account-usage-auth-source  
**日期**: 2026-04-11

## 问题描述

`proactiveTokenCheck` 发现 token 文件 expiresAt 未到期时，会无条件清除该账号的 `auth_failed` 熔断。但 `auth_failed` 可能有两种来源：

1. **`token_expired`**：`proactiveTokenCheck` 自身检测 token 文件过期后设置的
2. **`api_error`**：executor 运行时 Anthropic API 返回 401，由 `execution-callback` 通过 `markAuthFailure` 设置

旧逻辑不区分来源，导致 API 401 设置的熔断被 token 有效的检测误清除，同一账号反复被派发、反复 401。

### 根本原因

`_authFailureMap` 中存储的 entry 没有记录熔断来源，`proactiveTokenCheck` 在执行"token 有效 → 清除熔断"时无法区分这两种情况。

## 修复方案

在 `_authFailureMap` entry 中增加 `source` 字段：

- `markAuthFailure(accountId, resetTime, source='api_error')` — 新增第三参数，默认 `'api_error'`
- `proactiveTokenCheck` 标记 token 过期时传 `source='token_expired'`
- `proactiveTokenCheck` 清除逻辑：只清除 `entry.source === 'token_expired'` 的熔断；`api_error` 的熔断等 `resetTime` 自然过期

## 下次预防

- [ ] 凡是带"状态标记"的内存 Map，entry 必须记录 `source`/`reason` 字段，防止不同触发路径互相干扰
- [ ] `proactiveTokenCheck` 只负责 token 文件层面的状态，不应负责清除其他来源的熔断
- [ ] 新增 `source` 参数时保持向后兼容（默认值），已有调用不需要修改
