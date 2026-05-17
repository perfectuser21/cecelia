# Stop Hook 彻底终结 — cwd-as-key 切线 + E2E 回归防线

日期：2026-04-21
分支：cp-0421154950-stop-hook-final
Brain Task：7001a013-cd7a-414a-9d03-eaf9b89033f1
前置 PR：#2501（stop-dev-v2 原型，已合并）

## 问题陈述

老 Stop Hook 体系累计 99 个 commit 仍不收敛。每次"根治"都暴露新 corner case。根因：

1. **多字段所有权匹配组合爆炸**：`.dev-lock` 的 session_id / tty / owner_session × self-heal 3 条规则 × 跨 session orphan 隔离 × harness_mode 分叉 = 8+ 种状态组合
2. **多个 writer 不对齐**：`/dev 主流程` / Codex runner / 外部 launcher / Claude Agent isolation 各写各的格式
3. **stop.sh 路由层死路**：L86-102 当 `owner_session != CLAUDE_HOOK_SESSION_ID` 时直接 exit 0。**交互模式（无 shell alias）下 owner_session 被写成 `unknown`，永远不匹配任何 session_id**，整个 hook 链条被短路——devloop_check 都走不到
4. **格式异常静默跳过**：老 hook 读到格式错的 .dev-mode 就 `continue`，任务中途退出无人守护

## 核心设计

**cwd = 所有权的唯一证据**

- 无头 Claude：`cecelia-run.sh` 用 `setsid bash -c "cd '$ACTUAL_WORK_DIR' && ... claude ..."`，进程 cwd 恒是 worktree 目录
- 交互 Claude：hook stdin JSON 里的 `cwd` 字段（Claude Code 协议自带）就是当时的 cwd
- cwd → `git rev-parse --show-toplevel` 得 worktree 根 → `git rev-parse --abbrev-ref HEAD` 得分支 → `.dev-mode.<branch>` 是否存在即"是否在 /dev 流程"

这是**进程层事实**，不会丢失需要自愈、不会被其他文件覆盖、不需要多个 writer 对齐协议。

## 架构

```
Stop Hook 被调用
  ↓
stop.sh
  - 从 stdin JSON 解析 cwd → export CLAUDE_HOOK_CWD
  - 只做 2 件事：fire-and-forget conversation-summary / 孤儿 worktree 清理
  - 调 stop-dev.sh（无条件，让它自己判）
  ↓
stop-dev.sh（新，~60 行，替换老的 313 行）
  - bypass env → exit 0
  - cwd 非 git / main/master → exit 0
  - cp-* 分支 + 无 .dev-mode → exit 0（不在 /dev 流程）
  - .dev-mode 首行非 "dev" → exit 2 fail-closed
  - 调 devloop_check（SSOT，业务判断）
  - status=done/merged → rm .dev-mode + exit 0
  - 其他 → exit 2 + reason 透传
```

## 变更清单

### 替换

| 文件 | 老行数 | 新行数 | 说明 |
|---|---|---|---|
| `packages/engine/hooks/stop-dev.sh` | 313 | ~60 | 用 v2 原型的 cwd-as-key 逻辑重写 |
| `packages/engine/hooks/stop.sh` | 178 | ~140 | 删 owner_session 路由段（L86-112），改 cwd-based 路由 |

### 删除

- `packages/engine/hooks/stop-dev-v2.sh` — 原型已融入 stop-dev.sh，单独文件删除
- `packages/engine/tests/hooks/stop-dev-v2.test.ts` — 7 个用例迁移并扩展到 stop-hook-full-lifecycle.test.ts
- 老 stop-dev.sh 内的：self-heal（L60-129）/ 所有权验证（L96-115）/ 跨 session orphan 隔离（L184-233）/ `_session_matches`（L42-56）/ `_collect_search_dirs`（L26-39）/ flock/mkdir 并发锁（L237-253）/ harness_mode 分叉（多处）

### 增强

- `packages/engine/skills/dev/scripts/worktree-manage.sh` 第 242 行附近 — 创建 worktree 时**强制写 `.dev-mode.<branch>` 标准格式**，内容：
  ```
  dev
  branch: <branch_name>
  session_id: <claude_session_id or unknown>
  started: <ISO8601>
  step_1_spec: pending
  harness_mode: false
  ```
  （不再只写 .dev-lock，后续 /dev 流程不用手动创建 .dev-mode）

- `packages/engine/hooks/stop.sh` — 路由层简化：
  - 删 L84-112 的 session_id 精确匹配 + fallback
  - 改为：stdin JSON 拿 cwd → export 给 stop-dev.sh → 无条件调 stop-dev.sh（stop-dev.sh 自己判是否在 /dev 流程）

### 新增

- `packages/engine/tests/e2e/stop-hook-full-lifecycle.test.ts` — 12 场景端到端回归防线

## E2E 回归防线（核心）

`stop-hook-full-lifecycle.test.ts` 覆盖 12 个场景，**每个场景都起真 git repo + 真 worktree + spawn 真 stop.sh**，不 mock：

| # | 场景 | 前置 | 期望 |
|---|---|---|---|
| 1 | 主仓库日常对话 | cwd=main repo, branch=main | exit 0 |
| 2 | cp-* 分支无 dev-mode | cwd=cp-*, 无 .dev-mode.\<branch\> | exit 0 |
| 3 | 格式异常 fail-closed | .dev-mode 首行 `branch=xxx` | exit 2 + stdout 含"格式异常" |
| 4 | 标准 dev-mode step_1 pending | step_1_spec=pending | exit 2 + reason 含"Spec" |
| 5 | PR 未建 step_2 done | step_2_code=done, 无 pr_url | exit 2 + reason 含"创建 PR" |
| 6 | CI in_progress | 有 pr_url, mock CI running | exit 2 + reason 含 CI |
| 7 | CI failed | mock CI failed | exit 2 + reason 含"失败" |
| 8 | CI 绿 + 未合并 | mock CI success, PR open | 触发 gh pr merge + exit 0（或 exit 2 block 让上层合）|
| 9 | PR merged + step_4_ship done | pr.state=MERGED, step_4_ship=done | exit 0 + .dev-mode 被清 |
| 10 | 交互模式（无 session alias） | CLAUDE_HOOK_SESSION_ID 空 | 按 cwd 走通，不因 session 空而误 exit 0 |
| 11 | 无头模式（setsid cwd） | CLAUDE_HOOK_CWD 指向 worktree | 按 cwd 走通 |
| 12 | bypass env | CECELIA_STOP_HOOK_BYPASS=1 | exit 0 |

CI 侧这 12 场景进 engine-tests，以后动 stop*.sh / worktree-manage.sh / devloop-check.sh 都会跑。

## 兼容性

**向后兼容 .dev-lock**：不读但也不禁止。worktree-manage.sh 仍写 .dev-lock（老代码习惯），stop-dev.sh 不读它。一周观察期后删 `.dev-lock` 写入代码。

**向后兼容 Codex runner**：runner.sh 写的 .dev-mode 是标准格式（第一行 `dev`），新 stop-dev.sh 正常识别。

**向后兼容 harness**：harness_mode 字段还在 .dev-mode 里，由 devloop_check 自己处理（0.5 通道逻辑），stop-dev.sh 不关心。

## 防回归

1. `stop-hook-full-lifecycle.test.ts` 纳入 engine-tests 必跑
2. 任何触碰 `packages/engine/hooks/stop*.sh` 或 `packages/engine/lib/devloop-check.sh` 或 `worktree-manage.sh` 的 PR 都必须跑这 12 场景
3. Learning 文件详细记录根因 + 下次预防（**禁止在 .dev-lock 字段上加所有权规则**、**禁止 stop.sh 加 session_id 精确匹配路由**）
4. `docs/learnings/cp-0421154950-stop-hook-final.md` 作为"终结声明"，后续任何回滚这条路线的 PR 都必须先废止这个 learning

## 成功标准

- [ARTIFACT] 老 stop-dev.sh 被替换（行数 313 → ≤80）
- [ARTIFACT] stop-dev-v2.sh + 其 test 被删（避免两份同功能）
- [ARTIFACT] stop.sh 简化（删 session_id 精确匹配段，~40 行减少）
- [ARTIFACT] worktree-manage.sh 创建 worktree 时写 .dev-mode 标准格式
- [ARTIFACT] stop-hook-full-lifecycle.test.ts 12 场景
- [BEHAVIOR] E2E 12 场景全绿
- [BEHAVIOR] engine-tests CI 全绿
- [BEHAVIOR] 手工 smoke：在当前这个 worktree 里，turn 之间 stop hook 真正守住（PR 未合并时 block 退出）

## 不做

- 不改 `devloop-check.sh` 业务逻辑
- 不改 .dev-mode 的 pipeline 状态字段（step_1_spec 等）
- 不改 Codex runner 的 .dev-mode 写入
- 不改 stop-architect.sh / stop-decomp.sh（不同 skill 的 hook）
- 不动 settings.json（路径就是 hooks/stop.sh）

## 风险与缓解

| 风险 | 缓解 |
|---|---|
| 删 self-heal 后某些场景 .dev-mode 丢失被误 block | worktree-manage 强制创建 .dev-mode + cwd 判断只看存在性，不会因字段缺失误 block（格式校验只看首行 "dev"）|
| 外部 launcher 写自创格式 .dev-mode 被 fail-closed | **刻意**。老行为静默跳过是根因之一。要求外部 launcher 对齐或改文件名（不叫 .dev-mode.*） |
| 当前 worktree 已有老格式 .dev-lock 但没 .dev-mode | 当前 worktree 新建时 worktree-manage 就会写 .dev-mode 新格式，老 worktree 手工删或无视即可 |
| 合并当时自己（本 PR）的 /dev 流程走不通（在本 worktree 里） | 本 PR 改 stop-dev.sh 但自己的 worktree 已经有 .dev-lock（带 owner_session=unknown）；中间阶段可能触发自守，加 CECELIA_STOP_HOOK_BYPASS 逃生 |
