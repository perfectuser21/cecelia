# Learning: fix(ci) CI 绿灯率修复

## 根本原因

### Bug 1: Staging Smoke Test 无条件执行
`.github/workflows/deploy.yml` 的 `staging_deploy` job 包含三个步骤：
1. 触发 Staging 部署（调用 webhook）
2. 等待 Staging 部署完成（轮询状态）
3. Staging Smoke Test（curl 检查端口 5222）

当 `staging-deploy.sh` 因无 Docker 或无 `.env.staging` 而跳过时，步骤 2 正确退出 0，
但步骤 3 **无条件执行**，仍尝试连接端口 5222，返回 HTTP 000，阻止 production deploy。

### Bug 2: PR Auto Review 429 限流
OpenRouter DeepSeek API 在高负载时返回 429 rate limit，三次重试后全部失败，
workflow 执行 `exit 1` 将 429 外部 API 限速与真实代码问题同等对待，不合理地阻止 PR 合并。

## 修复方案

### Fix 1: 步骤 id + 输出变量 + 条件门禁
- 给"等待 Staging 部署完成"步骤添加 `id: wait_staging`
- 在 success/skipped/failed/timeout 各路径写 `staging_ran=true/false` 到 `$GITHUB_OUTPUT`
- 给"Staging Smoke Test"步骤添加 `if: steps.wait_staging.outputs.staging_ran == 'true'`

### Fix 2: 429 与其他错误区分处理
- 检测响应的 `.error.code == 429`
- 429 → 跳过审查（exit 0），不阻止 PR 合并
- 其他错误 → 保持 fail-closed（exit 1）

## 下次预防

- [ ] CI workflow 中任何"条件性"流程（staging/可选步骤）都必须用步骤 `id` + output 变量控制后续步骤
- [ ] 外部 API 调用失败时，必须区分"外部限速/不可用"和"真实错误"
- [ ] 新增 CI 步骤时检查：是否存在前置步骤被跳过但当前步骤仍运行的情况
