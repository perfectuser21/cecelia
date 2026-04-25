# PRD: Docker Executor Timeout 默认 90min + per-tier

**日期**：2026-04-25
**分支**：cp-0425185125-docker-timeout-tier-aware
**Brain 任务**：3f32212a-adc2-436b-b828-51820a2379e6

## 背景

`packages/brain/src/docker-executor.js:36` `DEFAULT_TIMEOUT_MS = 900000`（15min）。
Generator 容器跑大改动正常需要 1-2 小时（多文件 + GAN 多轮 + CI 等待），第一次 Gen2 就被 SIGKILL。
临时改 `.env.docker` 不持久；且不分 tier，light 任务也等 90min 浪费资源、heavy 任务还是被秒杀。

## 方案

- 改 `packages/brain/src/docker-executor.js` `DEFAULT_TIMEOUT_MS = 5400000`（90min），env override 仍生效
- `packages/brain/src/spawn/middleware/resource-tier.js` `RESOURCE_TIERS` 每个 tier 加 `timeoutMs`：
  - light: 30 min
  - normal: 90 min
  - heavy: 120 min
  - pipeline-heavy: 180 min
- `executeInDocker` 优先级：`opts.timeoutMs > tier.timeoutMs > DEFAULT_TIMEOUT_MS`
- 新增 `packages/brain/src/__tests__/docker-executor-timeout.test.js`（mock runDocker 验证优先级）
- 既有 `resource-tier.test.js` 同步加 `timeoutMs` 字段断言

## 不做

- 不改 docker-run.js（仍从 opts.timeoutMs 取值，保持向后兼容）
- 不动 buildDockerArgs（memory/cpu 字段保持不变）

## 成功标准

- [ARTIFACT] DEFAULT_TIMEOUT_MS 默认值 5400000
- [ARTIFACT] RESOURCE_TIERS 4 个 tier 都含 timeoutMs 字段
- [BEHAVIOR] tier=normal 任务用 90min timeout（mock test 验证）
- [BEHAVIOR] tier=pipeline-heavy 任务用 180min timeout（mock test 验证）
