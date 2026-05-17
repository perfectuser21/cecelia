# Learning - Layer 2 蒸馏文档刷新频率调整

**Branch**: cp-03231029-distilled-docs-refresh-interval
**PR**: #1411

### 根本原因

Layer 2 蒸馏文档层（PR #1407）上线后，server.js 只为 WORLD_STATE 添加了定时刷新（24h），
SELF_MODEL 和 USER_PROFILE 完全没有排程，导致两者只在首次 seedSoul() 写入后再无更新。
用户画像和自我认知文档会随对话快速演化，但 Brain 重启才能触发更新，实际等同于"永不更新"。

### 下次预防

- [ ] 新增蒸馏文档类型时，必须在同一 PR 中同时添加定时刷新 setInterval（不可留空）
- [ ] setInterval 需配合 setTimeout 做延迟首次执行，避免影响 Brain 启动速度
- [ ] 不同文档类型刷新频率应与其演化速度匹配：WORLD_STATE 24h / SELF_MODEL 24h / USER_PROFILE 6h
