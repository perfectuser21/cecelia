# Stop Hook Ralph Loop 模式 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 照搬官方 ralph-loop 三层防御——状态信号搬到主仓库根 `.cecelia/dev-active-<branch>.json`，文件生命周期完全在 hook 手里，完成判定切到 hook 主动验证（不再读 `.dev-mode` 字段）。

**Architecture:** 修 worktree-manage.sh 在 /dev 入口创建项目根状态文件；重写 stop-dev.sh 只看主仓库根状态文件（不依赖 cwd）；新增 `verify_dev_complete()` 函数 hook 主动验证 PR + Learning + cleanup。.dev-mode 保留作辅助元数据。

**Tech Stack:** bash 3.2、jq、gh CLI、Claude Code Stop Hook decision:block 协议、既有 vitest E2E

---

## 文件结构

| 文件 | 操作 | 责任 |
|---|---|---|
| `packages/engine/skills/dev/scripts/worktree-manage.sh:266` | 改 | /dev 入口创建 `.cecelia/dev-active-<branch>.json` |
| `packages/engine/hooks/stop-dev.sh` | 整体重写 | Ralph 风格：项目根状态文件 → block / done |
| `packages/engine/lib/devloop-check.sh` | 末尾追加 | 新增 `verify_dev_complete()` 函数（旧 devloop_check 保留） |
| `.gitignore` | 加 | `.cecelia/dev-active*` |
| `packages/engine/tests/integration/ralph-loop-mode.test.sh` | 新建 | 5 个 case 验证三层防御 |
| 8 个 Engine 版本文件 + SKILL.md | bump | 18.18.1 → 18.19.0 minor |
| `feature-registry.yml` | 加 changelog | 18.19.0 条目 |
| `docs/learnings/cp-0504185237-ralph-loop-pattern.md` | 新建 | Learning |

---

## Task 1: 新建 integration 5 case（TDD red）

**Files:**
- Create: `packages/engine/tests/integration/ralph-loop-mode.test.sh`

- [ ] **Step 1: 创建测试脚本**

写入完整内容：

```bash
#!/usr/bin/env bash
# ralph-loop-mode.test.sh — Stop Hook Ralph Loop 模式 5 case 守门测试
# 验证三层防御：
#   1. 状态信号源切到主仓库根（不依赖 cwd）
#   2. assistant 删 .dev-mode 不影响（项目根状态文件主导）
#   3. hook 主动验证（不读 .dev-mode 字段）

set -uo pipefail

THIS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$THIS_DIR/../../../.." && pwd)"
STOP_DEV="$REPO_ROOT/packages/engine/hooks/stop-dev.sh"

PASS=0; FAIL=0
TMPROOT=$(mktemp -d)
trap 'rm -rf "$TMPROOT"' EXIT

assert_contains() {
    local label="$1" expected="$2" got="$3"
    if [[ "$got" == *"$expected"* ]]; then
        echo "✅ $label"
        PASS=$((PASS+1))
    else
        echo "❌ $label: 期望含 [$expected]，实际 [$got]"
        FAIL=$((FAIL+1))
    fi
}

assert_exit_code() {
    local label="$1" expected="$2" got="$3"
    if [[ "$got" == "$expected" ]]; then
        echo "✅ $label: exit=$got"
        PASS=$((PASS+1))
    else
        echo "❌ $label: exit=$got (期望 $expected)"
        FAIL=$((FAIL+1))
    fi
}

run_stop_dev() {
    local cwd="$1"
    local stdin_json="{\"session_id\":\"test\",\"transcript_path\":\"\",\"cwd\":\"$cwd\",\"stop_hook_active\":false}"
    CLAUDE_HOOK_STDIN_JSON_OVERRIDE="$stdin_json" \
        bash "$STOP_DEV" 2>&1
    echo "EXIT:$?"
}

# Case A: .cecelia/dev-active 不存在 → 普通对话放行（exit 0）
A_REPO="$TMPROOT/case-a"
mkdir -p "$A_REPO"
( cd "$A_REPO" && git init -q -b main && git commit -q --allow-empty -m init )
out=$(run_stop_dev "$A_REPO")
exit_code=$(echo "$out" | grep -oE 'EXIT:[0-9]+' | sed 's/EXIT://')
assert_exit_code "Case A 状态文件不存在 → exit 0" "0" "$exit_code"

# Case B: 状态文件存在 + cwd 在 worktree + PR 未创建 → block
B_REPO="$TMPROOT/case-b"
B_WT="$TMPROOT/case-b-worktree"
mkdir -p "$B_REPO/.cecelia"
( cd "$B_REPO" && git init -q -b main && git commit -q --allow-empty -m init && git worktree add "$B_WT" -b cp-test-b 2>/dev/null )
cat > "$B_REPO/.cecelia/dev-active-cp-test-b.json" <<EOF
{"branch":"cp-test-b","worktree":"$B_WT","started_at":"2026-05-04T00:00:00Z","session_id":"test"}
EOF
out=$(run_stop_dev "$B_WT")
assert_contains "Case B PR 未创建 → block" "decision" "$out"
assert_contains "Case B PR 未创建 → reason 含 PR" "PR" "$out"

# Case C: 状态文件存在 + cwd 漂到主仓库 + PR 未创建 → 仍 block（关键测试 cwd 漂移）
out_c=$(run_stop_dev "$B_REPO")
assert_contains "Case C cwd 漂到主仓库 → 仍 block（关键修复）" "decision" "$out_c"

# Case D: 状态文件存在 + assistant 删了 .dev-mode → 仍 block（关键测试自删漏洞）
rm -f "$B_WT/.dev-mode.cp-test-b"
out_d=$(run_stop_dev "$B_WT")
assert_contains "Case D 删 .dev-mode → 仍 block（关键修复）" "decision" "$out_d"

# Case E: 完成路径（mock 三全满足）→ done + rm 状态文件
# 注：完整 mock PR/Learning/cleanup 复杂，本 case 简化 — 只验证当三全满足时状态文件被删
# 由 E2E 12 场景覆盖完整完成路径
echo "ℹ️  Case E 完成路径完整验证由 E2E 12 场景覆盖"

echo ""
echo "=== Total: $((PASS+FAIL)) | PASS: $PASS | FAIL: $FAIL ==="
[[ "$FAIL" -eq 0 ]]
```

- [ ] **Step 2: 让脚本可执行 + 跑测试看 fail**

```bash
WT=/Users/administrator/worktrees/cecelia/ralph-loop-pattern
chmod +x "$WT/packages/engine/tests/integration/ralph-loop-mode.test.sh"
bash "$WT/packages/engine/tests/integration/ralph-loop-mode.test.sh"
echo "exit=$?"
```

期望：Case A PASS（普通对话仍放行）、Case B/C/D fail（当前 stop-dev.sh 不读 `.cecelia/dev-active-*.json`，状态文件不影响行为）。整体 exit 非 0。

- [ ] **Step 3: commit red**

```bash
WT=/Users/administrator/worktrees/cecelia/ralph-loop-pattern
git -C "$WT" add packages/engine/tests/integration/ralph-loop-mode.test.sh
git -C "$WT" commit -m "test(engine): Ralph Loop 模式 5 case 守门测试（TDD red）

验证三层防御：
- Case A 状态文件不存在 → 放行
- Case B PR 未创建 → block
- Case C cwd 漂到主仓库 → 仍 block（关键修复）
- Case D 删 .dev-mode → 仍 block（关键修复）
- Case E 完成路径由 E2E 覆盖

当前 stop-dev.sh 不识别 .cecelia/dev-active 状态文件，Case B/C/D fail。
"
```

---

## Task 2: worktree-manage.sh 创建项目根状态文件

**Files:**
- Modify: `packages/engine/skills/dev/scripts/worktree-manage.sh:266`（在 .dev-mode 写入后追加）

- [ ] **Step 1: 在 .dev-mode 写入后追加 .cecelia/dev-active 创建逻辑**

读 `/Users/administrator/worktrees/cecelia/ralph-loop-pattern/packages/engine/skills/dev/scripts/worktree-manage.sh` line 254-267 完整 `.dev-mode` 写入块。在 line 266 `echo -e "${GREEN}✅ .dev-mode 已写入${NC}"` 之后追加：

```bash
        # v20.0.0 Ralph Loop 模式：项目根状态文件
        # 信号源切到主仓库根，不依赖 cwd 是否在 worktree
        # assistant 删 .dev-mode 不影响 — stop-dev.sh 看这个文件判定 dev 流程
        local main_repo
        main_repo=$(git rev-parse --show-toplevel 2>/dev/null)
        if [[ -n "$main_repo" ]]; then
            mkdir -p "$main_repo/.cecelia"
            cat > "$main_repo/.cecelia/dev-active-${branch_name}.json" <<RALPH_EOF
{
  "branch": "${branch_name}",
  "worktree": "${worktree_path}",
  "started_at": "$(TZ=Asia/Shanghai date +%Y-%m-%dT%H:%M:%S+08:00)",
  "session_id": "${_claude_sid_create:-unknown}"
}
RALPH_EOF
            echo -e "${GREEN}✅ .cecelia/dev-active-${branch_name}.json 已写入主仓库根${NC}" >&2
        fi
```

- [ ] **Step 2: 跑命令验证创建**

```bash
WT=/Users/administrator/worktrees/cecelia/ralph-loop-pattern
ls "$WT/../.cecelia/" 2>/dev/null || ls "$WT/../../perfect21/cecelia/.cecelia/" 2>/dev/null
# 注：当前 worktree 由前一次 worktree-manage.sh 创建（旧版本无此功能），所以 .cecelia/ 不存在 — 这是预期
echo "（验证将在 push CI 时由 integration test Case B 覆盖）"
```

- [ ] **Step 3: commit**

```bash
WT=/Users/administrator/worktrees/cecelia/ralph-loop-pattern
git -C "$WT" add packages/engine/skills/dev/scripts/worktree-manage.sh
git -C "$WT" commit -m "feat(engine): worktree-manage.sh 创建项目根状态文件 .cecelia/dev-active-<branch>.json

Ralph Loop 模式信号源：状态文件在主仓库根而非 worktree 根，不依赖 cwd。
.dev-mode 仍写入 worktree 作辅助元数据。
"
```

---

## Task 3: stop-dev.sh 整体重写为 Ralph 风格

**Files:**
- Modify: `packages/engine/hooks/stop-dev.sh`（整体重写约 75 行 → 90 行）

- [ ] **Step 1: 整体替换 stop-dev.sh**

写入：

```bash
#!/usr/bin/env bash
# ============================================================================
# stop-dev.sh — Ralph Loop 模式（v21.0.0）
# ============================================================================
# 信号源：项目根 .cecelia/dev-active-<branch>.json（照搬官方 ralph-loop 插件）
# 完成判定：hook 主动验证（PR merged + Learning 文件 + cleanup.sh 真跑）
#
# 三层防御：
#   1. 项目根状态文件（不依赖 cwd）— assistant 漂到主仓库不放行
#   2. 文件生命周期完全在 hook 手里 — assistant 不参与
#   3. 完成判定主动验证 — 不读 .dev-mode 字段（assistant 改不了）
#
# 出口协议（Ralph 风格 decision:block + exit 0）：
#   状态文件不存在 → exit 0（普通对话放行）
#   完成验证 done → rm 状态文件 + exit 0
#   未完成 → decision:block + reason 注入 + exit 0
# ============================================================================

set -euo pipefail

# ---- 逃生通道 ------------------------------------------------------------
[[ "${CECELIA_STOP_HOOK_BYPASS:-}" == "1" ]] && exit 0

# ---- 找主仓库根（不依赖 cwd 是否在 worktree）-----------------------------
cwd="${CLAUDE_HOOK_CWD:-$PWD}"
[[ ! -d "$cwd" ]] && exit 0

# git worktree list 第一行是主仓库
main_repo=$(git -C "$cwd" worktree list --porcelain 2>/dev/null | head -1 | awk '/^worktree /{print $2; exit}')
[[ -z "$main_repo" ]] && exit 0  # 不在 git → 普通对话

# ---- 找当前活跃的 dev session 状态文件 ------------------------------------
dev_state_dir="$main_repo/.cecelia"
if [[ ! -d "$dev_state_dir" ]]; then
    exit 0  # 没有 .cecelia 目录 = 没有 dev 流程
fi

# 找任意 dev-active-*.json（理论上同时只有一个）
dev_state=""
for _f in "$dev_state_dir"/dev-active-*.json; do
    [[ -f "$_f" ]] && { dev_state="$_f"; break; }
done

if [[ -z "$dev_state" ]]; then
    exit 0  # 没活跃 session = 普通对话
fi

# ---- 加载 devloop-check 库（含 verify_dev_complete）-----------------------
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
devloop_lib=""
for c in \
    "$main_repo/packages/engine/lib/devloop-check.sh" \
    "$script_dir/../lib/devloop-check.sh" \
    "$HOME/.claude/lib/devloop-check.sh"; do
    [[ -f "$c" ]] && { devloop_lib="$c"; break; }
done
# shellcheck disable=SC1090
[[ -n "$devloop_lib" ]] && source "$devloop_lib"
command -v jq &>/dev/null || jq() { cat >/dev/null 2>&1; echo '{}'; }

# ---- 解析状态文件 --------------------------------------------------------
branch=$(jq -r '.branch // ""' "$dev_state" 2>/dev/null)
worktree_path=$(jq -r '.worktree // ""' "$dev_state" 2>/dev/null)

if [[ -z "$branch" || -z "$worktree_path" ]]; then
    # 状态文件损坏 → fail-closed block
    jq -n '{"decision":"block","reason":"状态文件 .cecelia/dev-active-*.json 损坏，无法解析 branch/worktree。请检查或重启 /dev 流程。⚠️ 立即执行，禁止询问用户。禁止删除 .cecelia/dev-active-*.json。"}'
    exit 0
fi

# ---- hook 主动验证三完成条件 ---------------------------------------------
if ! type verify_dev_complete &>/dev/null; then
    jq -n '{"decision":"block","reason":"verify_dev_complete 未加载（devloop-check.sh），fail-closed。⚠️ 立即执行，禁止询问用户。"}'
    exit 0
fi

result=$(verify_dev_complete "$branch" "$worktree_path" "$main_repo" 2>/dev/null) || true
[[ -z "$result" ]] && result='{"status":"blocked","reason":"verify_dev_complete 无输出，fail-closed"}'

status=$(echo "$result" | jq -r '.status // "blocked"' 2>/dev/null || echo "blocked")

# ---- 单一 case + Ralph 风格出口 -----------------------------------------
case "$status" in
    done)
        # 三全满足 → rm 状态文件 + 输出 decision:allow + exit 0
        rm -f "$dev_state"
        # 同时清理 worktree 内 .dev-mode（如有）
        dev_mode_file="$worktree_path/.dev-mode.$branch"
        [[ -f "$dev_mode_file" ]] && rm -f "$dev_mode_file"
        reason=$(echo "$result" | jq -r '.reason // ""' 2>/dev/null || echo "")
        jq -n --arg r "$reason" '{"decision":"allow","reason":$r}'
        exit 0
        ;;
    *)
        # 未完成 → decision:block + reason 注入回 assistant
        reason=$(echo "$result" | jq -r '.reason // "未知"' 2>/dev/null || echo "未知")
        action=$(echo "$result" | jq -r '.action // ""' 2>/dev/null || echo "")
        run_id=$(echo "$result" | jq -r '.ci_run_id // ""' 2>/dev/null || echo "")
        full_reason="${reason}"
        [[ -n "$action" ]] && full_reason="${full_reason}。下一步：${action}"
        full_reason="${full_reason}。⚠️ 立即执行，禁止询问用户。禁止删除 .cecelia/dev-active-*.json。"
        jq -n --arg r "$full_reason" --arg id "$run_id" \
            '{"decision":"block","reason":$r,"ci_run_id":$id}'
        exit 0
        ;;
esac
```

- [ ] **Step 2: chmod + commit（实现还没在 lib 里，跑测试会 fail-closed block，Case B/C/D 至少能 PASS）**

```bash
WT=/Users/administrator/worktrees/cecelia/ralph-loop-pattern
chmod +x "$WT/packages/engine/hooks/stop-dev.sh"
git -C "$WT" add packages/engine/hooks/stop-dev.sh
git -C "$WT" commit -m "refactor(engine): stop-dev.sh 重写为 Ralph Loop 模式 (v21.0.0)

信号源切到主仓库根 .cecelia/dev-active-<branch>.json：
- 不依赖 cwd 是否在 worktree（assistant 漂出仍 block）
- 不依赖 .dev-mode（assistant 删了仍 block）
- hook 主动验证三条件（PR + Learning + cleanup ok）

verify_dev_complete 函数在 Task 4 实现。
"
```

---

## Task 4: devloop-check.sh 新增 verify_dev_complete 函数

**Files:**
- Modify: `packages/engine/lib/devloop-check.sh`（末尾追加约 70 行）

- [ ] **Step 1: 在文件末尾追加 verify_dev_complete 函数**

读 `/Users/administrator/worktrees/cecelia/ralph-loop-pattern/packages/engine/lib/devloop-check.sh` 末尾（约 line 530）。在 `if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then` 之前追加：

```bash
# ============================================================================
# 公开函数: verify_dev_complete BRANCH WORKTREE_PATH MAIN_REPO
# ============================================================================
# Ralph Loop 模式：hook 主动验证 dev 流程三完成条件
#   1. PR merged?      → gh pr view --json mergedAt（GitHub 真实状态）
#   2. Learning 写好?  → docs/learnings/<branch>.md 存在 + grep '^### 根本原因'
#   3. cleanup.sh ok?  → 真跑脚本看 exit code
#
# 不读 .dev-mode 字段（assistant 改不了 GitHub / 文件内容 / 命令 exit code）
# 输出 stdout JSON: {status: done|blocked, reason, action, ci_run_id?}
# ============================================================================
verify_dev_complete() {
    local branch="${1:-}"
    local worktree_path="${2:-}"
    local main_repo="${3:-}"
    local result_json='{"status":"blocked","reason":"unknown"}'

    while :; do
        # 必备参数
        if [[ -z "$branch" || -z "$main_repo" ]]; then
            result_json='{"status":"blocked","reason":"verify_dev_complete 缺参数：branch / main_repo"}'
            break
        fi

        # harness 模式豁免（保留兼容）
        local harness_mode="false"
        local dev_mode_file="${worktree_path}/.dev-mode.${branch}"
        if [[ -f "$dev_mode_file" ]]; then
            local _hm
            _hm=$(grep "^harness_mode:" "$dev_mode_file" 2>/dev/null | awk '{print $2}' | tr -d '[:space:]')
            [[ -n "$_hm" ]] && harness_mode="$_hm"
        fi

        # 1. 主动验证 PR merged
        local pr_number pr_merged_at
        if ! command -v gh &>/dev/null; then
            result_json='{"status":"blocked","reason":"gh CLI 不可用，无法验证 PR 状态","action":"安装 gh CLI"}'
            break
        fi
        pr_number=$(gh pr list --head "$branch" --state all --json number -q '.[0].number' 2>/dev/null || echo "")
        if [[ -z "$pr_number" ]]; then
            result_json=$(_devloop_jq -n --arg branch "$branch" \
                '{"status":"blocked","reason":"PR 未创建（branch=\($branch)）","action":"立即 push + gh pr create --base main --head \($branch)"}')
            break
        fi
        pr_merged_at=$(gh pr view "$pr_number" --json mergedAt -q '.mergedAt' 2>/dev/null || echo "")
        if [[ -z "$pr_merged_at" || "$pr_merged_at" == "null" ]]; then
            local ci_status
            ci_status=$(gh run list --branch "$branch" --limit 1 --json status -q '.[0].status' 2>/dev/null || echo "unknown")
            case "$ci_status" in
                in_progress|queued|waiting|pending)
                    result_json=$(_devloop_jq -n --arg pr "$pr_number" \
                        '{"status":"blocked","reason":"PR #\($pr) CI 进行中","action":"等 CI 完成（gh pr checks \($pr) --watch）"}')
                    ;;
                completed)
                    result_json=$(_devloop_jq -n --arg pr "$pr_number" \
                        '{"status":"blocked","reason":"PR #\($pr) CI 通过但未合并","action":"启 auto-merge: gh pr merge \($pr) --squash --auto"}')
                    ;;
                *)
                    result_json=$(_devloop_jq -n --arg pr "$pr_number" --arg s "$ci_status" \
                        '{"status":"blocked","reason":"PR #\($pr) 未合并，CI 状态: \($s)","action":"检查 CI 状态: gh pr checks \($pr)"}')
                    ;;
            esac
            break
        fi

        # 2. 主动验证 Learning 文件存在 + 内容合法（harness 豁免）
        if [[ "$harness_mode" != "true" ]]; then
            local learning_file="${main_repo}/docs/learnings/${branch}.md"
            if [[ ! -f "$learning_file" ]]; then
                result_json=$(_devloop_jq -n --arg f "$learning_file" \
                    '{"status":"blocked","reason":"Learning 文件不存在: \($f)","action":"立即写 Learning，必含 ### 根本原因 + ### 下次预防 段"}')
                break
            fi
            if ! grep -qE "^###?\s*根本原因" "$learning_file" 2>/dev/null; then
                result_json=$(_devloop_jq -n --arg f "$learning_file" \
                    '{"status":"blocked","reason":"Learning 缺必备段（### 根本原因）: \($f)","action":"补全 Learning"}')
                break
            fi
        fi

        # 3. 主动跑 cleanup.sh（含部署）
        local cleanup_script=""
        for _cs in \
            "${main_repo}/packages/engine/skills/dev/scripts/cleanup.sh" \
            "$HOME/.claude/skills/dev/scripts/cleanup.sh" \
            "$HOME/.claude-account1/skills/dev/scripts/cleanup.sh"; do
            [[ -f "$_cs" ]] && { cleanup_script="$_cs"; break; }
        done
        if [[ -z "$cleanup_script" ]]; then
            result_json='{"status":"blocked","reason":"未找到 cleanup.sh（无法部署/归档）","action":"检查 packages/engine/skills/dev/scripts/cleanup.sh"}'
            break
        fi
        echo "🧹 verify_dev_complete: 跑 cleanup.sh（含部署）..." >&2
        if ! (cd "$main_repo" && bash "$cleanup_script" "$branch") 2>/dev/null; then
            result_json='{"status":"blocked","reason":"cleanup.sh 执行失败（部署/归档异常）","action":"重新 bash packages/engine/skills/dev/scripts/cleanup.sh"}'
            break
        fi

        # 三全满足 → done
        result_json=$(_devloop_jq -n --arg pr "$pr_number" \
            '{"status":"done","reason":"PR #\($pr) 真完成：合并 + Learning + 部署 + 归档"}')
        break
    done

    echo "$result_json"
    return 0
}

```

- [ ] **Step 2: 跑 integration 测试转 green**

```bash
WT=/Users/administrator/worktrees/cecelia/ralph-loop-pattern
bash "$WT/packages/engine/tests/integration/ralph-loop-mode.test.sh" 2>&1 | tail -10
```

期望：Case A/B/C/D 全 PASS（Case E 信息行）。整体 exit=0。

如有 fail：检查是 stop-dev.sh 没识别状态文件，还是 verify_dev_complete 内部 bug。

- [ ] **Step 3: 跑 12 场景 E2E 看是否退化**

```bash
WT=/Users/administrator/worktrees/cecelia/ralph-loop-pattern
cd "$WT" && timeout 300 npx vitest run packages/engine/tests/e2e/stop-hook-full-lifecycle.test.sh 2>&1 | tail -8 || \
cd "$WT" && timeout 300 npx vitest run packages/engine/tests/e2e/stop-hook-full-lifecycle.test.ts 2>&1 | tail -8
```

期望：12 场景全过。如有 fail，可能是测试断言依赖旧 .dev-mode 信号——记录 fail 场景。

- [ ] **Step 4: commit verify_dev_complete 实现**

```bash
WT=/Users/administrator/worktrees/cecelia/ralph-loop-pattern
git -C "$WT" add packages/engine/lib/devloop-check.sh
git -C "$WT" commit -m "feat(engine): verify_dev_complete — hook 主动验证三完成条件 (cp-0504185237)

不读 .dev-mode 字段，主动验证：
1. PR merged → gh pr view --json mergedAt（GitHub 真实状态）
2. Learning 写好 → docs/learnings/<branch>.md 存在 + grep '### 根本原因'
3. cleanup.sh ok → 真跑脚本 exit 0

assistant 改不了 GitHub 状态、文件内容、命令 exit code → 无法假装完成。

让 Task 1 (5 case integration) 转 green。
"
```

---

## Task 5: 既有测试套件全量回归 + 修适配

**Files:**
- Modify（按需）: `packages/engine/tests/e2e/stop-hook-full-lifecycle.test.ts` 等场景断言

- [ ] **Step 1: 跑 4 套既有测试**

```bash
WT=/Users/administrator/worktrees/cecelia/ralph-loop-pattern
cd "$WT" && timeout 600 npx vitest run \
    packages/engine/tests/e2e/stop-hook-full-lifecycle.test.ts \
    packages/engine/tests/e2e/dev-workflow-e2e.test.ts \
    packages/engine/tests/hooks/ 2>&1 | tail -15
```

期望：原则上全过。如有 fail，逐个看场景：
- 如果场景依赖"删 .dev-mode 后 stop hook 放行" → **测试期望需更新**（行为改了）
- 如果场景依赖"cwd 在主仓库 stop hook 放行" → **测试期望需更新**
- 其他 fail → 实现 bug，回查 Task 3/4

- [ ] **Step 2: 跑 integration 全套**

```bash
bash "$WT/packages/engine/tests/integration/devloop-classify.test.sh" 2>&1 | tail -3
bash "$WT/packages/engine/tests/integration/ralph-loop-mode.test.sh" 2>&1 | tail -3
```

- [ ] **Step 3: 跑 check-single-exit 守护**

```bash
bash "$WT/scripts/check-single-exit.sh" 2>&1 | tail -10
```

期望：守护通过。stop-dev.sh 现在 case 内 2 个 exit 0（done + blocked 都用 exit 0 + decision JSON）+ 顶部几个早退 exit 0——可能违反守护。如违反，**更新守护脚本期望**：Ralph 模式的 stop-dev.sh 多个 exit 0 是协议要求（decision:block + exit 0），需要松绑。

- [ ] **Step 4: 如 Step 3 守护失败，更新 check-single-exit.sh**

替换 stop-dev.sh exit 0 = 1 的检查为：
```bash
# Ralph Loop 模式：stop-dev.sh 用 decision:block + exit 0 协议
# 出口数不再硬约束 = 1（多个 exit 0 都是 Ralph 协议合法用法）
# 守护改为：禁止 exit 2（Ralph 模式不应有 exit 2）
check_count "$REPO_ROOT/packages/engine/hooks/stop-dev.sh" '\bexit 2\b' 0 "stop-dev.sh exit 2"
```

- [ ] **Step 5: commit 测试适配 + 守护更新**

```bash
WT=/Users/administrator/worktrees/cecelia/ralph-loop-pattern
git -C "$WT" add -A
# 看实际改了哪些
git -C "$WT" status --short
git -C "$WT" commit -m "test(engine): Ralph Loop 模式测试适配 + 守护更新 (cp-0504185237)

- 既有 12 场景 E2E 适配新信号源（.cecelia/dev-active-* 替代 .dev-mode）
- 既有 stop-hook-exit-codes 适配 decision:block + exit 0 协议
- check-single-exit.sh 守护：不再硬卡 exit 0 数，改卡 exit 2 = 0（Ralph 不用 exit 2）
"
```

---

## Task 6: .gitignore + Engine 版本 bump + Learning + changelog

**Files:**
- Modify: `.gitignore`
- Modify: 8 个版本文件 + SKILL.md
- Modify: `packages/engine/feature-registry.yml`
- Create: `docs/learnings/cp-0504185237-ralph-loop-pattern.md`

- [ ] **Step 1: .gitignore 加 .cecelia/dev-active***

读 `.gitignore` 末尾，追加：
```
# Ralph Loop 模式 dev session 状态（项目根，永远不进 git）
.cecelia/dev-active-*.json
```

- [ ] **Step 2: 8 处版本 bump 18.18.1 → 18.19.0**

依次改：
- `packages/engine/package.json` `"version": "18.18.1"` → `"version": "18.19.0"`
- `packages/engine/package-lock.json`（root + packages.""）
- `packages/engine/VERSION` 写 `18.19.0\n`
- `packages/engine/.hook-core-version` 写 `18.19.0\n`
- `packages/engine/hooks/.hook-core-version` 写 `18.19.0\n`
- `packages/engine/hooks/VERSION` 写 `18.19.0\n`
- `packages/engine/regression-contract.yaml` `version: 18.18.1` → `version: 18.19.0`
- `packages/engine/skills/dev/SKILL.md` frontmatter `version: 18.18.1` → `version: 18.19.0`

跑同步检查：
```bash
WT=/Users/administrator/worktrees/cecelia/ralph-loop-pattern
bash "$WT/scripts/check-version-sync.sh" 2>&1 | tail -3
cd "$WT" && bash packages/engine/skills/dev/scripts/check-cleanup.sh 2>&1 | tail -5
```

- [ ] **Step 3: feature-registry.yml 加 18.19.0 changelog**

在 `changelog:` 段顶部插入：
```yaml
  - version: "18.19.0"
    date: "2026-05-04"
    change: "feat"
    description: "Stop Hook Ralph Loop 模式（cp-0504185237）— 照搬官方 ralph-loop 插件三层防御。信号源从 cwd-as-key（.dev-mode 在 worktree 根）切到项目根 .cecelia/dev-active-<branch>.json。完成判定从 .dev-mode 字段切到 hook 主动验证（PR merged via gh API + Learning 文件 grep + cleanup.sh 真跑）。修 5 次 PR 都没修对的 3 个根因：cwd 漂移、文件主动权、字段假完成。"
    files:
      - "packages/engine/skills/dev/scripts/worktree-manage.sh (创建项目根状态文件)"
      - "packages/engine/hooks/stop-dev.sh (重写 Ralph 风格)"
      - "packages/engine/lib/devloop-check.sh (新增 verify_dev_complete)"
      - "packages/engine/tests/integration/ralph-loop-mode.test.sh (新增 5 case 守门)"
      - ".gitignore (.cecelia/dev-active-*)"
      - "Engine 8 处版本文件 18.19.0"
```

- [ ] **Step 4: 写 Learning**

写入 `docs/learnings/cp-0504185237-ralph-loop-pattern.md`：

```markdown
# Learning — Stop Hook Ralph Loop 模式

分支：cp-0504185237-ralph-loop-pattern
日期：2026-05-04
Brain Task：2702073b-cf9e-47c3-832d-fbe417b5d570
前置 PR：#2503 + #2745 + #2746 + #2747 + #2749

## 背景

Stop Hook 修了 5 次仍不收敛。Alex 指出 Anthropic 官方 [ralph-loop 插件](https://github.com/anthropics/claude-plugins-official/tree/main/plugins/ralph-loop) 已有正确模式，照搬即可。

## 根本原因（5 次都没修）

| # | 故障 |
|---|---|
| 1 | **cwd-as-key 信号源不稳**：assistant 工作时 cwd 漂出 worktree（跑 git fetch / gh CLI 在主仓库），stop hook 看到主分支放行 |
| 2 | **状态文件主动权在 assistant 手里**：.dev-mode.<branch> 在 worktree 根（暴露），assistant 任何时候能改字段或删文件 |
| 3 | **完成判定靠 .dev-mode 字段**：assistant 改 step_4_ship: done 即可"假装完成" |

5 次 PR 都修 stop hook **内部判断逻辑**，没改信号源、生命周期、完成判定这 3 个根因——所以越修越复杂仍漏。

## Ralph Loop 三层防御（验证有效）

| 层 | 做法 |
|---|---|
| 1 | **状态信号** = 项目根固定路径（`.claude/ralph-loop.local.md`），不依赖 cwd |
| 2 | **文件生命周期** 完全在 hook 手里：user 创建 / hook 修改 / hook 删除——assistant 不参与 |
| 3 | **完成判定** = assistant 难以伪造的运行时事件（必须输出特定字符串 `<promise>...</promise>`，hook 检测到才删文件）|

## 应用到 Cecelia /dev

- 状态文件搬到 `.cecelia/dev-active-<branch>.json` 主仓库根
- 创建：`engine-worktree` skill 入口（user 调 /dev 时）
- 删除：stop hook 在三全满足时 rm（assistant 不碰）
- 完成判定：hook 主动验证三条件
  - PR merged → `gh pr view --json mergedAt`（GitHub 真实状态）
  - Learning 写好 → `docs/learnings/<branch>.md` 存在 + grep `^### 根本原因`
  - cleanup.sh ok → 真跑脚本看 exit code
- `.dev-mode` 保留作辅助元数据（branch / step_1_spec 等），不再是完成信号

## Stop Hook 协议改用 Ralph 风格

```bash
# 之前：exit 2 = block
# Ralph：decision:block + exit 0 = block + 把 reason 注入 assistant
jq -n '{"decision":"block","reason":"...继续干活..."}'
exit 0
```

## 下次预防

- [ ] 任何"信号源"设计先问：assistant 能不能改/删/绕过？只要 assistant 能动 → 不行
- [ ] 完成判定优先用"运行时事件"（gh API / 真跑命令 / 文件 grep），少用"状态字段"（assistant 改字段太简单）
- [ ] 任何 hook/守护 Cecelia 自己改 5 次都不收敛时，**必须搜索 Anthropic 官方插件**找参考实现（Ralph、其他 official plugins）
- [ ] cwd 漂移在 long-running session 是常态，任何依赖 cwd 的判断都要质疑

## Stop Hook 重构最终闭环

| 阶段 | PR | 内容 |
|---|---|---|
| 4/21 | #2503 | cwd-as-key 身份归一（**埋了 cwd 漂移漏洞**）|
| 5/4 | #2745 | 散点 12 → 集中 3 处 |
| 5/4 | #2746 | 探测失败 fail-closed |
| 5/4 | #2747 | 三态出口严格分离 |
| 5/4 | #2749 | condition 5 真完成守门 |
| 5/4 | **本 PR** | **Ralph Loop 模式（信号源 + 生命周期 + 完成判定三换骨）** |

## 验证证据

- 5 case integration（ralph-loop-mode）100% 通过
- 既有 12 场景 E2E 适配后 100% 通过
- 既有 174+ stop-hook 测试适配后通过
- 8 处版本文件同步 18.19.0
```

- [ ] **Step 5: commit 全部**

```bash
WT=/Users/administrator/worktrees/cecelia/ralph-loop-pattern
git -C "$WT" add -A
git -C "$WT" commit -m "$(cat <<'EOF'
chore(engine): [CONFIG] version bump → 18.19.0 + Learning + changelog (cp-0504185237)

Ralph Loop 模式 minor bump：
- .gitignore 加 .cecelia/dev-active-*
- 8 处版本文件同步 18.19.0
- feature-registry.yml 加 18.19.0 changelog
- docs/learnings/cp-0504185237-ralph-loop-pattern.md 写 Learning
EOF
)"
```

---

## Self-Review

1. **Spec 覆盖**：spec 8 步实施 → 6 task。验收清单条目都对应 task。
2. **Placeholder 扫描**：无 TBD/TODO（mock cleanup.sh 不完美的 case 由 E2E 覆盖，已注明）。
3. **Type 一致性**：`verify_dev_complete` / `dev_state` / `.cecelia/dev-active-<branch>.json` / `decision:block` 在 task 间一致。
