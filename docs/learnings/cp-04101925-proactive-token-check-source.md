# Learning: proactiveTokenCheck 不区分 auth_failed 来源导致 API 401 账号被误解除熔断

## 任务
fix(brain): proactiveTokenCheck 不清除 API 401 设置的 auth_failed

## 根本原因

`proactiveTokenCheck` 在检测到 token 文件有效时，无条件清除该账号的 `auth_failed` 熔断。但 `auth_failed` 可能有两种来源：
1. **token_expired**：token 文件 `expiresAt` 过期 → proactiveTokenCheck 自己设置的，token 刷新后确实应该清除
2. **api_error**：Anthropic API 返回 401 → execution callback 设置的，代表凭据本身失效（非过期），不应被 token 文件检查清除

原代码没有区分来源，导致 API 401 设置的熔断被 token 文件有效检测误清除，同一账号持续被派发、持续 401。

## 修复

在 `_authFailureMap` entry 中增加 `source` 字段：
- `markAuthFailure(accountId, resetTime, source='api_error')` 新增第三个参数
- `proactiveTokenCheck` token 过期时传入 `'token_expired'`
- `proactiveTokenCheck` 清除逻辑改为：只清除 `entry.source === 'token_expired'` 的熔断

## 下次预防

- [ ] 当同一个熔断 Map 可能由多个不同路径写入时，必须记录 source 字段，防止其他路径的清除逻辑误操作
- [ ] proactiveTokenCheck 类似的"自动恢复"逻辑，只应清除"自己设置"的状态，不能清除其他系统设置的状态
