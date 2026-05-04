# Stop Hook Ralph Loop 模式 — 项目根状态文件 + Hook 主动验证

分支：`cp-0504185237-ralph-loop-pattern`
Brain Task：`2702073b-cf9e-47c3-832d-fbe417b5d570`
日期：2026-05-04
前置：PR #2503/2745/2746/2747/2749 已合 main

## 背景

Stop Hook 修了 5 次仍不收敛。Anthropic 官方插件 [Ralph Loop](https://github.com/anthropics/claude-plugins-official/tree/main/plugins/ralph-loop) 已有正确模式。本次照搬。

## 真正的根因（5 次都没修）

| # | 故障 | 之前修了吗？|
|---|---|---|
| 1 | cwd-as-key 信号源不稳——assistant cwd 漂出 worktree（跑 git fetch / gh CLI），stop hook 看到主分支放行 | 否 |
| 2 | 状态文件主动权在 assistant 手里——`.dev-mode.<branch>` 在 worktree 根（暴露），assistant 任何时候能改字段或删 | 否 |
| 3 | 完成判定靠 `.dev-mode` 字段（`step_4_ship: done`）——assistant 改字段即可"假装完成" | 否 |

5 次 PR 都修 stop hook 内部判断逻辑，没改信号源、生命周期、完成判定这 3 个根因。

## Ralph Loop 三层防御（验证有效）

| 层 | Ralph Loop 做法 |
|---|---|
| 1. 状态信号源 | 项目根固定路径 `.claude/ralph-loop.local.md`（不依赖 cwd，藏在 `.claude/` 不显眼）|
| 2. 文件生命周期 | user 创建 / hook 修改 / hook 删除——assistant 全程不参与 |
| 3. 完成判定 | assistant 必须输出特定字符串 `<promise>COMPLETION_PROMISE</promise>`——hook 检测到才删文件 |

## 应用到 Cecelia /dev 流程

### 设计

**信号源切换**：`.dev-mode.<branch>` 在 worktree 根 → `.cecelia/dev-active.json` 在主仓库根

```json
{
  "branch": "cp-xxx",
  "worktree": "/Users/.../worktrees/cecelia/xxx",
  "started_at": "2026-05-04T18:52:00",
  "session_id": "..."
}
```

**生命周期**：
| 谁 | 动作 | 时机 |
|---|---|---|
| `engine-worktree` skill | 创建 `.cecelia/dev-active.json` | /dev 入口 |
| stop hook | 只读，不改 | 每次触发 |
| stop hook | rm 文件 | condition 5 三全满足时 |
| assistant | 完全不碰 | 全程 |

**完成判定切到 hook 主动验证**（不再读 `.dev-mode` 字段）：

```bash
# stop hook 验证三条件，每条都不依赖 .dev-mode 字段：
1. PR merged?      → gh pr view <pr> --json mergedAt（GitHub 真实状态）
2. Learning 写好?  → docs/learnings/<branch>.md 存在 + grep -q "^### 根本原因"（真有文件 + 真有内容）
3. cleanup.sh ok?  → 真跑脚本看 exit code
```

`.dev-mode` 文件**保留**作辅助元数据（branch / step_1_spec / step_2_code 等），但不再是完成信号。

### stop-dev.sh 重写（Ralph 风格）

```bash
#!/usr/bin/env bash
set -euo pipefail

# 1. bypass
[[ "${CECELIA_STOP_HOOK_BYPASS:-}" == "1" ]] && exit 0

# 2. 找主仓库根（worktree 内 git rev-parse 也能找到主仓库）
cwd="${CLAUDE_HOOK_CWD:-$PWD}"
[[ ! -d "$cwd" ]] && exit 0

# 主仓库根 = 第一个 worktree 的路径
main_repo=$(git -C "$cwd" worktree list --porcelain 2>/dev/null | head -1 | awk '/^worktree /{print $2}')
[[ -z "$main_repo" ]] && exit 0  # 不在 git 内 = 普通对话

DEV_ACTIVE="$main_repo/.cecelia/dev-active.json"

# 3. 状态文件不存在 = 不在 dev 流程
if [[ ! -f "$DEV_ACTIVE" ]]; then
    exit 0
fi

# 4. 读 dev session 信息（branch + worktree path）
branch=$(jq -r '.branch' "$DEV_ACTIVE" 2>/dev/null)
worktree_path=$(jq -r '.worktree' "$DEV_ACTIVE" 2>/dev/null)
[[ -z "$branch" || -z "$worktree_path" ]] && {
    # 状态文件损坏 → fail-closed block
    jq -n '{"decision":"block","reason":"状态文件 .cecelia/dev-active.json 损坏，无法解析。请重启 /dev 流程。"}'
    exit 0
}

# 5. hook 主动验证三完成条件
result=$(verify_dev_complete "$branch" "$worktree_path" "$main_repo")
status=$(echo "$result" | jq -r '.status')

case "$status" in
    done)
        # 三全满足 → rm 状态文件 + 允许退出
        rm -f "$DEV_ACTIVE"
        echo "$result"
        exit 0
        ;;
    *)
        # 未完成 → block + 把"继续 X 工作"指令注入回去（Ralph 模式）
        jq -n --arg r "$(echo "$result" | jq -r '.reason + "。下一步：" + .action + "。⚠️ 立即执行，禁止询问用户。禁止删除 .cecelia/dev-active.json。"')" \
            '{"decision":"block","reason":$r}'
        exit 0
        ;;
esac
```

**关键变化**：
- 出口 = `exit 0`（Ralph 风格）+ `decision:block` 回填指令——不再用 `exit 2`
- 不依赖 cwd 是否在 worktree——主仓库根状态文件优先
- assistant 删 `.dev-mode` 不影响——状态文件在 `.cecelia/`
- assistant 改 `.dev-mode` 字段不影响——hook 主动验证 PR + Learning + cleanup

### `verify_dev_complete()` 函数（替代旧 condition 5）

```bash
verify_dev_complete() {
    local branch="$1" worktree_path="$2" main_repo="$3"
    local result_json='{"status":"blocked","reason":"未知"}'

    while :; do
        # 0. 必备：harness 模式豁免（保留）
        local harness_mode="false"
        local dev_mode_file="$worktree_path/.dev-mode.$branch"
        [[ -f "$dev_mode_file" ]] && \
            harness_mode=$(grep "^harness_mode:" "$dev_mode_file" | awk '{print $2}')

        # 1. 主动验证 PR merged?
        local pr_number pr_state pr_merged_at
        pr_number=$(gh pr list --head "$branch" --state all --json number -q '.[0].number' 2>/dev/null)
        if [[ -z "$pr_number" ]]; then
            result_json='{"status":"blocked","reason":"PR 未创建","action":"立即 push + 创建 PR"}'
            break
        fi
        pr_merged_at=$(gh pr view "$pr_number" --json mergedAt -q '.mergedAt' 2>/dev/null)
        if [[ -z "$pr_merged_at" || "$pr_merged_at" == "null" ]]; then
            # PR 没合 → 看 CI 状态
            local ci_status
            ci_status=$(gh run list --branch "$branch" --limit 1 --json status -q '.[0].status' 2>/dev/null)
            case "$ci_status" in
                in_progress|queued|waiting|pending)
                    result_json='{"status":"blocked","reason":"CI 进行中","action":"等 CI 完成"}'
                    ;;
                *)
                    result_json='{"status":"blocked","reason":"PR 未合并，CI 状态:'"$ci_status"'","action":"检查 CI 失败 / 启 auto-merge"}'
                    ;;
            esac
            break
        fi

        # 2. 主动验证 Learning 文件存在 + 内容合法（harness 豁免）
        if [[ "$harness_mode" != "true" ]]; then
            local learning_file="$main_repo/docs/learnings/${branch}.md"
            if [[ ! -f "$learning_file" ]]; then
                result_json='{"status":"blocked","reason":"Learning 文件不存在: '"$learning_file"'","action":"立即写 Learning，含 ### 根本原因 + ### 下次预防"}'
                break
            fi
            if ! grep -q "^### 根本原因" "$learning_file" && ! grep -q "^## 根本原因" "$learning_file"; then
                result_json='{"status":"blocked","reason":"Learning 缺 ### 根本原因 段","action":"补全 Learning 必备段"}'
                break
            fi
        fi

        # 3. 主动跑 cleanup.sh（含部署）
        local cleanup_script=""
        for _cs in \
            "$main_repo/packages/engine/skills/dev/scripts/cleanup.sh" \
            "$HOME/.claude/skills/dev/scripts/cleanup.sh"; do
            [[ -f "$_cs" ]] && { cleanup_script="$_cs"; break; }
        done
        if [[ -z "$cleanup_script" ]]; then
            result_json='{"status":"blocked","reason":"未找到 cleanup.sh","action":"检查 packages/engine/skills/dev/scripts/cleanup.sh"}'
            break
        fi
        if ! (cd "$main_repo" && bash "$cleanup_script") 2>/dev/null; then
            result_json='{"status":"blocked","reason":"cleanup.sh 失败（部署/归档异常）","action":"重新执行 bash packages/engine/skills/dev/scripts/cleanup.sh"}'
            break
        fi

        # 三全满足 → done
        result_json='{"status":"done","reason":"PR 真完成：合并 + Learning + 部署 + 归档"}'
        break
    done

    echo "$result_json"
}
```

### `engine-worktree` skill 入口创建状态文件

修改 `packages/engine/skills/dev/scripts/worktree-manage.sh`，在 `init-or-check` 创建 worktree 后追加：

```bash
# 创建项目根状态文件（Ralph Loop 模式）
MAIN_REPO=$(git rev-parse --show-toplevel)
mkdir -p "$MAIN_REPO/.cecelia"
cat > "$MAIN_REPO/.cecelia/dev-active.json" <<EOF
{
  "branch": "$BRANCH_NAME",
  "worktree": "$WORKTREE_PATH",
  "started_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "session_id": "${CLAUDE_SESSION_ID:-}"
}
EOF
echo "✅ .cecelia/dev-active.json 已写入" >&2
```

`.gitignore` 加 `.cecelia/dev-active.json` 永远不进 git。

## 不做

- 不删 `.dev-mode.<branch>` 文件机制（保留作辅助元数据：branch / step_1_spec / step_2_code / harness_mode）
- 不动 `stop.sh` 路由层 / `stop-architect.sh` / `stop-decomp.sh`
- 不动 `cleanup.sh` / `deploy-local.sh` 内部
- 不动 harness 模式分叉（保留豁免）
- 不引入新依赖（用 jq + gh + grep）
- 不动 `devloop_check` 主函数（旧函数保留，新逻辑在 `verify_dev_complete`）

## 测试策略

按 Cecelia 测试金字塔：

- **新增 integration（5 case）**：`packages/engine/tests/integration/ralph-loop-mode.test.sh`
  - Case A：`.cecelia/dev-active.json` 不存在 → exit 0（普通对话放行）
  - Case B：状态文件存在 + cwd 在 worktree + PR 未创建 → block + reason 含"PR 未创建"
  - Case C：状态文件存在 + cwd **在主仓库**（漂出 worktree 测试）+ PR 未创建 → 仍 block（关键测试 cwd-as-key 漏洞）
  - Case D：状态文件存在 + assistant 删了 `.dev-mode.<branch>` → 仍 block（关键测试自删漏洞）
  - Case E：PR merged + Learning 存在 + cleanup ok → done + rm 状态文件

- **既有 E2E**（rigid 100% 回归）：
  - `stop-hook-full-lifecycle.test.ts` 12 场景适配新信号源
  - `stop-hook-exit-codes.test.ts` 174+ 场景（Ralph 模式 exit 0 + decision:block 替代 exit 2）
  - `dev-workflow-e2e.test.ts` Phase 7.4
  - `engine-dynamic-behavior.test.ts`

- **既有 integration**（10 case）：classify_session 8 + cleanup_done done 透传 + unborn HEAD（保留兼容路径，旧函数留作 fallback）

## 风险与缓解

| 风险 | 缓解 |
|---|---|
| Claude Code Stop Hook decision:block + exit 0 协议跟我们以前用的 exit 2 不一样，行为可能不同 | Ralph Loop 已经在 production 验证有效。严格按 Ralph 源码实现 |
| 既有 174+ stop-hook-exit-codes 测试断言 EXIT:2，新模式 EXIT:0 → 大量测试需更新 | Ralph 协议正式：decision:block + exit 0 = block，不需改测试断言（exit code 仍是 0）。但实际行为变化（block vs allow）— 测试如果断言"reason 字段含 decision:block JSON"应该仍过 |
| `git worktree list --porcelain` 第一行输出格式 | 实测：第一行总是主仓库（非 worktree）。但加 fallback：扫所有 worktree 找包含 `.cecelia/` 目录的那个 |
| 状态文件 race condition（多 dev 流程并行） | 文件名加 branch suffix：`.cecelia/dev-active-<branch>.json`，并行不冲突 |
| .gitignore 漏配 → 状态文件进 git | CI 守护：`grep -q "^.cecelia/dev-active" .gitignore` 必须满足 |

## 验收清单

- [BEHAVIOR] `.cecelia/dev-active-<branch>.json` 存在时 stop hook block，不依赖 cwd
- [BEHAVIOR] assistant 漂到主仓库 cwd 时 stop hook 仍 block（关键修复）
- [BEHAVIOR] assistant 删 `.dev-mode.<branch>` 后 stop hook 仍 block
- [BEHAVIOR] PR merged + Learning 存在 + cleanup ok → 自动 rm 状态文件 → exit 0
- [BEHAVIOR] 单条件不满足 → block + reason 明示下一步
- [BEHAVIOR] 既有 12 场景 E2E 100% 通过（适配后期望）
- [BEHAVIOR] 既有 174+ stop-hook 测试通过
- [BEHAVIOR] integration 5 个新 case 全过
- [ARTIFACT] `.gitignore` 含 `.cecelia/dev-active*`
- [ARTIFACT] Engine 版本 minor bump 18.18.1 → 18.19.0

## 实施顺序

1. integration 5 case 红灯（TDD red）
2. `engine-worktree` skill 修改：创建项目根状态文件
3. `stop-dev.sh` 重写：信号源切到 `.cecelia/dev-active-<branch>.json`
4. `verify_dev_complete()` 函数实现（hook 主动验证三条件）
5. 12 场景 E2E + 174+ stop-hook 套件回归适配
6. `.gitignore` 加 `.cecelia/dev-active*`
7. Engine 版本 bump（minor）+ feature-registry changelog
8. Learning 文件
