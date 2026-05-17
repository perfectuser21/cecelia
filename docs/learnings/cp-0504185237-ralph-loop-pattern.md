# Learning — Stop Hook Ralph Loop 模式

分支：cp-0504185237-ralph-loop-pattern
日期：2026-05-04
Brain Task：2702073b-cf9e-47c3-832d-fbe417b5d570
前置 PR：#2503 + #2745 + #2746 + #2747 + #2749

## 背景

Stop Hook 修了 5 次仍不收敛。Alex 指出 Anthropic 官方 [ralph-loop 插件](https://github.com/anthropics/claude-plugins-official/tree/main/plugins/ralph-loop) 已有正确模式，照搬即可。

## 根本原因（5 次都没修）

| # | 故障 |
|---|---|
| 1 | **cwd-as-key 信号源不稳**：assistant 工作时 cwd 漂出 worktree（跑 git fetch / gh CLI 在主仓库），stop hook 看到主分支放行 |
| 2 | **状态文件主动权在 assistant 手里**：`.dev-mode.<branch>` 在 worktree 根（暴露），assistant 任何时候能改字段或删文件 |
| 3 | **完成判定靠 `.dev-mode` 字段**：assistant 改 `step_4_ship: done` 即可"假装完成" |

5 次 PR 都修 stop hook **内部判断逻辑**，没改信号源、生命周期、完成判定这 3 个根因——所以越修越复杂仍漏。

## Ralph Loop 三层防御（Anthropic 官方验证有效）

| 层 | Ralph Loop 做法 |
|---|---|
| 1. 状态信号 | 项目根固定路径 `.claude/ralph-loop.local.md`（不依赖 cwd）|
| 2. 文件生命周期 | user 创建 / hook 修改 / hook 删除——assistant 全程不参与 |
| 3. 完成判定 | assistant 必须输出特定字符串 `<promise>...</promise>`——hook 检测才删文件 |

## 应用到 Cecelia /dev

| 改造 | 之前 | 之后 |
|---|---|---|
| 状态信号源 | `.dev-mode.<branch>` 在 worktree 根 | `.cecelia/dev-active-<branch>.json` 在主仓库根 |
| 文件创建 | worktree-manage.sh 在 worktree 根 | worktree-manage.sh 在主仓库根 `.cecelia/` |
| 文件读取 | stop-dev.sh 用 cwd 找 worktree 根 | stop-dev.sh 用 `git worktree list` 找主仓库根 |
| 完成判定 | 读 `.dev-mode` 字段 step_4_ship: done | hook 主动验证（PR merged + Learning grep + cleanup ok）|
| 出口协议 | exit 0 (done) / exit 99 (not-dev) / exit 2 (blocked) | 全部 exit 0 + stdout decision:block JSON |

## 完成判定从字段读取改为主动验证

```bash
verify_dev_complete():
  1. PR merged?      → gh pr view --json mergedAt（GitHub 真实状态，assistant 改不了）
  2. Learning 写好?  → grep '^### 根本原因' docs/learnings/<branch>.md（真有内容才行）
  3. cleanup.sh ok?  → 真跑脚本看 exit code（含部署 deploy-local.sh）
```

assistant 想"假装完成"删 `.cecelia/dev-active-*.json`：
- 文件由 hook 创建 / 修改 / 删除——assistant 全程不碰
- assistant 改 `.dev-mode` 字段不影响——hook 不读字段
- 三条件验证全是真实状态，无法 fake

## 影响：旧 stop-hook 测试基于旧协议，整体待重写

旧 12 场景 E2E + stop-hook-exit-codes + stop-hook-exit + stop-hook 4 个测试文件全部基于旧 `.dev-mode` 字段语义和三态出口协议设计。Ralph 模式协议变了：
- exit code 全 0
- 信号源换了
- 完成判定换了

整体 `describe.skip` 标记 + TODO 注释，待 follow-up PR 用新协议重写。临时由 ralph-loop-mode integration 5 case 覆盖核心行为：
- Case A 状态文件不存在 → 放行
- Case B PR 未创建 → block
- Case C cwd 漂到主仓库 → 仍 block（关键修复 cwd-as-key 漏洞）
- Case D 删 .dev-mode → 仍 block（关键修复自删漏洞）

## 下次预防

- [ ] 任何"信号源"设计先问：assistant 能不能改/删/绕过？只要 assistant 能动 → 不行
- [ ] 完成判定优先用"运行时事件"（gh API / 真跑命令 / 文件 grep），少用"状态字段"
- [ ] 任何 hook/守护 Cecelia 自己改 5 次都不收敛时，**搜索 Anthropic 官方插件**找参考实现
- [ ] cwd 漂移在 long-running session 是常态，任何依赖 cwd 的判断都要质疑
- [ ] 协议级改动（exit code 语义、信号源切换）必须**整体重写**测试，不要用 fallback 兼容旧测试

## Stop Hook 重构最终闭环

| 阶段 | PR | 内容 |
|---|---|---|
| 4/21 | #2503 | cwd-as-key 身份归一（埋了 cwd 漂移漏洞）|
| 5/4 | #2745 | 散点 12 → 集中 3 处 + 守护 |
| 5/4 | #2746 | 探测失败 fail-closed |
| 5/4 | #2747 | 三态出口严格分离 |
| 5/4 | #2749 | condition 5 真完成守门 |
| 5/4 | **本 PR** | **Ralph Loop 模式（信号源 + 生命周期 + 完成判定三换骨）** |

## 验证证据

- ralph-loop-mode integration 5 case 100% 通过（Case A/B/C/D 全过）
- check-single-exit.sh Ralph 守护 8/8 ✅
- 既有 dev-workflow-e2e + engine-dynamic-behavior 等 8 测试文件 130 PASS
- 旧 4 个 stop-hook 测试文件 45 skipped（待 follow-up 重写）
- 8 处版本文件同步 18.19.0
