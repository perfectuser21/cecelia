# Stop Hook 真完成语义闭环 — PR merged + step_4 done + cleanup ok

分支：`cp-0504181719-true-done-semantics`
Brain Task：`f7aabf84-6851-48be-90b6-3b5c7bf2b5de`
日期：2026-05-04
前置：PR #2745+#2746+#2747（cwd-as-key + 散点收敛 + fail-closed + 三态出口）

## 背景

PR #2747 完成出口拓扑严格三态分离。但 `devloop_check` condition 5（PR merged 后）有 bug：fallback 路径在 step_4_ship=pending 时跑 cleanup.sh 成功就标 status=done。

故障还原（Alex 描述的"PR 一开就停"）：
1. assistant push + 创建 PR + 开 auto-merge
2. CI 极快通过 → GitHub 自动合并
3. step_4_ship 仍 pending（Learning 没写）
4. 下次 stop hook → condition 3 看到 PR state=merged → 进 condition 5
5. step_4 pending → 不进第一个 if → 进 cleanup.sh fallback
6. cleanup.sh 跑成功 → status=done → exit 0 → assistant 真停 ✗

违反 Alex 字面要求：**PR 真合 + Learning 写好 + 部署完成 三者全满足才是真 exit 0**。

## 目标

condition 5 改为严格守门：**PR merged + step_4=done + cleanup.sh 成功**三者全满足才 status=done。

| 组合 | 当前 | 修复后 |
|---|---|---|
| PR merged + step_4=done + cleanup ok | done ✓ | done（**必须**真跑 cleanup.sh）|
| PR merged + step_4=done + cleanup fail | done（_mark_cleanup_done 但跳过 cleanup.sh）✗ | blocked |
| **PR merged + step_4=pending + cleanup ok** | **done ✗（bug）** | **blocked ✓** |
| PR merged + step_4=pending + cleanup fail | blocked ✓ | blocked ✓ |
| PR merged + harness | done ✓ | done（豁免 step_4 检查保留）|

## 不做

- 不动 stop-dev.sh / stop.sh / 出口拓扑（PR #2747 已对）
- 不动 condition 6 自动合并逻辑（自带 step_4 检查）
- 不动 cleanup.sh 内部（含部署）
- 不动 harness 模式 step_4 豁免
- 不动 .dev-mode 字段、worktree-manage.sh
- 不引入新依赖

## 设计

### condition 5 重写（PR merged 路径）

```bash
if [[ "$pr_state" == "merged" ]]; then
    # 5.1 base ref 必须是 main
    local pr_base_ref=""
    [[ -n "$pr_number" ]] && \
        pr_base_ref=$(gh pr view "$pr_number" --json baseRefName -q '.baseRefName' 2>/dev/null || echo "")
    if [[ -n "$pr_base_ref" && "$pr_base_ref" != "main" ]]; then
        result_json=$(_devloop_jq -n --arg base "$pr_base_ref" \
            '{"status":"blocked","reason":"PR 已合并但目标分支不是 main（目标：\($base)）","action":"检查是否误合并到错误分支"}')
        break
    fi

    # 5.2 step_4_ship 必须 done（除 harness 模式）— 严格守门
    local step_4_status
    step_4_status=$(_get_step4_status "$dev_mode_file")
    if [[ "$step_4_status" != "done" ]] && [[ "$_harness_mode" != "true" ]]; then
        result_json=$(_devloop_jq -n --arg pr "$pr_number" \
            '{"status":"blocked","reason":"PR #\($pr) 已合并，但 Stage 4 Ship 未完成（必须先写 docs/learnings/<branch>.md 并标记 step_4_ship: done）","action":"立即读取 skills/dev/steps/04-ship.md 完成 Stage 4，禁止询问用户。"}')
        break
    fi

    # 5.3 找 cleanup.sh
    local _cleanup_script=""
    for _cs in \
        "${PROJECT_ROOT:-}/packages/engine/skills/dev/scripts/cleanup.sh" \
        "$HOME/.claude/skills/dev/scripts/cleanup.sh" \
        "$HOME/.claude-account1/skills/dev/scripts/cleanup.sh"; do
        [[ -f "$_cs" ]] && { _cleanup_script="$_cs"; break; }
    done
    if [[ -z "$_cleanup_script" ]]; then
        result_json=$(_devloop_jq -n --arg pr "$pr_number" \
            '{"status":"blocked","reason":"PR #\($pr) 已合并 + Stage 4 done，但未找到 cleanup.sh（无法部署/归档）","action":"检查 packages/engine/skills/dev/scripts/cleanup.sh 是否存在"}')
        break
    fi

    # 5.4 跑 cleanup.sh（含部署）— 必须成功才允许 done
    echo "🧹 自动执行 cleanup.sh（含部署）..." >&2
    if (cd "$(git rev-parse --show-toplevel 2>/dev/null || pwd)" && bash "$_cleanup_script") 2>/dev/null; then
        _mark_cleanup_done "$dev_mode_file"
        result_json=$(_devloop_jq -n --arg pr "$pr_number" \
            '{"status":"done","reason":"PR #\($pr) 真完成：合并 + Learning + 部署 + 归档"}')
    else
        result_json=$(_devloop_jq -n --arg pr "$pr_number" \
            '{"status":"blocked","reason":"PR #\($pr) 已合并 + Stage 4 done，但 cleanup.sh 失败（部署/归档异常）","action":"重新执行 bash packages/engine/skills/dev/scripts/cleanup.sh，或检查 deploy-local.sh"}')
    fi
    break
fi
```

### 关键变更

| 改动 | 之前 | 之后 |
|---|---|---|
| step_4=done + 早退 | `_mark_cleanup_done + status=done`（**跳过 cleanup.sh / 部署**）| `_mark_cleanup_done + 跑 cleanup.sh + status=done`（**必须真跑**）|
| step_4=pending + cleanup ok | status=done（**bug**）| status=blocked（守门）|
| step_4=pending + cleanup fail | status=blocked | status=blocked（同前）|
| step_4=done + cleanup fail | status=blocked（fallback）| status=blocked（同前）|

**核心**：`status=done` 唯一路径 = `step_4=done` AND `cleanup.sh 成功`（含部署）。

### condition 0.1 cleanup_done 残留早退（保留）

cleanup_done 标志位现在只能由 `_mark_cleanup_done` 在 condition 5/6 真完成时写入。意味着 cleanup_done=true 必然意味着 PR merged + step_4 done + cleanup ok 三者已满足。所以 condition 0.1 保留 status=done 是安全的（避免重复跑 cleanup.sh）。

但要审计：是否有别的地方写 cleanup_done? 如果有，需要验证写入时机。

## 测试策略

按 Cecelia 测试金字塔：

- **integration（新增 4 case）**：`packages/engine/tests/integration/devloop-classify.test.sh` 扩展：
  - Case 11：PR merged + step_4=pending → blocked（reason 含 "Stage 4 Ship 未完成"）
  - Case 12：PR merged + step_4=done + 无 cleanup.sh → blocked（reason 含 "未找到 cleanup.sh"）
  - Case 13：PR merged + step_4=done + cleanup.sh 失败 → blocked（mock cleanup.sh exit 非 0）
  - Case 14：PR merged + step_4=done + cleanup.sh 成功 → done

- **既有 E2E（行为验证）**：12 场景 stop-hook-full-lifecycle 100% 回归。其中"PR merged + cleanup_done=true 残留"场景（条件 0.1 早退）必须通过——验证 cleanup_done 残留只在合法情况下被使用。

- **既有 stop-hook 测试**：174+ stop-hook-exit-codes / stop-hook-session-isolation / dev-workflow-e2e 100% 回归。

- **CI 守护**：check-single-exit.sh 不需更新（出口拓扑未变）。

## 风险与缓解

| 风险 | 缓解 |
|---|---|
| 既有 PR 合并后某个 stop hook 第一次跑时 step_4 还没 done（用户还在写 Learning），现在被 block，跟之前 fallback 行为不一致 | 这正是修复的初衷——assistant 不该提前真停，应该继续写 Learning。block 时 reason 明示"立即读取 skills/dev/steps/04-ship.md" |
| 现有 PR 已经 cleanup_done=true 的状态会进入 condition 0.1 早退，跳过新逻辑 | 不影响——这些 cleanup_done 是过往真完成时写的，残留 done 是对的 |
| cleanup.sh 跑得慢（含部署）→ stop hook 触发频繁地跑同一个 cleanup.sh | _mark_cleanup_done 后 condition 0.1 直接 done，cleanup.sh 只跑一次 |
| 测试 mock cleanup.sh 失败困难 | integration test 用临时 cleanup.sh 路径（写假脚本 exit 0/exit 1） |

## 验收清单

- [BEHAVIOR] condition 5 中 status=done 的唯一路径需要 step_4=done AND cleanup.sh 成功（除 harness）
- [BEHAVIOR] PR merged + step_4=pending → status=blocked（reason 含 "Stage 4 Ship 未完成"）
- [BEHAVIOR] PR merged + step_4=done + cleanup fail → status=blocked
- [BEHAVIOR] PR merged + step_4=done + cleanup ok → status=done
- [BEHAVIOR] 既有 12 场景 E2E 100% 通过
- [BEHAVIOR] 既有 174+ stop-hook 测试通过
- [BEHAVIOR] integration 4 个新 case 通过
- [ARTIFACT] Engine 版本 bump 18.18.0 → 18.18.1（patch，行为级精修）

## 实施顺序

1. integration test 4 case 红灯（TDD red）
2. condition 5 重写（TDD green）
3. 既有 12 场景 E2E + 174+ stop-hook 全量回归
4. Engine 版本 bump（patch）
5. feature-registry.yml 加 18.18.1 changelog
6. Learning 文件
