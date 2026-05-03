### 根本原因

`_authFailureCountMap` 仅存在于内存中，Brain 每次重启后清空。account3 等失效账号每次重启后退避计数从 1 重新计算，每次只被封 2h（`2^1`），而非根据历史失败次数累积到 24h（max），导致 Brain 在连续重启场景下不断对失效账号发出请求，4h 内积累 285 次 auth 失败。

修复：在 `account_usage_cache` 表新增 `auth_fail_count` 列，`markAuthFailure` 写入计数，`loadAuthFailuresFromDB` 在启动时从 DB 恢复到内存，`resetAuthFailureCount` 恢复凭据时同步将 DB 值清零。

### 下次预防

- [ ] Brain 内存状态（Map/Set/计数器）新增时，评估是否需要持久化到 DB
- [ ] 熔断相关状态（失败计数、封禁截止时间）一律持久化，不依赖纯内存
- [ ] 新增 account_usage_cache 列时，同步更新 `loadAuthFailuresFromDB` 的 SELECT 字段列表
