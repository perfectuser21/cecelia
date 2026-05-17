# Learning — Stop Hook 二次精修（classify_session fail-closed）

分支：cp-0504140226-single-exit-strict
日期：2026-05-04
Brain Task：60d121d8-2db4-452b-a5fa-6e7e612e16c4
前置 PR：#2745（c1f1e65ed，cp-0504114459）

## 背景

PR #2745 完成 stop hook 散点 12 → 集中 3 处的拓扑归一。但 stop-dev.sh `case not-dev|done) exit 0` 把 not-dev 路径也归到 exit 0。Alex 反复强调真正意图：

> "你一旦确认进入开发模式（开始写代码这个模式），它只有一个（exit 0），而不是很多地方等等待"

含义：**一旦确认进入开发模式（.dev-mode 存在 + cp-* 分支），唯一的 exit 0 = PR 真完成；其他全 exit 2**。

## 根本原因

PR #2745 的 classify_session 把"探测失败"路径也归到 status=`not-dev`：
- cwd 不是目录（文件系统竞态）→ not-dev → exit 0 ✗
- git rev-parse --show-toplevel 失败（git 锁竞态）→ not-dev → exit 0 ✗
- git rev-parse --abbrev-ref HEAD 失败 → not-dev → exit 0 ✗

这意味着在 dev worktree 内，任意一次 git 抖动就会让 stop hook 误放行 — 这就是 Alex 最早说的"PR1 开就停"的真正源头。

## 本次解法

最小化精修：仅改 classify_session 的 3 处 status 字符串（not-dev → blocked），不动 stop-dev.sh / stop.sh / 出口拓扑。

| 路径 | 之前 | 之后 |
|---|---|---|
| bypass env | not-dev | not-dev（保持，明确放行） |
| cwd 不是目录 | not-dev | **blocked**（fail-closed） |
| git rev-parse --show-toplevel 失败 | not-dev | **blocked**（fail-closed） |
| git rev-parse --abbrev-ref 失败（含 unborn HEAD 特殊处理） | not-dev | **blocked**（fail-closed），unborn HEAD 例外（fall through 到主分支放行）|
| 主分支 | not-dev | not-dev（保持） |
| 无 .dev-mode | not-dev | not-dev（保持） |
| .dev-mode 格式异常 | blocked | blocked（保持） |

判定原则：**能明确"用户在跟我聊天"** → not-dev；**任何"我读不到状态"** → blocked（fail-closed）。

unborn HEAD 例外：`git rev-parse --abbrev-ref HEAD` 在无 commit 仓库 exit=128 但 stdout="HEAD"。这是合法 git 状态（不是异常），通过 `if ! cmd; then if [[ $branch != "HEAD" ]]; then blocked; fi; fi` 让 stdout="HEAD" fall through 到主分支放行（命中 `case main|master|develop|HEAD`），真正失败（stdout 空）才 blocked。

实施量：~14 行 diff（3 处字符串 + unborn HEAD 处理）。

## 下次预防

- [ ] 任何"探测异常"路径都必须 fail-closed（status=blocked），不能 fail-open（not-dev）
- [ ] 区分"明确语义" vs "探测失败"两类路径——前者放行，后者 block
- [ ] 设计 spec 时区分 Alex 的字面要求（"一个 exit 0"）和精神要求（"不要散点误放行"）——后者优先
- [ ] Research Subagent 抓到的 "必须修复" 提示必须当场决定 fix（不要"实施时按发现调整"）
- [ ] git 命令的退出码 vs stdout 行为差异必须实测确认（如 unborn HEAD 是 exit 128 + stdout="HEAD"），不能基于直觉

## 验证证据

- 12 场景 E2E（packages/engine/tests/e2e/stop-hook-full-lifecycle.test.ts）100% 绿灯
- 10 分支 integration（packages/engine/tests/integration/devloop-classify.test.sh）100% 绿灯（含 4 个新增/修订 fail-closed case）
- 51/52 stop-hook 相关测试通过（1 skipped，行为完全兼容）
- check-single-exit 守护通过（出口拓扑未变）
- 8 处版本文件同步 18.17.1
