# Learning: account_usage_cache 新增 seven_day_sonnet_resets_at

## 变更概述
Brain 的 `account_usage_cache` 表新增 `seven_day_sonnet_resets_at` 列，存储 Anthropic API 返回的 Sonnet 专属 7d 窗口独立重置时间。

### 根本原因
1. Anthropic API 对 five_hour、seven_day、seven_day_sonnet 三个 scope 各自返回独立的 `resets_at`
2. `upsertCache()` 只读取了 `data.five_hour.resets_at` 和 `data.seven_day.resets_at`，丢弃了 `data.seven_day_sonnet.resets_at`
3. DB 表 `account_usage_cache` 缺少 `seven_day_sonnet_resets_at` 列
4. 导致 `/llm-quota` skill 无法显示 Sonnet 独立的重置时间，只能拿 7d all 的凑数

### 下次预防
- [ ] 新增 API scope 时，逐一检查 response 结构的所有字段是否都被存储
- [ ] DB migration + code + test + selfcheck version + DEFINITION.md 五件套必须一起改

## 改动清单
1. `packages/brain/migrations/199_account_usage_sonnet_resets.sql` — 新增列
2. `packages/brain/src/account-usage.js` — upsertCache 读取并写入新字段 + fallback 默认值
3. `packages/brain/src/__tests__/account-usage.test.js` — 更新 fallback 测试期望值
4. `packages/brain/src/selfcheck.js` — EXPECTED_SCHEMA_VERSION 198→199
5. `DEFINITION.md` — schema_version 198→199

