# PRD: 修复 Staging 部署管道阻断问题

## 背景
最近 4 次 deploy run 全部 failed，根本原因是 `scripts/staging-deploy.sh` 在环境未配置时直接 `exit 1`，阻断了整个 Safe Lane 流程，导致所有核心文件变更的 PR 无法部署到 production。

## 问题根因
1. `docker` 命令在此机器（美国 Mac mini）不在 PATH
2. `.env.staging` 文件不存在
3. `staging-deploy.sh` 在上述两种情况均直接 `exit 1`，`ops.js` 捕获后将 `stagingDeployState.status = 'failed'`，阻断后续 production 部署

## 修复目标
- staging 是"加分项"验证，不应无限期阻断 production 发布
- 环境未配置（no docker / no env）→ 优雅跳过，exit 0
- 真实运行错误 → 仍然 exit 1，明确阻断
- ops.js 能区分"跳过"和"失败"两种状态

## 成功标准

- [x] `bash scripts/staging-deploy.sh` 在无 docker 环境下返回 exit 0（而非 exit 1）
- [x] 脚本输出包含 `STAGING_SKIP_REASON=no_docker` 可供 ops.js 解析
- [x] `stagingDeployState.status` 在跳过时为 `skipped_no_docker` 或 `skipped_no_env`（而非 `failed`）
- [x] `scripts/setup-staging-env.sh` 文件存在，支持从 1Password/本地.env 派生 .env.staging
- [x] `ops.js` 的 `stagingDeployState` 新增 `skip_reason` 字段
