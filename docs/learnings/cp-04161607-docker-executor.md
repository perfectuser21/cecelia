# Learning: Docker 化 cecelia 执行器（替换 cecelia-run.sh + worktree spawn）

## 背景
过去 4 天 17+ PR 全部在修 cecelia-bridge / cecelia-run.sh / worktree spawn 链条上的脆弱性：
bridge timeout、async exec 错误、PID 丢失、credentials 注入、僵尸 worktree、Stop Hook 误判会话、
.dev-lock 残留、worktree 同名分支冲突等。每修一个，下游冒出新一个。

### 根本原因
执行器层架构有问题，不是代码 bug。
- bridge 是 HTTP 单点（端口 3457）+ exec 子进程，缺乏隔离
- worktree 用宿主文件系统，进程残留 → 僵尸 worktree → Stop Hook 误判
- 资源没有 cgroup 限制，单 task OOM 拖垮整机（hk-cecelia 8 runner 历史教训）
- 没有显式生命周期：spawn 后失联、kill 后残留 .dev-lock、状态机重建复杂

继续在旧链路上加补丁是沉没成本。LangChain Open SWE 早就证明：每 task 一个 Docker container 就解决全部问题。

### 解决方案
本 PR 第一步搭骨架（向后兼容）：
1. `docker/cecelia-runner/Dockerfile` — node:20-slim + Claude Code CLI，ENTRYPOINT 为 claude headless
2. `docker/build.sh` — 本地 build 镜像 `cecelia/runner:latest`
3. `packages/brain/src/docker-executor.js` — 提供 `executeInDocker`：`docker run --rm --memory=Xm --cpus=Y --name=cecelia-task-{shortId} -v $WORKTREE:/workspace ...`，超时强制 `docker kill`
4. `executor.js` 加 `HARNESS_DOCKER_ENABLED=true` 开关，true 时走 docker，false 时走老 bridge（向后兼容）
5. `task_type → 资源档位` 映射：light(512M/1c) / normal(1G/1c) / heavy(1.5G/2c)

容器 `--rm` + 超时 kill 解决了进程残留；`-v worktree:/workspace` 解决了路径隔离；
cgroup 解决了资源公平；`callback_queue` 写入与 bridge 路径完全一致 → 下游 callback-worker 不用改。

### 下次预防
- [ ] 搭好 LangGraph plan layer 后（另一个 agent 做），灰度切 `HARNESS_DOCKER_ENABLED=true` 跑 1-3 天
- [ ] 验证 callback_queue 端到端无 regression（success/failed/timeout 三种状态都过 callback-processor）
- [ ] 监控 cecelia/runner image 镜像层 build 时间（claude.ai/install.sh 网络 + npm fallback 双保险）
- [ ] 部署节点（HK VPS / Mac mini）首次需跑 `docker/build.sh` 构建本地 image，文档化
- [ ] 当 docker 路径稳定 1 周，删除 cecelia-bridge HTTP 路径（彻底移除 sunk cost）

## 验证
- 单元测试 17/17 通过：`npx vitest run src/__tests__/docker-executor.test.js`
- sanity check 跑通：`HARNESS_DOCKER_ENABLED=true node packages/brain/scripts/test-docker.js`
  - docker 未装本机走 SKIP 分支，CI 兼容
- 未设置 `HARNESS_DOCKER_ENABLED` 时 `executor.js` 行为完全不变（向后兼容）
