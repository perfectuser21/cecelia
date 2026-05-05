# PRD: Stop Hook 路由 key 切到 session_id

## 背景

Stop hook 半年修了 50+ 次仍在串线。本次实战（PR #2784 ship 过程）暴露 4 个相关 bug 在同一现场叠加：多 session 撞同一个 `.cecelia/dev-active-*` 池、cwd→branch 路由错配、空启动 ghost 永久 block、PR 状态时序错位。

根因唯一：**dev-active 隔离 key 选错**。当前用 `<branch>` 作 key，多 session 并行时 cwd→branch 路由把别人的 dev-active 指给当前 session。

## 目标

把 L1 stop hook 的隔离 key 从 `cwd→branch` 切到 `session_id`，让多 session 物理隔离不串线。**单 task 流程零修改**（保留 1 PR = 1 session = 1 task 的最小单元，保留 Opus 长 turn 跑完整 dev 的能力）。

## 范围

**改**：
- `packages/engine/hooks/stop-dev.sh` — 入口路由段（~30 行）
- `packages/engine/skills/dev/scripts/worktree-manage.sh` — 写 dev-active 段（~5 行）
- 新增 `packages/engine/lib/dev-active-gc.sh` — 空启动 5 分钟 GC 探测（~30 行）

**不改**：
- `packages/engine/lib/devloop-check.sh` 的 P1-P8 verify 逻辑
- `dev-task.graph.js` / `harness-*.graph.js`（L3 LangGraph 编排不动）
- 单 task /dev 流程（spec → code → push → CI → merge → deploy → done 完整保留）

## 改动设计

### 1. dev-active 文件名 schema

```
旧: .cecelia/dev-active-<branch>.json
新: .cecelia/dev-active-<session_id>.json
```

文件内容新增字段（已有的 `branch` 字段保留）：
```json
{
  "session_id": "<CC stop hook stdin payload session_id>",
  "branch": "cp-XXXXXXXX-XXX",
  "worktree": "/path",
  "started_at": "2026-...",
  "task_id": "<Brain task id, optional>"
}
```

### 2. stop-dev.sh 路由

```bash
# 读 hook stdin payload
payload=$(cat)
session_id=$(echo "$payload" | jq -r '.session_id // ""')

# 精确路由
if [[ -n "$session_id" ]]; then
  dev_state="$dev_state_dir/dev-active-${session_id}.json"
  [[ -f "$dev_state" ]] || exit 0
else
  # 兜底：无 session_id（极少见，如 hook 协议异常）→ exit 0
  exit 0
fi
```

**完全删掉**当前 stop-dev.sh 的 cwd→branch 路由整段（line 87-120 的 Pass 2）。

### 3. worktree-manage.sh

写 dev-active 时使用 hook 协议级 session_id（不是 `headed-$$-${branch}`）：

```bash
# 已经从 _resolve_claude_session_id 拿到 _claude_sid_create
local dev_active_file="$main_repo/.cecelia/dev-active-${_claude_sid_create}.json"
# 而不是 dev-active-${branch_name}.json
```

### 4. 新 dev-active-gc.sh（空启动检测）

```bash
# 每个 dev-active 文件：
#   age > 5 min + worktree 0 commit + 远端无 branch + 无 PR → 视为空启动 → rm
# 由 stop-dev.sh 入口 Pass 1 调用（替代当前的 30min mtime expire 兜底）
```

## 成功标准

- [BEHAVIOR] **单 session 单 task**：worktree A 启动 /dev，hook block 让其收尾（同当前行为不变）
- [BEHAVIOR] **多 session 多 task 并行**：worktree A 的 session A1 + worktree B 的 session B1 同时活跃，A1 的 stop hook 只看 A1 的 dev-active，B1 的只看 B1 的（物理隔离）
- [BEHAVIOR] **session 漂主仓库**：session 在 worktree A 启动 /dev 后切到主仓库 cwd 跟用户讨论别的事，hook 仍能找到自己的 dev-active（用 session_id 路由），block 让其收尾
- [BEHAVIOR] **空启动 ghost 自动清**：dev-active 写入但 worktree 0 commit + 远端无 branch + 无 PR，5 分钟内自动 GC，不再永久 block
- [BEHAVIOR] **普通对话不在 /dev 流程**：session 没创建 dev-active 就启动 claude（如纯对话），hook stdin 的 session_id 找不到对应 dev-active → exit 0 放行
- [ARTIFACT] `stop-dev.sh` 删除 `cwd→branch` 路由代码（grep 无 `rev-parse --abbrev-ref` 或仅在 worktree-manage.sh 内）
- [ARTIFACT] `worktree-manage.sh` 写 dev-active 时文件名用 `${_claude_sid_create}`（不用 `${branch_name}`）
- [ARTIFACT] 新文件 `packages/engine/lib/dev-active-gc.sh` 存在
- [ARTIFACT] 新测试 `tests/integration/stop-dev-session-id-routing.test.sh` 覆盖上述 5 个 BEHAVIOR

## Out of scope

- 不改 P1-P8 verify 逻辑（已经是好的）
- 不动 LangGraph graph
- 不动 dev 流程内部
- 不实现 task_id 字段的写入（留作 follow-up，本次只 schema 预留位）
