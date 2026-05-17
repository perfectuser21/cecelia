# Stop Hook 行为 bug 终结 — PreToolUse 拦截 ScheduleWakeup / Bash background

分支：`cp-0504204233-tool-guard`
Brain Task：`ca2a969f-baf2-4303-97dc-fb94efd4dc42`
日期：2026-05-04
前置：PR #2752 (Ralph 模式) + #2757 (测试 50 case)

## 背景

Stop Hook 7 段重构 + 50 case 测试金字塔已完成。但 Alex 抓的最深层 bug 还没修：**assistant 能主动退出 turn 让 stop hook 循环失效**。

stop hook 是被动通知机制——assistant 输出文字结束 turn → stop hook 才触发 → exit 2 + decision:block 让"下一轮"继续。但 assistant 有"主动安排退出"的工具：

- `ScheduleWakeup`：调度未来唤醒，turn 主动退出
- `Bash run_in_background:true`：命令后台跑，long-running 命令立刻让控制权返回 → turn 退出

这些工具让 assistant 直接退出 turn，stop hook 即使 block 也只让"下一轮"自动开始——而 assistant 用了 ScheduleWakeup 就**没有"下一轮"**，要等到延迟时刻才唤醒。stop hook 循环形同虚设。

memory 里早记了 `feedback_foreground_block_ci_wait.md`（手动 /dev 等 CI 必须 foreground until 阻塞）但 LLM 自觉不可靠——今天我自己又犯了 1 次（用 ScheduleWakeup 等 CI），被 Alex 抓包。

## 解法

**机器级强制**：新增 PreToolUse hook，在 `.cecelia/dev-active-*.json` 存在时（assistant 在 /dev 流程中）拦截 ScheduleWakeup 和 Bash run_in_background:true 调用。

assistant 在 dev 流程中**没有任何工具能主动让 turn 退出**——唯一让 turn 退出的路径 = stop hook 自己输出 decision:allow（PR 真完成）。

## 设计

### 文件结构

| 文件 | 操作 | 责任 |
|---|---|---|
| `hooks/dev-mode-tool-guard.sh` | 新建 | PreToolUse 拦截器：检测 dev 流程 + tool name 决定放行/拦截 |
| `~/.claude/settings.json` | 改 | PreToolUse 注册 ScheduleWakeup matcher + Bash matcher 串到 dev-mode-tool-guard.sh |
| `packages/engine/tests/integration/dev-mode-tool-guard.test.sh` | 新建 | 4 case 验证拦截行为 |

### `dev-mode-tool-guard.sh` 协议

PreToolUse hook 输入 stdin JSON 含：
- `tool_name`（如 "ScheduleWakeup"、"Bash"）
- `tool_input`（如 Bash 的 `{command, run_in_background}`）
- `cwd`、`session_id` 等

退出码语义（Claude Code 协议）：
- exit 0 = 放行
- exit 2 = block + stdout 内容回填给 assistant

```bash
#!/usr/bin/env bash
# dev-mode-tool-guard.sh — PreToolUse 拦截器
# 在 /dev 流程中（.cecelia/dev-active-*.json 存在）禁止"主动退出 turn"的工具调用

set -uo pipefail

# 读 stdin JSON
HOOK_INPUT=$(cat 2>/dev/null || echo '{}')

# 解析 tool_name + cwd
parse_field() {
    echo "$1" | grep -oE "\"$2\"\\s*:\\s*\"[^\"]*\"" | sed -E "s/.*\"$2\"\\s*:\\s*\"([^\"]*)\".*/\\1/" | head -1
}

TOOL_NAME=$(parse_field "$HOOK_INPUT" tool_name)
CWD=$(parse_field "$HOOK_INPUT" cwd)
[[ -z "$CWD" ]] && CWD="$PWD"

# 找主仓库根（git worktree list 第一行）
MAIN_REPO=$(git -C "$CWD" worktree list --porcelain 2>/dev/null | head -1 | awk '/^worktree /{print $2; exit}' || true)
[[ -z "$MAIN_REPO" ]] && exit 0  # 不在 git → 放行

# 检测 .cecelia/dev-active-* 是否存在
DEV_ACTIVE_DIR="$MAIN_REPO/.cecelia"
[[ ! -d "$DEV_ACTIVE_DIR" ]] && exit 0

DEV_ACTIVE_FOUND=false
for _f in "$DEV_ACTIVE_DIR"/dev-active-*.json; do
    [[ -f "$_f" ]] && { DEV_ACTIVE_FOUND=true; break; }
done

# 不在 dev 流程 → 放行
[[ "$DEV_ACTIVE_FOUND" != "true" ]] && exit 0

# === 在 dev 流程中 ===

# 拦截 ScheduleWakeup
if [[ "$TOOL_NAME" == "ScheduleWakeup" ]]; then
    cat <<'EOF'
{
  "decision": "block",
  "reason": "🚫 在 /dev 流程中禁止 ScheduleWakeup（让 assistant 主动退出 turn 会让 stop hook 循环形同虚设）。等 CI 必须用 foreground until 阻塞模式：until [[ $(gh pr checks <PR> | grep -cE 'pending|in_progress|queued') == 0 ]]; do sleep 60; done。或直接用 gh pr checks <PR> --watch。⚠️ 立即改为 foreground 阻塞，禁止询问用户。"
}
EOF
    exit 2
fi

# 拦截 Bash run_in_background:true
if [[ "$TOOL_NAME" == "Bash" ]]; then
    # 解析 run_in_background 字段（嵌套在 tool_input 内）
    RIB=$(echo "$HOOK_INPUT" | grep -oE '"run_in_background"\s*:\s*(true|false)' | head -1 | grep -oE '(true|false)')
    if [[ "$RIB" == "true" ]]; then
        cat <<'EOF'
{
  "decision": "block",
  "reason": "🚫 在 /dev 流程中禁止 Bash run_in_background:true（让 assistant 主动退出 turn 会让 stop hook 循环形同虚设）。改用前台 foreground 阻塞模式跑命令。如果命令需要长跑（等 CI 等），用 until 模式或 gh pr checks --watch。⚠️ 立即改为 foreground，禁止询问用户。"
}
EOF
        exit 2
    fi
fi

# 其他情况放行
exit 0
```

### settings.json 配置

加 2 个 PreToolUse matcher：

```json
{
  "PreToolUse": [
    { "matcher": "Write|Edit", "hooks": [...branch-protect...] },
    { "matcher": "Bash", "hooks": [
        {"type":"command","command":"/Users/administrator/perfect21/cecelia/hooks/bash-guard.sh"},
        {"type":"command","command":"/Users/administrator/perfect21/cecelia/hooks/dev-mode-tool-guard.sh"}
    ]},
    { "matcher": "ScheduleWakeup", "hooks": [
        {"type":"command","command":"/Users/administrator/perfect21/cecelia/hooks/dev-mode-tool-guard.sh"}
    ]}
  ]
}
```

## 不做

- 不动 stop-dev.sh / verify_dev_complete / cleanup.sh（已稳）
- 不动 stop-architect.sh / stop-decomp.sh
- 不引入新依赖
- 不重新设计 Ralph 模式协议
- 不拦截其他 tool（只拦 ScheduleWakeup + Bash background）

## 测试策略

按 Cecelia 测试金字塔：

- **integration（4 case，跨脚本+ env）**：`packages/engine/tests/integration/dev-mode-tool-guard.test.sh`
  - Case A：无 .cecelia/dev-active → ScheduleWakeup 调用放行（exit 0）
  - Case B：.cecelia/dev-active 存在 → ScheduleWakeup 被拦（exit 2 + reason）
  - Case C：.cecelia/dev-active 存在 + Bash run_in_background:true → 被拦
  - Case D：.cecelia/dev-active 存在 + Bash run_in_background:false → 放行

- **既有测试**：50 case 测试金字塔不退化

## 风险与缓解

| 风险 | 缓解 |
|---|---|
| settings.json 改动影响所有 Claude session | settings.json 是 user-level 配置，dev-mode-tool-guard 仅在 .cecelia/dev-active-* 存在时才拦截，对非 dev 流程无影响 |
| ScheduleWakeup matcher 名字 case 敏感 | matcher 用精确字符串 "ScheduleWakeup"，Claude Code 协议确认大小写匹配 |
| stdin JSON 解析用 grep+sed 不严谨 | 关键字段 tool_name / cwd / run_in_background 都是固定结构，简单 grep 足够；测试覆盖各种 JSON 格式 |
| Bash 调用极频繁，hook 性能影响 | hook 极简（git worktree list + ls 状态文件），毫秒级返回 |
| dev-mode-tool-guard.sh 自身 bug → 锁死所有 Bash | bash-guard.sh 在 dev-mode-tool-guard 之前跑（chain order），一旦 dev-mode-tool-guard 崩可手动改 settings.json 删 |

## 验收清单

- [BEHAVIOR] `hooks/dev-mode-tool-guard.sh` 创建且 chmod +x
- [BEHAVIOR] `~/.claude/settings.json` PreToolUse 注册 2 个 matcher
- [BEHAVIOR] 在 .cecelia/dev-active-* 存在时 ScheduleWakeup 调用被拦（exit 2 + reason 含"foreground"）
- [BEHAVIOR] 在 .cecelia/dev-active-* 存在时 Bash run_in_background:true 被拦
- [BEHAVIOR] 不在 dev 流程时 ScheduleWakeup / Bash background 都放行
- [BEHAVIOR] integration 4 case 全过
- [BEHAVIOR] 既有 50 case 测试不退化
- [ARTIFACT] Engine 版本 patch bump 18.19.1 → 18.19.2

## 实施顺序

1. integration 4 case TDD red
2. 实现 hooks/dev-mode-tool-guard.sh + 注册 settings.json → green
3. 既有测试套回归
4. 版本 bump + changelog
5. Learning + commit + push + engine-ship
