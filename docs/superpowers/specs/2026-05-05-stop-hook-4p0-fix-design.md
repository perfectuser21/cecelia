# Stop Hook 4 个 P0 彻底修复 — Design Spec

> 分支: cp-0505144146-stop-hook-4p0-fix
> 日期: 2026-05-05
> 前置 PR: #2766/#2767/#2770
> Notion contract: https://www.notion.so/35753f413ec581d9b607f61e4e90ce0b
> 本 PR: 第 12 段 — 4 个 P0 一次性修

## 1. 背景

Notion contract 记录的 4 个 P0 bug 在 5/5 12:55 实战触发死锁：
- BUG-1（multi-worktree 字典序混淆）+ BUG-4（P5/P6 fail 永久 stuck）叠加
- session 86197599 + session 2975ecd2 同时被 stop hook 锁死
- 死锁持续 4+ 轮反馈循环，靠手动 rm dev-active 解开

一次性修 4 个 P0，避免下次再死锁。

## 2. 设计目标

```
BUG-1 cwd-as-key 真匹配  → 多 worktree 不混淆
BUG-2 --workflow CI 过滤 → 不被 DeepSeek 等小 workflow 误判
BUG-3 PreToolUse 进 repo  → 远端 worker 也受拦
BUG-4 P5/P6 escape window → deploy/health fail 不永久 stuck
```

## 3. 架构

### 3.1 BUG-1 修复（stop-dev.sh ghost loop 替换）

`packages/engine/hooks/stop-dev.sh:38-62` 当前字典序遍历改 cwd 路由：

```bash
# 当前 cwd 解析 worktree branch
current_branch=$(git -C "$cwd" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")

# 不管哪种情况都先扫一遍清 ghost + mtime expire（BUG-4 顺手做）
EXPIRE_MINUTES="${STOP_HOOK_EXPIRE_MINUTES:-30}"
now_epoch=$(date +%s)
for _f in "$dev_state_dir"/dev-active-*.json; do
    [[ -f "$_f" ]] || continue
    sid=$(jq -r '.session_id // ""' "$_f" 2>/dev/null || echo "")
    # ghost (session_id=unknown) 自动 rm
    if [[ "$sid" == "unknown" ]]; then
        echo "[stop-dev] ghost rm: $_f (sid=unknown)" >&2
        rm -f "$_f"; continue
    fi
    # BUG-4: mtime > N 分钟自动 expire
    file_mtime=$(stat -f %m "$_f" 2>/dev/null || stat -c %Y "$_f" 2>/dev/null || echo "$now_epoch")
    age_min=$(( (now_epoch - file_mtime) / 60 ))
    if [[ "$age_min" -gt "$EXPIRE_MINUTES" ]]; then
        echo "[stop-dev] expired rm: $_f (age=${age_min}m > ${EXPIRE_MINUTES}m)" >&2
        rm -f "$_f"; continue
    fi
done

# cwd 路由选 dev_state
case "$current_branch" in
    cp-*)
        dev_state="$dev_state_dir/dev-active-${current_branch}.json"
        [[ -f "$dev_state" ]] || exit 0  # 当前 branch 没 dev-active = 不在 dev 流程
        ;;
    *)  # 主分支或非 cp-* → 不归本 session 管
        exit 0
        ;;
esac
```

### 3.2 BUG-2 修复（devloop-check.sh `--workflow CI` 过滤）

`packages/engine/lib/devloop-check.sh` 多处 `gh run list --branch` 改加 `--workflow CI`（GitHub Actions workflow 文件名 / display name）：

```bash
# 改前（line 234, 235, 236, 638, ...）：
gh run list --branch "$branch" --limit 1 --json status -q '.[0].status'

# 改后：
gh run list --branch "$branch" --workflow CI --limit 1 --json status -q '.[0].status'
```

P5 的 deploy workflow 已经显式 `--workflow brain-ci-deploy.yml`，OK。本次只改 P2/P3/P4 的主 CI 查询。

### 3.3 BUG-3 修复（PreToolUse 进 repo）

调研 CC 是否支持 repo 级 `.claude/settings.json`：
- 如果支持 → 把 PreToolUse 注册写进 repo 的 `.claude/settings.json`
- 如果不支持 → setup script `scripts/install-claude-settings.sh` 让用户/远端 worker 自动 install

按 Claude Code 文档（https://docs.claude.com/en/docs/claude-code/settings），CC 支持三层配置：
- 用户 `~/.claude/settings.json`
- 项目 `.claude/settings.json`（**纳入 git**）
- 项目本地 `.claude/settings.local.json`（不入 git）

✅ **支持 repo 级**。修法：

`/Users/administrator/worktrees/cecelia/stop-hook-4p0-fix/.claude/settings.json`：

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "ScheduleWakeup",
        "hooks": [
          {
            "type": "command",
            "command": "bash $CLAUDE_PROJECT_DIR/packages/engine/hooks/dev-mode-tool-guard.sh"
          }
        ]
      },
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "bash $CLAUDE_PROJECT_DIR/packages/engine/hooks/dev-mode-tool-guard.sh"
          }
        ]
      }
    ]
  }
}
```

注：`$CLAUDE_PROJECT_DIR` 是 CC 的 env 变量。如果不存在，dev-mode-tool-guard.sh 内部已有 fallback 找 main_repo。

合并到 main 后，每个 git clone 该 repo 的 CC 实例自动激活 PreToolUse 拦截。

### 3.4 BUG-4 修复（P5 fail counter）

devloop-check.sh 在 P5 fail 时记录到 `.cecelia/deploy-fail-count-<branch>`：

```bash
# P5 deploy fail 分支
if [[ "$deploy_conclusion" != "success" ]]; then
    fail_count_file="$main_repo/.cecelia/deploy-fail-count-${branch}"
    fail_count=$(cat "$fail_count_file" 2>/dev/null || echo 0)
    fail_count=$((fail_count + 1))
    echo "$fail_count" > "$fail_count_file"
    if [[ "$fail_count" -ge 3 ]]; then
        # 3 次连续看到同一 deploy run conclusion=failure → 自动 rm dev-active
        rm -f "$main_repo/.cecelia/dev-active-${branch}.json"
        rm -f "$fail_count_file"
        echo "$main_repo" > "$main_repo/.cecelia/deploy-failed-${branch}.flag"
        result_json='{"status":"done","reason":"deploy fail 3x → auto-expire dev-active，等独立 PR 修 deploy"}'
        break
    fi
    result_json=...
fi
# success 分支清掉 fail counter
rm -f "$main_repo/.cecelia/deploy-fail-count-${branch}"
```

mtime expire（A）已在 BUG-1 修复里顺手做。

### 3.5 invariant L11/L12 加到 integrity 元测试

`packages/engine/tests/integrity/stop-hook-coverage.test.sh` 加：
- L11: stop-dev.sh 含 mtime expire 逻辑（grep `EXPIRE_MINUTES\|file_mtime`）
- L12: stop-dev.sh 含 cwd 路由（grep `current_branch.*rev-parse\|case.*cp-\*`）
- L13: devloop-check.sh 所有 `gh run list --branch` 必须配 `--workflow CI`（grep negate）
- L14: `.claude/settings.json` 在 repo（test -f）

## 4. 错误处理

- BUG-1 cwd 路由：cp-* branch 但 dev-active 不存在 → exit 0（合法 — 不在 /dev 流程）
- BUG-1 主分支 cwd → exit 0 不归本 session 管（但仍清 ghost + mtime expire）
- BUG-2 `gh run list --workflow CI` 取不到 run（CI 没起）→ ci_status="unknown" → 走原有"未知"分支
- BUG-4 mtime expire 边界：30 分钟阈值 env 可调（`STOP_HOOK_EXPIRE_MINUTES`）
- BUG-4 fail counter 文件读写失败 → fail-open 不增加（保守，不误删 dev-active）

## 5. 测试策略

按 Cecelia 测试金字塔四档：

| 类型 | 文件 | 覆盖 |
|---|---|---|
| **Unit** | `tests/unit/verify-dev-complete.test.sh`（扩 27→30 case）| BUG-2 P4 误判（DeepSeek conclusion=success + 主 CI=in_progress 反馈"等 CI"），BUG-4 P5 fail counter 累积 |
| **Integration** | `tests/integration/stop-dev-multi-worktree.test.sh`（新建 6 case）| BUG-1：3 个 dev-active，session A/B/C cwd 各自触发只 verify 自己的 |
| **Integration** | `tests/integration/stop-dev-deploy-escape.test.sh`（新建 4 case）| BUG-4：mtime > 30 分钟自动 expire；连续 3 次 P5 fail 自动 rm dev-active + 写 flag |
| **Integrity** | `tests/integrity/stop-hook-coverage.test.sh`（扩 11→15 case）| L11/L12/L13/L14 grep 验证 |
| **Smoke** | `scripts/smoke/stop-hook-7stage-smoke.sh`（扩 step）| .claude/settings.json 存在 + 内容含 PreToolUse 注册 |
| **E2E** | `tests/e2e/stop-hook-full-lifecycle.test.ts`（不动）| 现有 12 场景仍过 |

**TDD 顺序**：每 task commit-1 fail test / commit-2 impl。

## 6. 关键文件清单

| 文件 | 改动 |
|---|---|
| `packages/engine/hooks/stop-dev.sh` | BUG-1 cwd 路由 + BUG-4 mtime expire |
| `packages/engine/lib/devloop-check.sh` | BUG-2 `--workflow CI` 多处 + BUG-4 P5 fail counter |
| `.claude/settings.json` | 新建（BUG-3 PreToolUse repo 级注册）|
| `packages/engine/tests/unit/verify-dev-complete.test.sh` | 扩 27→30 case |
| `packages/engine/tests/integration/stop-dev-multi-worktree.test.sh` | 新建 6 case |
| `packages/engine/tests/integration/stop-dev-deploy-escape.test.sh` | 新建 4 case |
| `packages/engine/tests/integrity/stop-hook-coverage.test.sh` | 扩 11→15 case |
| `packages/engine/scripts/smoke/stop-hook-7stage-smoke.sh` | 加 .claude/settings.json 验证 step |
| `.github/workflows/ci.yml` engine-tests-shell | 加新 .test.sh 到显式列表 |
| 8 处版本文件 | 18.21.0 → 18.22.0（minor）|
| `docs/learnings/cp-0505144146-stop-hook-4p0-fix.md` | Learning |

## 7. Out of Scope

- 不动 verify_dev_complete 7 阶段决策树本身（PR #2766 已锁）
- 不动 Ralph Loop 入口锁（PR #2752 已锁）
- 不修 brain deploy-local.sh exit 127（你那边 brain deploy fix 独立 PR）
- 不修 devloop-classify.test.sh CI Linux fail（留下个 PR）
- 不切 engine-tests-shell job 显式列表 → glob（留下个 PR，先把新 .test.sh 加到列表）

## 8. 完成定义

- 30 unit case + 6 multi-worktree + 4 deploy-escape + 15 integrity + 现有套全过
- engine-tests-shell job 含新加的 stop-dev-multi-worktree + stop-dev-deploy-escape
- `.claude/settings.json` 在 repo + 含 PreToolUse 注册
- engine 8 处版本 18.22.0
- Notion contract 4 BUG 标 ✅ resolved，invariant 11→15
- Learning 含 ### 根本原因 + ### 下次预防

## 9. 自我闭环

本 PR 修 BUG-4 后自己合并时：
- 假设 brain deploy 仍 exit 127（你那边的 fix 还没出）
- 本 PR 走完 P5 deploy fail 3 次 → 自动 expire dev-active + 写 flag
- stop hook 真"自我证明" — BUG-4 修复有效，本 PR 不会因为不相关的 brain deploy fail 卡死

如果你的 brain deploy 修了 → 本 PR P5 success → 走 P6/P7/P0 done。两种路径都能合。
