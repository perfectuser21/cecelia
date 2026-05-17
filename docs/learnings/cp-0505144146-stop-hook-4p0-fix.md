# Learning — Stop Hook 4 个 P0 彻底修复（2026-05-05）

分支：cp-0505144146-stop-hook-4p0-fix
版本：Engine 18.21.0 → 18.22.0
前置 PR：#2766/#2767/#2770
本 PR：第 12 段（按段计）

## 故障

5/5 12:55 实战死锁触发 Notion contract 记录的 4 个 P0 bug 同时爆发：

- **BUG-1** stop-dev.sh 字典序遍历 .cecelia/dev-active-*.json 取第一个 break，session B 触发 stop hook 被压去 verify session A 的状态
- **BUG-2** `gh run list --branch X --limit 1` 取最新任意 run，DeepSeek conclusion=success → P4 误判 auto-merge
- **BUG-3** PreToolUse 配置在 `~/.claude/settings.json` 不在 repo，远端 worker 拦不到
- **BUG-4** PR merged 后 brain-ci-deploy.yml fail，verify_dev_complete 永久 block，dev-active 永久 stuck

死锁持续 4+ 轮反馈循环，靠手动 rm dev-active 解开。

## 根本原因

1. **BUG-1**：PR #2503（4/21）标题"cwd-as-key 切线"但实现没真用 cwd 做 key（用 cwd 找 main_repo path 后字典序遍历 break first）。名实不符 bug 持续到 5/5。
2. **BUG-2**：PR #2766 7 阶段重写时，多处 `gh run list --branch` 没加 `--workflow CI`，DeepSeek/archive-learnings 等小 workflow 早完成 → conclusion=success 误判。
3. **BUG-3**：4/21 设计 PreToolUse 时优先单机，没考虑跨机器（远端 worker），settings.json 写到 ~/.claude/ 而非 repo。
4. **BUG-4**：P5/P6 引入时（PR #2766）没设计 escape window — deploy/health fail 修复需独立 PR，但 stop hook 卡在原 dev-active 上永久 block，没有"P5 fail N 次后 auto-expire"机制。

## 本次解法

### BUG-1 cwd 路由（stop-dev.sh:38-93）
2 pass 重写：
- Pass 1: ghost rm（session_id=unknown）+ mtime expire（顺手做 BUG-4 的 A 方案）
- Pass 2: cwd 路由
  - cp-* 分支 → 取对应 dev-active-${branch}.json
  - 主分支 + 单 dev-active → 仍 block（保留 PR #2503 漂移防护意图）
  - 主分支 + 多 dev-active → exit 0（多 session 不混）
  - 主分支 + 0 dev-active → exit 0

### BUG-2 --workflow CI 显式过滤（devloop-check.sh 4 处）
python re.sub 批量改：line 236, 596, 597, 598。所有 `gh run list --branch X --limit N --json` 加 `--workflow CI`。

### BUG-3 PreToolUse 进 repo
新建 `.claude/settings.json` 含 PreToolUse hooks（ScheduleWakeup + Bash matcher → dev-mode-tool-guard.sh）。`$CLAUDE_PROJECT_DIR` 是 CC 内置 env，每个 git clone 该 repo 的 CC 实例自动激活。

### BUG-4 P5/P6 escape window（A + B 双重）
- A. mtime expire（stop-dev.sh）：`STOP_HOOK_EXPIRE_MINUTES` env 默认 30 分钟，超时 dev-active 自动 rm + 顺手清 fail-counter
- B. P5 fail counter（devloop-check.sh）：连续 3 次 P5 deploy fail → auto-expire dev-active + 写 deploy-failed.flag → done。success 分支清 counter

## 下次预防

- [ ] 任何 invariant 改动必须有 integrity 元测试 grep 验证（防 BUG-1 这种"名号在但实现错"潜伏 14 天）
- [ ] gh CLI 调用必须明确 workflow filter（避免最新任意 run 误判）
- [ ] 跨机器配置必须放 repo 级（不放 ~/.claude/ 仅本机）
- [ ] 异步外部状态（deploy / health）必须有 escape window — 不能让 stop hook 永久 stuck
- [ ] cwd 路由 + 单 session 漂移防护要双重保留（cp-* 严格 / 主分支宽松）

## 验证证据

- multi-worktree 5 case + deploy-escape 4 case 全过（BUG-1 + BUG-4）
- unit 32 case 全过（regression-free）
- integrity 15 case 全过（含 L11-L14 grep 验证 4 BUG 修复存在）
- ralph-loop-mode 4/0 + ralph-loop-smoke 12/0 + 7stage-smoke 9/0
- engine 8 处版本 18.22.0
- engine-tests-shell CI job 接 2 个新 .test.sh

## Stop Hook 完整闭环（12 段）

| 段 | PR | 内容 |
|---|---|---|
| 11 | #2770 | integrity 5 修复（死代码激活）|
| **12** | **本 PR** | **4 个 P0 彻底修（BUG-1 cwd 路由 / BUG-2 --workflow CI / BUG-3 settings.json 进 repo / BUG-4 escape window）** |

5/5 12:55 实战死锁后 1 小时修完。Notion contract 4 BUG 待标 ✅ resolved。
