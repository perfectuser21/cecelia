# staging 验证链统一用 host.docker.internal 访问 staging（修容器内 localhost 不通）

## Bug
staging E2E：docker health 健康检查过后，staging-verify.sh 4 项 HTTP 000000 → STAGING_FAIL → 阻断 promote。修了 staging-verify 后，e2e scenario 重写（→localhost:5222）也会同样不通。

## 根因（实测 + grep 全范围确认）
staging 验证链在**生产 brain 容器 cecelia-node-brain 内**跑，用 `localhost:5222` 访问 staging 容器 → 容器内 localhost ≠ staging 容器 → 不通。两处：
1. `scripts/staging-verify.sh:14` `STAGING_URL="http://localhost:${STAGING_PORT}"`
2. `packages/brain/src/staging-e2e-runner.js:86-87` runStagingCommand 把合同命令 `:5221` 重写成 `localhost:${port}`（localhost:5222）

实测：生产 brain 容器内 `curl host.docker.internal:5222` /health + /tick/status 都通。`scripts/auto-staging-smoke.sh:20` 已用 `STAGING_HOST` 变量（working example）。

这是架构性根因（脚本假设 host 跑 localhost，实际容器内跑），不是单点 bug——grep 确认全范围 2 处，一次根治。

## 方案（统一 STAGING_HOST，默认 host.docker.internal，env 可覆盖）
1. `staging-verify.sh:14`：`STAGING_URL="http://${STAGING_HOST:-host.docker.internal}:${STAGING_PORT}"`
2. `staging-e2e-runner.js:86-87`：重写目标 host 用 `process.env.STAGING_HOST || 'host.docker.internal'`，把 `:5221` 重写成 `<host>:<port>`（而非 localhost:port）

兼容：env `STAGING_HOST` 可覆盖（host 直跑传 localhost）；默认 host.docker.internal 匹配实际容器内调用路径。

## 方案对比
- A（选）统一 STAGING_HOST=host.docker.internal：跟随 auto-staging-smoke pattern，最小改动根治 2 处
- B docker network + 容器名访问（cecelia-node-brain-staging:5221）：要改 compose network，重构大
- C 逐处零散修：打地鼠，已证明会一层层露

## 测试策略：unit
- `staging-verify.sh`：vitest 解析断言 STAGING_URL 用 host.docker.internal（或 STAGING_HOST，非纯 localhost）
- `staging-e2e-runner.js`：vitest 测 runStagingCommand 把 `curl localhost:5221/...` 重写成 `host.docker.internal:5222/...`（不是 localhost:5222）

## 不包含
- docker network 容器名方案（host.docker.internal 已够）
- staging brain 凭据挂载（另一层，不阻塞验证）
