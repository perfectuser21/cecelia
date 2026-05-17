# stop-dev-v2：cwd-as-key 方案（原型）

日期：2026-04-21
分支：cp-0421145313-stop-dev-v2-prototype
Brain Task：06891480-4524-4552-bf59-5ba93964f6b0

## 背景

Stop Hook 链路（stop.sh + stop-dev.sh）自 2024 年累计 99 个 commit、近 5 周仅 stop*.sh 就 ~50 次修复，每次"根治"都暴露新 corner case：

- `session_id / owner_session / tty` 所有权匹配失败 → 跨 session orphan 误 block 或误放行
- self-heal 重建 `.dev-lock` 引入所有权验证 3 种组合，每种再修 bug
- 外部 launcher（手工派任务、Claude Agent `isolation: "worktree"`）不写 `.dev-lock` → hook 静默放行 → 无头任务中途退出
- bash 3.2 空数组 + `set -u` 陷阱一次（v18.1.1 刚修）
- 多种 `.dev-mode` 格式并存（标准 `dev\nbranch: xxx` / Codex 格式 / 外部自创 `branch= / task= / agent=`）

根因：把"这个 session 在跑 /dev 吗"的判断绑定在多个可写可错的字段上（`.dev-lock` 的 6 个字段 × 3 条自愈规则 × 2 个 harness 分叉），组合爆炸。

## 核心设计

> **pwd = 所有权的唯一证据**

无头 Claude 进程 cwd 永远是自己的 worktree（`cecelia-run.sh` 用 `setsid bash -c "cd '$ACTUAL_WORK_DIR' && ... claude ..."`）。进程的 cwd 不会假装是别人的，也不会"丢失"需要自愈。

Stop Hook 从 stdin JSON 的 `cwd` 字段（Claude Code 协议自带）推导：

```
cwd → git rev-parse --show-toplevel → worktree 根目录
cwd → git rev-parse --abbrev-ref HEAD → 分支名
worktree/.dev-mode.<branch> 是否存在 → 是否在 /dev 流程
```

## 职责分工

| 文件 | 职责 | 保留/删除 |
|---|---|---|
| `.dev-mode.<branch>` | pipeline 状态（step_1/2/4、ci_fix_count、harness_mode 等 devloop-check 依赖的字段） | **保留**，不变 |
| `.dev-lock.<branch>` | 原"所有权硬钥匙" | **原型不读**（老系统继续写，保持兼容） |
| `devloop-check.sh` | 任务是否完成的业务判断（PR/CI 状态） | **保留**，不变（SSOT） |
| `stop.sh` | 路由 + stdin JSON 解析 + cwd 导出 | 原型阶段不改 |

## stop-dev-v2.sh 行为契约

7 个行为，覆盖所有场景：

1. **bypass**：`CECELIA_STOP_HOOK_BYPASS=1` → exit 0（逃生通道，保留）
2. **cwd fallback**：`CLAUDE_HOOK_CWD` 为空 → 用 `$PWD`；`$PWD` 也不是 git 目录 → exit 0（环境异常不阻塞）
3. **主仓库/默认分支放行**：`branch ∈ {main, master, develop, HEAD}` → exit 0（不打扰日常对话）
4. **非 /dev 流程放行**：cp-* 分支但 `.dev-mode.<branch>` 不存在 → exit 0
5. **格式异常 fail-closed**：`.dev-mode` 首行不是 `dev` → exit 2 + block JSON（打破老行为"静默跳过"，强制暴露 sidecar 撞名问题）
6. **调 devloop_check 守护**：
   - `status == done/merged` → 清 `.dev-mode` + exit 0
   - 其他 → exit 2 + block JSON（reason + next action + ci_run_id）
7. **退化状态透传**：`.dev-mode` 首行是 `dev` 但缺关键字段（如 `branch:`/`step_*`），直接把 devloop_check 返回的 blocked reason 透传出去，不自作聪明补默认值

## 被删掉的复杂度

| 老 stop-dev.sh (~313 行) | 新 stop-dev-v2.sh (~60 行) |
|---|---|
| `_collect_search_dirs` 扫描所有 worktree | 不扫，只看自己 cwd |
| `_session_matches` TTY/session_id/branch 三路匹配 | 无（cwd 即身份） |
| self-heal 重建 `.dev-lock`（40 行） | 无（钥匙是事实，不会丢） |
| 所有权验证 3 条规则（20 行） | 无（进不了别人的 cwd） |
| 跨 session orphan 隔离（40 行） | 无（同上） |
| 主仓库残留 `.dev-lock` 清理（15 行） | 无（只看自己 worktree） |
| harness mode 分叉判断（10 行） | 无（devloop_check 自判） |
| flock / mkdir 并发锁（15 行） | 无（单进程单 cwd，无需并发互斥） |

## 测试策略

`packages/engine/tests/hooks/stop-dev-v2.test.ts` 覆盖 7 个契约行为：

1. `CECELIA_STOP_HOOK_BYPASS=1` → exit 0
2. `CLAUDE_HOOK_CWD` 空 + `$PWD` 不是 git → exit 0
3. cwd=主仓库（branch=main） → exit 0
4. cwd=cp-* worktree 但无 `.dev-mode.<branch>` → exit 0
5. cwd=cp-* worktree 且 `.dev-mode.<branch>` 首行 `branch=xxx`（等号格式） → exit 2（fail-closed，reason 含"格式异常"）
6. cwd=cp-* worktree 且 `.dev-mode.<branch>` 标准格式 + step_2_code=pending → exit 2（block，reason 含"下一步"）
7. cwd=cp-* worktree 且 `.dev-mode.<branch>` 首行 dev 但缺 branch 字段 → exit 2（devloop_check blocked，reason 透传）

mock 层：spawn bash 设 `CLAUDE_HOOK_CWD` 环境变量，准备临时 worktree + `.dev-mode` 文件，断言 exit code + stdout JSON。

## 不做

- 不改 `settings.json`（老 stop-dev.sh 继续挂线）
- 不删 `.dev-lock` 写入代码（`worktree-manage.sh` / `runner.sh` 照旧写）
- 不改 `devloop-check.sh`（SSOT 保留）
- 不改 `stop.sh`（路由器不动）
- 不做一次性切换。原型稳定一周后再切线 + 删老代码

## 风险与缓解

| 风险 | 缓解 |
|---|---|
| 手工派任务用自创 `.dev-mode` 格式（`branch=xxx / task=xxx`）被 fail-closed block | **刻意设计**。老行为静默跳过 → 任务退出无人守。新行为暴露问题，推动外部 launcher 对齐协议或显式删 `.dev-mode` 再跑 |
| 交互模式下用户在主仓库开 Claude 再 `cd` 到 worktree | `stop.sh` 已经从 stdin 拿 cwd（不是 hook 进程的 `$PWD`），Claude 进程自己的 cwd 是准的 |
| `CLAUDE_HOOK_CWD` 不传（异常 stdin） | fallback 到 `$PWD`，最坏情况退化到与老 stop-dev.sh fallback 一致的分支判断 |

## 验收

- `bash packages/engine/hooks/stop-dev-v2.sh` 在主仓库 exit 0
- `CECELIA_STOP_HOOK_BYPASS=1 bash packages/engine/hooks/stop-dev-v2.sh` exit 0
- `tests/hooks/stop-dev-v2.test.ts` 5 个用例全绿
- 原型阶段不挂线，不影响现有 stop hook 行为
