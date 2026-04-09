# Learning: CI 绿灯率修复 — lsof PATH + Staging Smoke Test + PR Review 429

## 根本原因

### 1. brain-deploy.sh code=127 (Fast Lane Deploy 失败)
- `lsof` 位于 `/usr/sbin/lsof`，但 launchd 的 PATH 不含 `/usr/sbin`
- `set -euo pipefail` 使 `$(lsof -ti:5221 ...)` 失败直接退出整个脚本
- Brain 记录 `deploy-local.sh exited code=127`

### 2. Staging Smoke Test 失败 (Safe Lane Deploy 失败)
- Docker 未安装 → `staging-deploy.sh` 输出 `STAGING_SKIP_REASON=no_docker` → staging 状态=`skipped_no_docker`
- CI 等待步骤检测到 `skipped_*` → exit 0（正确）
- **但 Staging Smoke Test 步骤无判断，直接访问 5222 → HTTP 000 → 失败**

### 3. PR Auto Review 失败 (DeepSeek rate limit)
- OpenRouter DeepSeek 429 rate limit 触发后，3次重试全失败
- fail-closed 策略导致 PR 合并被阻止（而非只是跳过审查）

## 下次预防

- [ ] `set -euo pipefail` 脚本中，凡用到 `/usr/sbin/` 路径的命令，统一加全路径或 `|| echo ""`
- [ ] CI workflow 中，若存在"跳过"分支，后续依赖步骤必须同样能跳过
- [ ] 外部 AI API 调用：rate limit (429) 应为 warning，不应 fail-closed
