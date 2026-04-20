# Harness v2 Docker Mount + GITHUB_TOKEN 注入

### 根本原因

Harness v2 pipeline E2E 失败：容器内 agent 报错 `/workspace is not a git repo in this sandbox, so the worktree→PR→CI path couldn't be walked end-to-end`。

`packages/brain/src/harness-initiative-runner.js` 调用 `executeInDocker` 时未传 `worktreePath`，docker-executor 回落到默认值（cecelia 主仓库），但主仓库不是 worktree，且容器内没有 `GITHUB_TOKEN`——即使能 git commit 也 push 不了。

### 下次预防

- [ ] 新增容器任务时，必须审查 `executeInDocker` 调用点是否传了 `worktreePath` 和必要的凭据 env
- [ ] 容器依赖的外部服务（GitHub / npm / postgres）凭据一律通过 `env`，不 hard-code、不依赖宿主 config 共享
- [ ] Harness 类任务统一用 `ensureHarnessWorktree(taskId)` helper 取 worktree，杜绝复用主仓库
- [ ] E2E 验收必须跑真实 Initiative（不是单元测试绿就算通过），容器里真的 gh pr create 成功才算
