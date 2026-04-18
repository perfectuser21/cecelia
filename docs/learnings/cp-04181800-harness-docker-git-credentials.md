# Learning: Harness Docker 容器内 git/gh 凭据 + session-env 可写 + recursionLimit 100

- 分支：cp-0418180003-harness-docker-git-credentials
- Task ID：a01319b6-581b-4f89-a363-45e83b61e05e
- 合并日期：（待填）

## 背景

LangGraph + Docker harness pipeline 的前 6 个 PR（#2384/#2385/#2391/#2395/#2399/#2402）把骨架搭起来了，但实际跑时 Generator 节点从未产出真实 PR，Evaluator 每轮 FAIL。

## 根本原因

**三个架构性缺陷叠加**：

1. **CLAUDE_CONFIG_DIR :ro 挂载导致 session-env 写不了**。docker-executor.js 原本把宿主 `~/.claude-account1` 以 `:ro` 挂载到容器内同路径，Claude Code 启动时要在 `session-env/` 下创建会话目录，`mkdir` 直接 ENOENT。整个 Bash tool 链挂掉，任何 `git`/`gh` 命令都没法跑。

2. **容器里没有 git/gh 凭据**。Dockerfile 装了 git 但没装 gh，而且 `~/.gitconfig` 和 `~/.config/gh` 完全没挂进容器。Generator prompt 让 claude 执行 `git push` + `gh pr create`，当然全部失败，最终 `pr_url` / `pr_branch` 为空字符串。

3. **LangGraph 默认 recursionLimit=25 撞墙**。6 节点 pipeline，一个 propose→review→propose→review 的 GAN 循环就是 2 步/轮，撞 25 前最多跑 10 轮。Evaluator Fix 循环也共享这个上限。

产品约束：继续用 Claude Pro 订阅（不切 Anthropic SDK），继续用 colima（不换 Docker runtime）。

## 修复

1. 新增 `docker/cecelia-runner/entrypoint.sh`，容器启动时：
   - `cp -a /host-claude-config/. /home/cecelia/.claude/` —— 把只读挂载复制成可写副本
   - 显式创建 `session-env/` 目录
   - `git config --global --add safe.directory '*'` —— 信任宿主 detached worktree
   - `exec claude -p --dangerously-skip-permissions --output-format json "$@"`

2. `Dockerfile` 加装 `gh` CLI（官方 Debian 源 + keyring），ENTRYPOINT 改为 `/usr/local/bin/entrypoint.sh`，默认 `CLAUDE_CONFIG_DIR=/home/cecelia/.claude`。

3. `packages/brain/src/docker-executor.js` 重写挂载与 env 注入：
   - 宿主 `CLAUDE_CONFIG_DIR` → `/host-claude-config:ro`（从原来的挂到容器内相同路径改过来）
   - 容器内 `CLAUDE_CONFIG_DIR=/home/cecelia/.claude`（entrypoint 产生的可写副本）
   - 默认挂载 `~/.gitconfig:/home/cecelia/.gitconfig:ro`
   - 默认挂载 `~/.config/gh:/home/cecelia/.config/gh:ro`
   - 默认注入 `GIT_AUTHOR_NAME=Cecelia Bot` + `GIT_AUTHOR_EMAIL=cecelia-bot@noreply.github.com`（以及 committer 同值）
   - 把构造逻辑抽成纯函数 `buildDockerArgs()`，方便单测

4. `packages/brain/src/harness-graph-runner.js` 引入 `DEFAULT_RECURSION_LIMIT=100`，调 `app.stream` 时传 `recursionLimit: 100`。允许用 `opts.recursionLimit` 覆盖。

## 验证

- 容器内 git 2.39、gh 2.90、ssh 9.2 均可用
- 手动 `docker run` 测试：`session-env/` 可写、`git config` 读到宿主配置、`gh auth status` 显示登录
- 单测：`docker-executor-mount-strategy.test.js`（4）、`docker-executor-git-env.test.js`（6）、`harness-graph-runner-recursion-limit.test.js`（3）全绿；原 `docker-executor.test.js`（17）和 `harness-graph.test.js`（10）不变

## 下次预防

- [ ] Docker 容器里跑需要写配置的 CLI 工具（Claude Code、npm、pip、cargo...）时，任何只读挂载都要用"entrypoint 复制成可写副本"模式，不要直接把宿主目录挂进去
- [ ] 任何新的 executor/sandbox 提交前，把"能 git push + gh pr create 吗"列为冒烟测试
- [ ] LangGraph 新增循环节点时，同步评估 recursionLimit 是否够用；生产项目默认用 ≥100，不依赖官方默认 25
- [ ] `buildDockerArgs` 这类纯函数抽离是保 single-responsibility 的好办法 —— executeInDocker 只管异步 IO，参数构造单测独立
