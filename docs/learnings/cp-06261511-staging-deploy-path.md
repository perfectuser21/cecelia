# staging-e2e-runner 用相对路径调 staging-deploy.sh，容器内找不到脚本

2026-06-26。手动触发真 staging E2E 时 verdict=FAIL reason=deploy_failed，deploy_output="bash: scripts/staging-deploy.sh: No such file or directory"。

### 根本原因
- `staging-e2e-runner.js` `DEFAULT_DEPLOY_SCRIPT = 'scripts/staging-deploy.sh'`（相对路径）。staging-e2e-runner 跑在生产 brain 容器 cecelia-node-brain（WORKDIR=/app），相对路径解析到 /app/scripts/（镜像没 COPY repo 根 scripts/），脚本实际在 bind-mount 的 /Users/administrator/perfect21/cecelia/scripts/。
- **之前一直被掩盖**：staging E2E 要么 SKIP（no_contract，contract 缺 e2e_acceptance）要么 mock，从没真跑到 staging-deploy 这一步，路径 bug 藏了很久。补了 contract 走真路径才炸出来。
- **getRepoRoot() 不可用**：它用 `import.meta.url` 算路径，容器内代码在镜像层 /app/src → `path.resolve('/app/src','../../..')` = `/`（实测 `getRepoRoot()=/`）。
- **正确源**：brain 容器 env `REPO_ROOT=/Users/administrator/perfect21/cecelia`（= bind-mount repo 根）。

### 下次预防
- [ ] brain 容器内调 repo 根脚本/文件，必须用 `process.env.REPO_ROOT`（bind-mount repo 根），不能用相对路径，也不能用 `import.meta.url` 推算（镜像层 /app ≠ bind-mount repo 根）
- [ ] staging / 部署类代码必须用真路径真跑验证——SKIP / mock / smoke 会掩盖路径 bug（这次就是真跑才暴露）
- [ ] team agent 诊断必须审核再用：本次 Agent 的 "docker socket blocker" 是误判（生产 brain 容器有 socket+repo mount，实测 docker ps 能连）、"用 getRepoRoot" 容器内返回 /，都靠实测推翻
- [ ] 同期审核掉一个伪 bug：harness 死线程告警仅 1 次=fresh-start 误报、walking_skeleton 无持久冗余、PR 真 merged 秒回是 langgraph 正确行为 → 非真 bug，未盲改 graph 核心

### 关联
- 设计：docs/superpowers/specs/2026-06-26-staging-deploy-path-fix-design.md
- 容器自刷顶坏 token（独立 issue 9d17392c）；429 误判 fix（PR #3431）
