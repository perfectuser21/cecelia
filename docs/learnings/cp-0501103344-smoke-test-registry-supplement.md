## Cecelia smoke_cmd 质量补强（2026-05-01）

### 根本原因

Brain features 表的 `smoke_cmd` 在 migration 249 写入时以"能过 all-features-smoke.sh"为目标，而非"真验证该功能"。导致：
1. **端点完全错误**：9 个 feature 的 smoke_cmd 指向 `/health` 或 `/status`，与被测功能无关（如 `session-kill` 测的是 GET scan-sessions 而非 POST kill-session）
2. **多 feature 共用同一条命令**：alertness-evaluate/history/override 三个 feature 指向完全相同的 curl，失去区分意义
3. **CI 冷启动与热 Brain 的字段差异未考虑**：`pack_version`、`decision_mode`、`policy_rules` 在冷启动 Brain 中为 null（依赖 working_memory 生成），`last_sweep.started_at` 未跑过为空——本地测试通过但 CI 失败

额外发现：
- `/api/brain/status` 在 CI 因 `tick_history`/`retry_count` schema 漂移返回 5xx，`curl -sf` 遇 4xx/5xx 退出，导致断言根本没执行
- `intent-match.js` 路由文件存在但未挂载到 server.js（P1 bug，已在 smoke 中标注 ⚠️）

### 下次预防

- [ ] 写 smoke_cmd 时必须先用 `curl -s -w "%{http_code}"` 验证端点在 **CI 冷启动 Brain** 下的实际 HTTP 状态码，不能只在热 Brain 本地验证
- [ ] 凡用 `curl -sf` 的 smoke_cmd，确认端点不会因 schema 漂移返回 5xx——若不确定，改用 `curl -s` + `jq -e` 组合
- [ ] 字段断言（`.field != null`）只适用于该字段在所有 Brain 启动状态下都存在的情况；冷启动依赖 working_memory 的字段应改为端点可达性断言
- [ ] 新 feature 写 smoke_cmd 时验收标准：**同一 feature ID 不能与其他 feature 使用完全相同的 smoke_cmd**（可加 CI lint 检测）
- [ ] schema 漂移（缺失的列/表）应在 CI 失败时单独报告，而非让 Brain 启动后悄悄把所有依赖这些表的 smoke 全部失败
