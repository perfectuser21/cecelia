# Learning: Codex 原生只读 AGENTS.md 不读 CLAUDE.md 的规则真空

## 背景

Kernel Harness 会把任务分派给 Claude Code / Codex / Grok 三个 provider 执行。07-29 用本机已认证的 codex（team1 账号）和 grok CLI 实测三者对本仓库规则文件的原生加载行为，发现完全不对称。

## 发现

- `codex exec` 纯任务提示词下（不提规则）只原生读取 cwd 下的 `AGENTS.md`，完全不读 `CLAUDE.md`
- `grok` CLI 同样条件下会同时主动读取 `AGENTS.md` 和 `CLAUDE.md`
- Claude Code 原生读 `CLAUDE.md`（已知行为，本次未重复验证）
- 本仓库根目录 `AGENTS.md` 自 2026-03-16 起未更新（101 行纯架构地图），不含任何行为约束（语言规则/分支保护/危险操作确认/DevGate 等）

### 根本原因

`AGENTS.md` 和 `CLAUDE.md` 是两个厂商各自约定的"原生自动加载"文件，此前从未有人显式设计过跨厂商的规则一致性——每次给 `CLAUDE.md` 加新规则时，没人会同时想到"Codex 读的是另一个文件"。两个文件天然会走散，而且走散是**沉默的**：没有任何机制会报警，直到有人专门去实测才会发现。

### 下次预防

- [x] 已建立 `<!-- HARD_RULES:BEGIN/END -->` marker 区块（`.claude/CLAUDE.md` 与 `AGENTS.md` 各一份，逐字同步）+ `scripts/check-agents-rules-sync.sh` drift-guard + CI 门禁（PR #4458，`Smoke Glob Runner` 接入）
- [ ] 后续在 `CLAUDE.md` 加新硬规则时，必须同步进 `AGENTS.md` 对应区块（CI 会拦，但人工改动时仍需留意，别指望完全无脑）
- [ ] 更大范围：Kernel v2 `orchestrator/` 层面的统一规则注入机制仍未建（被 P0 `985c276a`/`4a530430` 阻塞），届时应该让那套机制吸收掉本次的静态文件镜像方案，而不是长期维护两条并行路径

## 衍生发现（本次调研顺带挖出，未在本次处理完）

- `system_modules` 知识库（`/architect Mode 1` 产出，Owner 依赖它看懂系统）完全没覆盖 Kernel v2 的 `orchestrator/` 子系统（`provider-registry.js`/`skill-bundle.js`/`providers/*.js` 均无卡片）——本次已补 4 张卡片，但整体覆盖仍不完整
- `MEMORY.md` 索引里有两条死链接（`feedback_claudemd_minimal_injection.md` / `claude-context-injection-mechanism.md` 文件实际不存在）——已在本次修复
- 存在两条并行、职责不同的调度系统：老的 `executor.js` 通用任务分发器（服务 /dev /talk /review，派 MiniMax/Codex Bridge/Docker，**不含 Grok**）vs 新的 Kernel v2 `orchestrator/`（claude/codex/grok 三家对等 provider registry），容易被误认为同一套，目前没有任何文档说明这个区分

## 操作性教训（本次执行 /dev 流程中踩到的）

- worktree 数量撞上限（20/15）时，`worktree-manage.sh create` 会失败并尝试自动清理但可能清不出空间；解法是在已有的 session 专属 worktree 内直接 `git checkout -b cp-*` + 手写 `.dev-lock.<branch>`，不需要新开一个 git worktree
- PR CI 全绿但 `mergeStateStatus=BEHIND` 时用 `gh pr update-branch` 解决（非新发现，验证了已有教训 [[feedback_pr_stuck_behind_churn]]）；update 之后 `mergeStateStatus` 会先变成 `BLOCKED`（等新一轮 CI 跑完），不是卡死，继续轮询即可
- 手动 `PATCH /api/brain/tasks/:id {status:in_progress}` 会隐式设置 `claimed_by`，导致后续再显式调用 `/claim` 端点返回 409——不是真撞车，是同一操作者两次不同接口调用叠加产生的假警报；下次应该只走 `/claim` 一条路径认领任务，不要先 PATCH 状态再调 claim
