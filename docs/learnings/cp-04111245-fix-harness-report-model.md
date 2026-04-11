# Learning: harness_report 模型配置 bug（Haiku 产出 0 字节）

### 根本原因

`packages/brain/src/model-profile.js` FALLBACK_PROFILE 第 77 行，`harness_report` 的 `anthropic` 字段硬编码为 `claude-haiku-4-5-20251001`。
代码注释（第 71 行）写着"Generator/Report 用 Sonnet"，但实际代码是 Haiku。
Haiku 在 `harness-report` skill 场景下产出 0 字节，导致 cecelia-run 发 `result=null` 回调，触发无限重试（直到 retry_count >= 3 终止）。

DB active profile 虽然被手动 SQL 更新为 Sonnet，但由于 Brain 重启顺序问题或内存缓存未刷新，仍沿用 FALLBACK。

### 下次预防

- [ ] 新增 harness task type 时，FALLBACK_PROFILE 和注释必须一致 — 注释说 Sonnet 代码就必须是 Sonnet
- [ ] harness_report 历次 result=null 应优先检查 model 配置，而不是 retry 逻辑
- [ ] worktree-manage.sh 使用 10 位时间戳（`%m%d%H%M%S`），与 branch-protect.sh 要求的 8 位（`[0-9]{8}`）不匹配，需修复 worktree-manage.sh 改为 `%m%d%H%M`
