# Learning: cp-0505191801 Stop Hook 隔离 key 切到 session_id

## 概述

把 stop-dev.sh 的隔离 key 从 `cwd→branch` 切到 `hook stdin payload session_id`，彻底解多 session 撞 .cecelia/ 池串线问题（半年 50+ 次修复的根因）。worktree-manage.sh 的 `_resolve_claude_session_id` 调换优先级（ps 沿 PPID 找 claude `--session-id` 参数优先于 env var），让 dev-active.session_id 字段对齐 hook payload 的主 session_id。

## 实战触发现场

写完 PR #2784 docs(brain) consciousness-loop spec 后，session（86197599）切回主仓库 cwd 跟用户讨论 stop hook 设计。Stop hook 反复 block 7+ turn 反馈"PR 未创建"（实际 PR 已存在但反馈滞后），用户体验为"假死循环"。

诊断过程暴露 3 重叠 bug：
1. cwd→branch 路由把别人的 dev-active 误指给当前 session（多 session 撞池）
2. dev-active.session_id 字段（worktree-manage 写入的）跟 hook payload session_id 不匹配（CLAUDE_SESSION_ID env var 是 sub-shell 级，不是主 claude 级）
3. P1 PR 检测虽然能查到已 merged 的 PR，但反馈字符串滞后导致看上去像 hang

## 根本原因

**dev-active 文件用 `<branch>` 作 key + stop-dev.sh 用 cwd→branch 路由**，让多 session 共享同一个 .cecelia/ 池却没法互相区分。半年 50+ 次修复都在打补丁这个底层路由 bug，没真正切到 session 级隔离 key。

具体：
- stop-dev.sh:91-120 老路由：`current_branch=$(git rev-parse --abbrev-ref HEAD)` + case cp-* → 取 `dev-active-${branch}.json`
- 主分支 cwd 时走 case `*`，单 dev-active 就 block，多 dev-active 就 exit 0 — 这俩规则都是估算，不精确
- worktree-manage.sh:488 `_resolve_claude_session_id` 优先用 `CLAUDE_SESSION_ID` env var — 但 Bash tool sub-shell 的这个变量跟主 claude 进程的 `--session-id` 参数不一致

## 下次预防

- [ ] **隔离 key 选 session_id 不选 branch**：长期任务跨多 session 时（Brain 派 docker / 用户切 worktree / pipeline 多步），branch 不唯一也不稳定，session_id 由 CC framework 在 turn 边界传 stdin payload，全局唯一可信
- [ ] **优先用 ps 沿 PPID 找 cmdline，不用 env var**：env var 在 sub-shell 链中可能被覆盖/丢失/不一致，进程 cmdline `--session-id` 参数是父进程权威
- [ ] **改路由 key 时，integration 测试要传 stdin payload**：老测试 run_stop_dev 不传 stdin → v22 路由模式下走 fallback 而非 session_id 路由 → 测试 case 表面"通过"实际验证错路径
- [ ] **架构三层不要混淆**：L3 Pipeline 用 LangGraph + thread_id（已对），L2 Task = 1 PR = 1 Session（Opus 长 turn 跑完整 dev，graph 不进），L1 Stop Hook 只守 session 内 turn 不偷停（用 session_id 隔离）。把 L1 问题用 L3 方案解（"拆 graph node"）= 错层，违反 1 task=1 session 最小单元
- [ ] **PR 状态检测 fallback 要查 merged**：`gh pr list --state open` 不到不代表 PR 不存在，应 fallback `--state merged`（devloop-check.sh:217-222 已对）；hook 反馈滞后是 CC framework 缓存特性，不是 hook bug

## 修复涉及文件

- `packages/engine/hooks/stop-dev.sh` — 入口读 hook stdin payload session_id + 精确路由（v22.0.0）
- `packages/engine/skills/dev/scripts/worktree-manage.sh` — `_resolve_claude_session_id` 调换优先级（ps 优先于 env）
- `packages/engine/tests/integration/stop-dev-session-id-routing.test.sh` — 新建 8 case
- `packages/engine/tests/integration/ralph-loop-mode.test.sh` — Case C 改 session_id 路由
- `packages/engine/tests/integration/stop-hook-e2e-real-brain.test.sh` — 传 stdin session_id
- Engine 6 处版本文件 18.22.3 → 18.23.0
- `packages/engine/feature-registry.yml` — 加 18.23.0 changelog entry

## 测试结果

- 新增 stop-dev-session-id-routing.test.sh：8/8 ✅
- stop-dev-multi-worktree.test.sh：5/5 ✅
- ralph-loop-mode.test.sh：4/4 ✅
- stop-dev-deploy-escape.test.sh：4/4 ✅
- stop-dev-ghost-filter.test.sh：4/4 ✅
- stop-hook-7stage-flow.test.sh：5/5 ✅
- stop-hook-e2e-real-brain.test.sh：3/3 ✅
- verify_dev_complete unit：32/32 ✅
- integrity meta-check：19/19 ✅

整体 84 个测试用例全过，零 regression。
