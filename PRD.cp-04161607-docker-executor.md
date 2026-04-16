# PRD: Docker 化 cecelia 执行器（替换 cecelia-run.sh + worktree spawn）

## 战略背景

过去 4 天 17+ PR 都在修 bridge/worktree 的脆弱性（bridge timeout、async exec、PID 丢失、credentials 注入、僵尸 worktree、Stop Hook 误判等）。诊断结论：**架构错了，继续修是沉没成本**。

向 LangChain Open SWE 模式靠拢：每个 task 一个隔离 Docker container，进程/资源/工作目录完全隔离，--rm 自动销毁。

## 范围（本 PR）

执行器架构重构第一步：

1. **新增** `docker/cecelia-runner/Dockerfile`：基于 node:20-slim + Claude Code CLI，ENTRYPOINT 为 `claude -p --dangerously-skip-permissions --output-format json`
2. **新增** `docker/build.sh`：本地构建脚本，输出 `cecelia/runner:latest`
3. **新增** `packages/brain/src/docker-executor.js`：提供 `executeInDocker({task, prompt, env, memoryMB, cpuCores, timeout})`，超时强制 `docker kill`，写 callback_queue 与 bridge 路径兼容
4. **改动** `packages/brain/src/executor.js`：在 `triggerCeceliaRun` 中加入 `HARNESS_DOCKER_ENABLED=true` 分支；启用时不走 cecelia-bridge HTTP，直接调 `executeInDocker`，写 callback_queue
5. **新增** `packages/brain/scripts/test-docker.js`：sanity check 脚本（docker 不可用时 SKIP，CI 兼容）
6. **新增** `packages/brain/src/__tests__/docker-executor.test.js`：单元测试（17 用例覆盖资源映射、container 命名、env 转参、写 callback_queue 字段）

## 不在本 PR 范围

- **不**改 LangGraph（另一个 agent 做）
- **不**改 callback-processor（已经在另一个 PR）
- **不**强制启用 Docker：默认走 bridge，环境变量 `HARNESS_DOCKER_ENABLED=true` 才切到 Docker 路径（向后兼容）
- **不**构建并推 image 到 registry：本 PR 提供 build.sh，但 image 由本机/部署节点本地构建

## task_type → 资源档位映射

| 档位 | 内存 | CPU | 适用 task_type |
|------|------|-----|----------------|
| light | 512 MB | 1 core | planner / report / briefing / daily_report |
| normal | 1 GB | 1 core | propose / review / eval / fix（默认） |
| heavy | 1.5 GB | 2 cores | dev / codex_dev / generate / initiative_plan |

## 成功标准

- 单元测试 17/17 通过：`npx vitest run src/__tests__/docker-executor.test.js`
- sanity check 脚本正常退出：`HARNESS_DOCKER_ENABLED=true node packages/brain/scripts/test-docker.js`（docker 不可用时 SKIP，可用时跑通 spawn 链路）
- `executor.js` 在未设置 `HARNESS_DOCKER_ENABLED` 时行为完全不变（向后兼容）
- container 必须 `--rm` 自动销毁，超时强制 `docker kill`

## 完成标志

PR 创建 + auto-merge + 本地 sanity check 跑通（docker 未装时打印 SKIP）。
