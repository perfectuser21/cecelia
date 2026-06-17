# Learning — readPrFromGitState 的 gh 调用缺 cwd 导致 Protocol v2 兜底失效

## 运行指标

- 模式：TDD（先写 failing test → 修复 → 全绿）
- 分支：cp-06121221-fix-gh-cwd
- 涉及文件：`packages/brain/src/harness-shared.js`
- 实证 run：badaf654（generator 完成 $10.85 全部工作，PR #3367 OPEN、TDD 三 commit，仅因最终消息缺 verdict JSON 走兜底，兜底因本 bug 返回 null → 整个 run 误判 no_pr 终败）

## 发现的问题

### [BUG] 代码缺陷

- **`readPrFromGitState` 的 `gh pr list --head <branch>` 调用未指定 cwd 也未传 --repo**。Protocol v2 兜底本就是为"不依赖 LLM stdout 提取 pr_url"而设计，但 Brain 容器进程 cwd=/app（非 git 仓库），gh 按 cwd 推断 repo → 报 `failed to run git: fatal: not a git repository` → 被静默 catch 吞掉 → 兜底返回 null → 失效。
  - 容器内复现：`docker exec <brain> gh pr list --head cp-06121127-ws-badaf654-ws1 --json url` → not a git repository；同命令在 worktree cwd 下正常返回 PR URL。
  - 修复：gh 调用加 `cwd: worktreePath`（worktree 是 git 仓库，gh 可自动推断 repo）。git rev-parse 已用 `-C worktreePath` 显式指定，无需改。

### [DESIGN] 静默 catch 吞错

- catch 块直接 `return null` 不打日志，是本次排障最贵的部分（整个排查时间几乎全花在"为什么兜底没生效"上）。
  - 修复：catch 里加 `console.warn` 带 `err.message`，保持返回 null 语义不变（兜底失败不应 throw 打断 pipeline）。

## 根本原因

依赖 cwd 推断上下文的 CLI（gh、git 无 -C 时）在守护进程（cwd=/app）里调用必然取错上下文。`readPrFromGitState` 把 git 用 `-C` 显式化了，却漏了同段的 gh —— gh 不支持 `-C`，必须用 `cwd` 选项（或 `--repo`）显式指定。叠加静默 catch 把唯一的错误信号也吞了，使一个一行级 bug 拖垮了整条 run 的终态判定。

## 下次预防清单

- [ ] 守护进程里所有依赖 cwd/repo 推断的 CLI 调用（gh/git/docker 等）必须显式传上下文（cwd 或 -C 或 --repo），不能依赖进程 cwd
- [ ] 兜底路径（fallback）的 catch 至少 `console.warn(err.message)`，绝不静默 `return null` —— 兜底静默失败会把单点 bug 放大成全链路误判
- [ ] 审计同文件/同类 gh 调用：本次确认 `readPrFromGitState` 是 harness-shared.js 内唯一依赖 repo 推断的 gh 调用；其余 gh 调用（orphan-pr-worker.js / shepherd.js / harness-ci-gate.js 等）均显式传 prUrl/prNumber，不依赖 cwd 推断，无需改
