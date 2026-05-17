# Learning — Stop Hook 彻底终结（cwd-as-key）

分支：cp-0421154950-stop-hook-final
日期：2026-04-21
Task：7001a013-cd7a-414a-9d03-eaf9b89033f1
前置 PR：#2501（原型，2026-04-21 合）

## 背景

Stop Hook 从 2024 年开始累计 99 commit 仍不收敛。近 5 周 50+ 次修复，
每次"根治"都暴露新 corner case。直到这次系统性诊断才看清根因。

### 根本原因

**多字段所有权匹配组合爆炸 × stop.sh 路由层死路**。

具体：
1. `.dev-lock` 里绑了 session_id / tty / owner_session 三个"身份字段"
2. stop-dev.sh 围绕这三个字段加了 self-heal（3 条规则）、跨 session orphan 隔离、harness_mode 分叉、3 层 fallback 匹配
3. stop.sh 路由层 L86-112 在 session_id 精确匹配失败时**直接 exit 0 放行**
4. 而 worktree-manage.sh 在交互模式（用户没配 shell alias，无 CLAUDE_SESSION_ID）下把 owner_session 写成字符串 `"unknown"`
5. `"unknown" != 任何真实 session_id` → stop.sh 永远走 exit 0 放行路径 → stop-dev.sh 的所有逻辑（devloop_check / 等 CI / 自动合并）**从未被真正调用过**

前 99 commit 都在修 stop-dev.sh 和 devloop_check 的逻辑 bug，**而真正漏的是 stop.sh 第 100 行**。

## 本次解法

把所有权判断从"可写可错的 .dev-lock 字段"切换到"进程层事实 cwd"：

- 无头 Claude：cecelia-run.sh 用 setsid bash -c "cd worktree && claude" → 进程 cwd = worktree
- 交互 Claude：Claude Code 协议通过 stdin JSON 的 cwd 字段传入
- stop.sh 解析 cwd → export CLAUDE_HOOK_CWD → 无条件调 stop-dev.sh
- stop-dev.sh 从 cwd → git rev-parse 得 worktree + branch → 只看 .dev-mode.<branch> 是否存在且首行 dev

cwd 是进程层事实，**不会丢失需要自愈、不会被别人伪造、不需要多个 writer 对齐协议**。

## 删除的复杂度（全部为次生，cwd-as-key 下不再需要）

- self-heal 重建 .dev-lock（40 行）
- owner_session / session_id / tty 三字段匹配 + 3 种 fallback（60 行）
- 跨 session orphan 隔离（40 行）
- _collect_search_dirs 扫所有 worktree（15 行）
- _session_matches TTY/session/branch 三路匹配（15 行）
- flock/mkdir 并发锁（15 行）
- harness_mode 分叉（10 行）

stop-dev.sh：313 → 85 行。stop.sh：178 → 110 行。净删 ~250 行。

## 防回归（这次与以前不一样）

1. `packages/engine/tests/e2e/stop-hook-full-lifecycle.test.ts` 12 场景纳入 engine-tests
   每个场景真起 git repo + 真 spawn stop.sh + gh stub，覆盖 bypass/各 pipeline 阶段/PR-CI 状态/交互/无头/格式异常
2. 任何触碰 stop*.sh / worktree-manage.sh / devloop-check.sh 的 PR 必须跑这 12 场景
3. 本 Learning 作为"路线终结声明"，后续任何回滚 cwd-as-key 的 PR 必须先废止本文件

### 下次预防（系统级规则）

- [ ] 任何"进程/会话身份"判断必须优先用**进程层事实**（cwd、pid、协议字段），禁止靠工作目录元数据文件
- [ ] 同一 hook 同一功能如 3 次修复不收敛，强制触发 systematic-debugging Phase 4.5（质疑架构）
- [ ] Hook 读状态文件时 fail-closed（格式异常 exit 2 block + 显式 reason），禁止 silent skip
- [ ] 新增"所有权字段"到 .dev-lock/.dev-mode **禁止**（老路复活）。如需新元数据，写 sidecar 文件（不叫 .dev-*）
- [ ] stop.sh / stop-dev.sh 任何改动必须附 E2E 场景新增/修改

## 下一步（本 PR 合并后）

1. 观察一周：注意有没有场景漏掉的（E2E 未覆盖的）
2. 一周无异常 → 删 worktree-manage.sh 里的 .dev-lock 写入逻辑（现在留着向后兼容）
3. 一周后 stop.sh 可进一步简化（路由层已退化成"调 stop-dev.sh"，可合并到 stop-dev.sh）
