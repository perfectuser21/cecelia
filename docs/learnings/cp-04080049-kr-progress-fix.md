# Learning: KR 进度 0% 采集链路断链修复

**分支**: cp-04080049-15ded60e-4704-4ec8-b8c4-a32ed0  
**日期**: 2026-04-08

### 根本原因

migration 223 在创建 kr_verifiers 记录时，为"里程碑类型"的 KR（微信小程序上线、geo SEO网站上线）设置了硬编码占位符 SQL：`SELECT 0::numeric as count`。

这导致：
1. kr-verifier.js 每次执行都返回 0，`key_results.progress` 永远是 0%
2. 即使对应功能建成后，进度也不会自动更新
3. 0% 的数据看起来是"采集失败"，实际上是"机制断链"

### 下次预防

- [ ] 设置 kr_verifier 时，**禁止使用纯常量 SQL**（`SELECT 0::numeric`、`SELECT N::numeric`）
- [ ] 里程碑类 KR 应使用 `okr_projects` 完成率作为 proxy，而非手动填占位符
- [ ] kr-verifier.js 已添加常量 SQL 检测警告，下次会在 Brain 日志中 WARN
- [ ] 如果某个 KR 真的没有可采集的数据，应标注为 `enabled = false` 并说明原因，而不是写假 SQL

### 修复摘要

1. **migration 224**: 将 KR3/KR4 的 verifier SQL 替换为基于 `okr_projects` 完成率的 proxy 查询
   - threshold 从 1 → 100（与查询返回 0-100 范围对齐）
   - check_interval_minutes 从 1440（24h）→ 60（1h）
2. **kr-verifier.js**: 添加 regex 检测，对常量 SQL 输出 WARN 日志
