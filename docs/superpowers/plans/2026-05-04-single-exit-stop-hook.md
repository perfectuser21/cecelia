# Stop Hook 单一 exit 0 重构 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `packages/engine/hooks/stop-dev.sh` 7 处 `exit 0` 归一到 1 个，把 `packages/engine/lib/devloop-check.sh` 4 处 `return 0` 归一到 1 个；新增 `classify_session()` 函数收纳所有"非 dev 上下文"判断；CI grep 守护永远阻止散点出口复活。

**Architecture:** stop-dev.sh 退化为 1 个 `case "$status"` 单一 exit 0；devloop-check.sh 在 `devloop_check()` 主函数内用 `while :; do ... break; done` 模式收敛多分支到末尾单一 `echo + return 0`；新增 `classify_session()` 同模式承载所有"非 dev 上下文"早退（bypass / cwd / git / 主分支 / 无 .dev-mode / 格式异常）。业务逻辑（auto-merge / cleanup.sh / CI 等待 / harness / Brain 回写）一字不动。

**Tech Stack:** bash 3.2 兼容（macOS 默认）；jq；既有 vitest E2E（`packages/engine/tests/e2e/stop-hook-full-lifecycle.test.ts`）；新增 bash integration test。

---

## 文件结构

| 文件 | 操作 | 责任 |
|---|---|---|
| `packages/engine/lib/devloop-check.sh` | 改 | 新增 `classify_session()`；改造 `devloop_check()` 为单一 return 0；辅助函数 `_mark_cleanup_done` / `_increment_and_check_ci_counter` 内部 `return 0` 改成 `return`（无参数）保留语义 |
| `packages/engine/hooks/stop-dev.sh` | 改 | 退化为加载 lib + 单 case + 单 exit 0；删除 7 处散点 |
| `hooks/stop-dev.sh` | 镜像 | 与 packages/engine/hooks/stop-dev.sh 同步（手动 cp） |
| `packages/engine/tests/integration/devloop-classify.test.sh` | 新建 | 8 分支测试 `classify_session` |
| `scripts/check-single-exit.sh` | 新建 | CI 守护，grep 卡死出口数 |
| `.github/workflows/engine-ci.yml` | 改 | 接入 check-single-exit lint job |
| `packages/engine/tests/e2e/stop-hook-full-lifecycle.test.ts` | 不改契约 | 既有 12 场景 100% 回归 |
| `packages/engine/package.json` + `package-lock.json` + `VERSION` + `.hook-core-version` + `regression-contract.yaml` | 改 | Engine 版本 bump（5 文件同步） |
| `packages/engine/feature-registry.yml` | 改 | 加 changelog |

---

## Task 1: 新建 `classify_session` integration 测试（TDD red）

**Files:**
- Create: `packages/engine/tests/integration/devloop-classify.test.sh`

- [ ] **Step 1: 创建测试脚本**

```bash
WT=/Users/administrator/worktrees/cecelia/single-exit-stop-hook
mkdir -p "$WT/packages/engine/tests/integration"
```

完整内容写到 `packages/engine/tests/integration/devloop-classify.test.sh`：

```bash
#!/usr/bin/env bash
# devloop-classify.test.sh — classify_session 8 分支 integration 测试
# 不依赖 vitest，纯 bash，便于在 CI lint job 直接跑。

set -uo pipefail

THIS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$THIS_DIR/../../../.." && pwd)"
LIB="$REPO_ROOT/packages/engine/lib/devloop-check.sh"

# shellcheck disable=SC1090
source "$LIB"

PASS=0
FAIL=0
TMPROOT=$(mktemp -d)
trap 'rm -rf "$TMPROOT"' EXIT

assert_status() {
    local label="$1" expected="$2" got="$3"
    if [[ "$got" == "$expected" ]]; then
        echo "✅ $label: status=$got"
        PASS=$((PASS+1))
    else
        echo "❌ $label: status=$got (expected $expected)"
        FAIL=$((FAIL+1))
    fi
}

# Case 1: bypass env → not-dev
unset CECELIA_STOP_HOOK_BYPASS
CECELIA_STOP_HOOK_BYPASS=1 result=$(classify_session "$TMPROOT")
status=$(echo "$result" | jq -r '.status')
assert_status "bypass env" "not-dev" "$status"

# Case 2: cwd 不是目录 → not-dev
unset CECELIA_STOP_HOOK_BYPASS
result=$(classify_session "/non/existent/path/zzz")
status=$(echo "$result" | jq -r '.status')
assert_status "cwd 不是目录" "not-dev" "$status"

# Case 3: cwd 是目录但不是 git repo → not-dev
NOT_GIT="$TMPROOT/not-git"
mkdir -p "$NOT_GIT"
result=$(classify_session "$NOT_GIT")
status=$(echo "$result" | jq -r '.status')
assert_status "非 git repo" "not-dev" "$status"

# Case 4: 主分支 → not-dev
MAIN_REPO="$TMPROOT/main-repo"
mkdir -p "$MAIN_REPO"
( cd "$MAIN_REPO" && git init -q -b main && git commit -q --allow-empty -m init )
result=$(classify_session "$MAIN_REPO")
status=$(echo "$result" | jq -r '.status')
assert_status "主分支放行" "not-dev" "$status"

# Case 5: cp-* 分支但无 .dev-mode → not-dev
CP_REPO="$TMPROOT/cp-repo"
mkdir -p "$CP_REPO"
( cd "$CP_REPO" && git init -q -b main && git commit -q --allow-empty -m init && git checkout -q -b cp-test )
result=$(classify_session "$CP_REPO")
status=$(echo "$result" | jq -r '.status')
assert_status "cp-* 分支但无 .dev-mode" "not-dev" "$status"

# Case 6: cp-* 分支 + .dev-mode 格式异常（首行非 dev）→ blocked
BAD_REPO="$TMPROOT/bad-repo"
mkdir -p "$BAD_REPO"
( cd "$BAD_REPO" && git init -q -b main && git commit -q --allow-empty -m init && git checkout -q -b cp-bad )
echo "garbage" > "$BAD_REPO/.dev-mode.cp-bad"
result=$(classify_session "$BAD_REPO")
status=$(echo "$result" | jq -r '.status')
assert_status ".dev-mode 格式异常" "blocked" "$status"

# Case 7: cp-* 分支 + .dev-mode 合法但 step_1_spec 未完成 → blocked（透传 devloop_check）
DEV_REPO="$TMPROOT/dev-repo"
mkdir -p "$DEV_REPO"
( cd "$DEV_REPO" && git init -q -b main && git commit -q --allow-empty -m init && git checkout -q -b cp-dev )
cat > "$DEV_REPO/.dev-mode.cp-dev" <<EOF
dev
branch: cp-dev
step_1_spec: pending
step_2_code: pending
EOF
result=$(classify_session "$DEV_REPO")
status=$(echo "$result" | jq -r '.status')
assert_status "step_1_spec 未完成" "blocked" "$status"

# Case 8: cp-* 分支 + .dev-mode 含 cleanup_done: true → done（透传 devloop_check 条件 0.1）
CLEAN_REPO="$TMPROOT/clean-repo"
mkdir -p "$CLEAN_REPO"
( cd "$CLEAN_REPO" && git init -q -b main && git commit -q --allow-empty -m init && git checkout -q -b cp-clean )
cat > "$CLEAN_REPO/.dev-mode.cp-clean" <<EOF
dev
branch: cp-clean
cleanup_done: true
EOF
result=$(classify_session "$CLEAN_REPO")
status=$(echo "$result" | jq -r '.status')
assert_status "cleanup_done done 透传" "done" "$status"

echo ""
echo "=== Total: $((PASS+FAIL)) | PASS: $PASS | FAIL: $FAIL ==="
[[ "$FAIL" -eq 0 ]]
```

- [ ] **Step 2: 让脚本可执行 + 跑测试验证 fail（未实现 classify_session）**

Run:
```bash
WT=/Users/administrator/worktrees/cecelia/single-exit-stop-hook
chmod +x "$WT/packages/engine/tests/integration/devloop-classify.test.sh"
bash "$WT/packages/engine/tests/integration/devloop-classify.test.sh"
echo "exit=$?"
```

Expected: 大量 `❌` + `exit=非 0`（因为 classify_session 未定义；可能整体进程会因为 source LIB 后调用 classify_session 直接 command not found）

- [ ] **Step 3: commit red 状态**

```bash
WT=/Users/administrator/worktrees/cecelia/single-exit-stop-hook
git -C "$WT" add packages/engine/tests/integration/devloop-classify.test.sh
git -C "$WT" commit -m "test(engine): classify_session 8 分支 integration 测试（TDD red）

新增 packages/engine/tests/integration/devloop-classify.test.sh，
覆盖 bypass / cwd 异常 / 非 git / 主分支 / 无 .dev-mode / 格式异常 / step_1 未完成 / cleanup_done done
8 个分支。当前因 classify_session 未实现，测试全部 FAIL。
"
```

---

## Task 2: 实现 `classify_session()` + 让 Task 1 测试转 green

**Files:**
- Modify: `packages/engine/lib/devloop-check.sh`（在 `devloop_check_main` 函数定义之前、`devloop_check` 函数定义之后插入）

- [ ] **Step 1: 找到插入点**

Read `packages/engine/lib/devloop-check.sh` line 378-415（`devloop_check()` 结束 `}` 到 `devloop_check_main()` 开始）。在 `devloop_check()` 结束 `}` 后、`# ====` 注释（直接执行入口）之前插入。

- [ ] **Step 2: 在 devloop-check.sh 第 378 行后（`}` 之后）插入 classify_session 函数**

```bash
# ============================================================================
# 公开函数: classify_session CWD
#   入口契约：从 cwd 推断当前是否在 /dev 业务上下文。
#   输出 stdout JSON: {status, reason, [action], [ci_run_id], [dev_mode]}
#   status 取值：
#     - "not-dev"  → 不在 dev 上下文（bypass / cwd 异常 / 非 git / 主分支 / 无 .dev-mode），调用方应放行
#     - "blocked"  → 在 dev 上下文但业务未完成，调用方应让 assistant 继续干活
#     - "done"     → 在 dev 上下文且业务真完成，调用方应清理 .dev-mode 并放行
#   单一出口：while:; do ... break; done 收敛到末尾单一 echo + return 0。
# ============================================================================
classify_session() {
    local cwd="${1:-$PWD}"
    local result_json='{"status":"blocked","reason":"unknown"}'

    while :; do
        # 1) bypass
        if [[ "${CECELIA_STOP_HOOK_BYPASS:-}" == "1" ]]; then
            result_json='{"status":"not-dev","reason":"bypass via CECELIA_STOP_HOOK_BYPASS=1"}'
            break
        fi

        # 2) cwd 必须是目录
        if [[ ! -d "$cwd" ]]; then
            result_json='{"status":"not-dev","reason":"cwd 不是目录"}'
            break
        fi

        # 3) git 探测（worktree + branch）
        local wt_root branch
        wt_root=$(git -C "$cwd" rev-parse --show-toplevel 2>/dev/null) || {
            result_json='{"status":"not-dev","reason":"非 git repo（rev-parse --show-toplevel 失败）"}'
            break
        }
        branch=$(git -C "$cwd" rev-parse --abbrev-ref HEAD 2>/dev/null) || {
            result_json='{"status":"not-dev","reason":"无法读取分支（rev-parse --abbrev-ref 失败）"}'
            break
        }

        # 4) 主分支放行
        case "$branch" in
            main|master|develop|HEAD)
                result_json=$(_devloop_jq -n --arg b "$branch" \
                    '{"status":"not-dev","reason":"主分支放行（\($b)）"}')
                break
                ;;
        esac

        # 5) 必须有 .dev-mode
        local dev_mode="$wt_root/.dev-mode.$branch"
        if [[ ! -f "$dev_mode" ]]; then
            result_json=$(_devloop_jq -n --arg f "$dev_mode" \
                '{"status":"not-dev","reason":"无 \($f)，非 /dev 业务"}')
            break
        fi

        # 6) .dev-mode 格式校验（首行必须 dev）
        if ! head -1 "$dev_mode" 2>/dev/null | grep -q "^dev$"; then
            local first_line
            first_line=$(head -1 "$dev_mode" 2>/dev/null || echo "<empty>")
            result_json=$(_devloop_jq -n --arg f "$dev_mode" --arg l "$first_line" \
              '{"status":"blocked","reason":"dev-mode 格式异常（首行 [\($l)] 不是 dev）: \($f)。请删除该文件或修正为标准格式后重试。"}')
            break
        fi

        # 7) 业务判定（透传 devloop_check 输出，附加 dev_mode 路径供调用方 rm）
        local devloop_result
        devloop_result=$(devloop_check "$branch" "$dev_mode" 2>/dev/null) || true
        [[ -z "$devloop_result" ]] && devloop_result='{"status":"blocked","reason":"devloop_check 无输出"}'
        result_json=$(echo "$devloop_result" | jq --arg dm "$dev_mode" '. + {dev_mode: $dm}' 2>/dev/null \
            || echo "$devloop_result")
        break
    done

    echo "$result_json"
    return 0
}

```

- [ ] **Step 3: 跑 integration 测试转 green**

Run:
```bash
WT=/Users/administrator/worktrees/cecelia/single-exit-stop-hook
bash "$WT/packages/engine/tests/integration/devloop-classify.test.sh"
echo "exit=$?"
```

Expected: 8 个 `✅` + `=== Total: 8 | PASS: 8 | FAIL: 0 ===` + `exit=0`

- [ ] **Step 4: commit green 状态**

```bash
WT=/Users/administrator/worktrees/cecelia/single-exit-stop-hook
git -C "$WT" add packages/engine/lib/devloop-check.sh
git -C "$WT" commit -m "feat(engine): classify_session 函数 — Stop Hook 单一出口前置（cp-0504114459）

在 devloop-check.sh 新增 classify_session(cwd) 函数：
- 入口：从 cwd 推断 dev 上下文
- 单一出口（while:; break 模式）：末尾 echo + return 0
- status 三态：not-dev / blocked / done
- 透传 devloop_check 业务判定（附加 dev_mode 路径供调用方 rm）

让 Task 1 的 8 分支 integration 测试转 green。
"
```

---

## Task 3: 改造 `devloop_check()` 为单一 return 0（while:; break 模式）

**Files:**
- Modify: `packages/engine/lib/devloop-check.sh:111-378`（`devloop_check()` 主函数体）

**说明**：把 4 处 `return 0`（L137 / L309 / L323 / L372）和 11+ 处 `return 2` 都归一到末尾单一 `echo + return 0`，通过 result_json 的 status 字段传递语义。**业务逻辑（gh pr merge / cleanup.sh / Brain 回写 / harness 分叉）一字不改**，只动控制流。

- [ ] **Step 1: 跑既有 E2E 12 场景，记录绿灯 baseline**

Run:
```bash
WT=/Users/administrator/worktrees/cecelia/single-exit-stop-hook
cd "$WT" && npx vitest run packages/engine/tests/e2e/stop-hook-full-lifecycle.test.ts 2>&1 | tail -25
```

Expected: 全部通过（baseline，重构前）

- [ ] **Step 2: 改写 devloop_check() 主函数（替换 line 111-378 整段）**

Read line 111-378 完整段落（已在 spec 阶段读过）。把现有 `devloop_check() { ... }` 整段函数替换为以下内容（保留每条件的业务逻辑，仅改控制流）：

```bash
# ============================================================================
# 主函数: devloop_check BRANCH DEV_MODE_FILE
# ============================================================================
# 单一出口模式：所有条件用 result_json=...; break 表语义，
# 末尾单一 echo + return 0；状态由 status 字段携带（done/blocked）。
# 业务逻辑（auto-merge / cleanup.sh / Brain 回写 / harness 分叉）保留原行为。
# ============================================================================
devloop_check() {
    local branch="${1:-}"
    local dev_mode_file="${2:-}"
    local PROJECT_ROOT
    PROJECT_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
    local result_json='{"status":"blocked","reason":"未知"}'

    while :; do
        if [[ -z "$branch" ]]; then
            result_json='{"status":"blocked","reason":"branch 参数为空","action":"检查调用方传入的 BRANCH 参数"}'
            break
        fi

        # ===== 条件 0 (预检): harness_mode =====
        local _harness_mode="false"
        if [[ -f "$dev_mode_file" ]]; then
            local _hm_raw
            _hm_raw=$(grep "^harness_mode:" "$dev_mode_file" 2>/dev/null | awk '{gsub(/^[ \t]+|[ \t]+$/, "", $2); print $2}' || true)
            [[ -n "$_hm_raw" ]] && _harness_mode="$_hm_raw"
        fi

        # ===== 条件 0.1: cleanup_done（跳过 harness 模式）=====
        if [[ "$_harness_mode" != "true" ]] && \
           [[ -f "$dev_mode_file" ]] && grep -q "cleanup_done: true" "$dev_mode_file" 2>/dev/null; then
            result_json='{"status":"done","reason":"cleanup_done"}'
            break
        fi

        # ===== 条件 0.5: harness_mode 通道 =====
        if [[ "$_harness_mode" == "true" ]]; then
            local _h_step2="pending"
            local _h_step2_raw
            _h_step2_raw=$(grep "^step_2_code:" "$dev_mode_file" 2>/dev/null | awk '{gsub(/^[ \t]+|[ \t]+$/, "", $2); print $2}' || true)
            [[ -n "$_h_step2_raw" ]] && _h_step2="$_h_step2_raw"
            if [[ "$_h_step2" != "done" ]]; then
                local _task_id
                _task_id=$(grep "^task_id:" "$dev_mode_file" 2>/dev/null | awk '{print $2}' || echo "")
                if [[ -n "$_task_id" ]]; then
                    curl -s --connect-timeout 3 --max-time 5 \
                        -X PATCH "http://localhost:5221/api/brain/tasks/$_task_id" \
                        -H "Content-Type: application/json" \
                        -d "{\"status\":\"failed\",\"result\":{\"error_message\":\"[Harness] Stage 2 Code 未完成，devloop-check 检测到失败\"}}" \
                        >/dev/null 2>&1 || true
                fi
                result_json='{"status":"blocked","reason":"[Harness] Stage 2 Code 未完成","action":"立即读取 skills/dev/steps/02-code.md 并执行 Stage 2（harness 模式）。禁止询问用户。"}'
                break
            fi

            local _h_pr=""
            if command -v gh &>/dev/null; then
                _h_pr=$(gh pr list --head "$branch" --state all --json number -q '.[0].number' 2>/dev/null || echo "")
            fi
            if [[ -z "$_h_pr" ]]; then
                result_json=$(_devloop_jq -n --arg branch "$branch" \
                    '{"status":"blocked","reason":"[Harness] PR 未创建","action":"立即 push + 创建 PR（gh pr create --base main --head \($branch)）"}')
                break
            fi

            # Harness: 代码写完 + PR 已创建 → 开 auto-merge，继续走 CI 等待 → 条件 6 自动 merge
            gh pr merge "$_h_pr" --squash --auto 2>/dev/null || true
        fi

        # ===== 条件 1: step_1_spec =====
        if [[ -f "$dev_mode_file" ]]; then
            local step_1_status
            step_1_status=$(grep "^step_1_spec:" "$dev_mode_file" 2>/dev/null | awk '{print $2}' || echo "pending")
            if [[ "$step_1_status" != "done" ]]; then
                result_json='{"status":"blocked","reason":"Stage 1 Spec 未完成","action":"立即读取 skills/dev/steps/01-spec.md 并执行 Stage 1。禁止询问用户。"}'
                break
            fi
        fi

        # ===== 条件 2: step_2_code =====
        if [[ -f "$dev_mode_file" ]]; then
            local step_2_status
            step_2_status=$(grep "^step_2_code:" "$dev_mode_file" 2>/dev/null | awk '{print $2}' || echo "pending")
            if [[ "$step_2_status" != "done" ]]; then
                result_json='{"status":"blocked","reason":"Stage 2 Code 未完成","action":"立即读取 skills/dev/steps/02-code.md 并执行 Stage 2。禁止询问用户。"}'
                break
            fi
        fi

        # ===== 条件 2.6: DoD 完整性检查（harness 跳过）=====
        if [[ "$_harness_mode" != "true" ]] && [[ -f "$dev_mode_file" ]]; then
            local _task_card_rel _worktree_root _task_card_abs _dod_unchecked
            _task_card_rel=$(grep "^task_card:" "$dev_mode_file" 2>/dev/null | awk '{print $2}' || echo "")
            _worktree_root=$(dirname "$dev_mode_file")
            _task_card_abs="$_worktree_root/$_task_card_rel"
            if [[ -n "$_task_card_rel" && -f "$_task_card_abs" ]]; then
                _dod_unchecked=$(grep -cE '^\s*-\s+\[ \]\s+\[' "$_task_card_abs" 2>/dev/null; true)
                _dod_unchecked="${_dod_unchecked:-0}"
                if [[ "$_dod_unchecked" -gt 0 ]]; then
                    result_json=$(_devloop_jq -n --argjson n "$_dod_unchecked" \
                        '{"status":"blocked","reason":"DoD 有 \($n) 条未验证（[ ] 未改为 [x]）","action":"逐条运行 Test 命令验证，通过后改为 [x]"}')
                    break
                fi
            fi
        fi

        # ===== 条件 3: PR 已创建? =====
        local pr_number="" pr_state=""
        if command -v gh &>/dev/null; then
            pr_number=$(gh pr list --head "$branch" --state open --json number -q '.[0].number' 2>/dev/null || echo "")
            if [[ -n "$pr_number" ]]; then
                pr_state="open"
            else
                pr_number=$(gh pr list --head "$branch" --state merged --json number -q '.[0].number' 2>/dev/null || echo "")
                [[ -n "$pr_number" ]] && pr_state="merged"
            fi
        fi

        if [[ -z "$pr_number" ]]; then
            result_json=$(_devloop_jq -n --arg branch "$branch" \
                '{"status":"blocked","reason":"PR 未创建","action":"创建 PR（gh pr create --base main --head \($branch)）"}')
            break
        fi

        # ===== 条件 4: CI 状态? =====
        local ci_status="unknown" ci_conclusion="" ci_run_id=""
        if [[ "$pr_state" != "merged" ]]; then
            local run_info
            run_info=$(gh run list --branch "$branch" --limit 1 --json status,conclusion,databaseId 2>/dev/null || echo "[]")
            if [[ -n "$run_info" && "$run_info" != "[]" ]]; then
                ci_status=$(echo "$run_info" | jq -r '.[0].status // "unknown"' 2>/dev/null || echo "unknown")
                ci_conclusion=$(echo "$run_info" | jq -r '.[0].conclusion // ""' 2>/dev/null || echo "")
                ci_run_id=$(echo "$run_info" | jq -r '.[0].databaseId // ""' 2>/dev/null || echo "")
            fi

            local _ci_break=false
            case "$ci_status" in
                "completed")
                    if [[ "$ci_conclusion" != "success" ]]; then
                        _increment_and_check_ci_counter "$dev_mode_file" >/dev/null
                        local action_msg
                        action_msg=$(_ci_action_for_count "$dev_mode_file")
                        [[ -n "${ci_run_id}" ]] && \
                            action_msg="${action_msg}（gh run view ${ci_run_id} --log-failed）"
                        result_json=$(_devloop_jq -n \
                            --arg reason "CI 失败（${ci_conclusion}）" \
                            --arg action "$action_msg" \
                            --arg run_id "${ci_run_id:-}" \
                            '{"status":"blocked","reason":$reason,"action":$action,"ci_run_id":$run_id}')
                        _ci_break=true
                    fi
                    ;;
                "in_progress"|"queued"|"waiting"|"pending")
                    local _started _se _elapsed
                    _started=$(grep "^started:" "$dev_mode_file" 2>/dev/null | awk '{print $2}' || echo "")
                    _se=""
                    if [[ -n "$_started" ]]; then
                        _se=$(date -d "$_started" +%s 2>/dev/null || date -j -f "%Y-%m-%dT%H:%M:%S" "${_started%+*}" +%s 2>/dev/null || echo "")
                    fi
                    if [[ -n "$_started" && -n "$_se" && $_se -gt 0 ]]; then
                        _elapsed=$(( $(date +%s) - _se ))
                    else
                        _elapsed=0
                    fi
                    if [[ -n "$_started" && -n "$_se" && $_elapsed -gt 5400 ]]; then
                        result_json=$(_devloop_jq -n --arg b "$branch" '{"status":"blocked","reason":"CI 已 pending 90+ 分钟，可能卡死","action":"检查 CI：gh run list --branch \($b) --limit 5"}')
                    else
                        result_json=$(_devloop_jq -n --arg s "$ci_status" '{"status":"blocked","reason":"CI 进行中（\($s)）"}')
                    fi
                    _ci_break=true
                    ;;
                *)
                    result_json=$(_devloop_jq -n --arg status "$ci_status" --arg branch "$branch" \
                        '{"status":"blocked","reason":"CI 状态未知（\($status)）","action":"运行 gh run list --branch \($branch) --limit 1 检查 CI 状态"}')
                    _ci_break=true
                    ;;
            esac
            [[ "$_ci_break" == "true" ]] && break
        fi

        # ===== 条件 5: PR 已合并? =====
        if [[ "$pr_state" == "merged" ]]; then
            local pr_base_ref=""
            [[ -n "$pr_number" ]] && \
                pr_base_ref=$(gh pr view "$pr_number" --json baseRefName -q '.baseRefName' 2>/dev/null || echo "")
            if [[ -n "$pr_base_ref" && "$pr_base_ref" != "main" ]]; then
                result_json=$(_devloop_jq -n --arg base "$pr_base_ref" \
                    '{"status":"blocked","reason":"PR 已合并但目标分支不是 main（目标：\($base)）","action":"检查是否误合并到错误分支"}')
                break
            fi

            local step_4_status
            step_4_status=$(_get_step4_status "$dev_mode_file")

            if [[ "$step_4_status" == "done" ]] || [[ "$_harness_mode" == "true" ]]; then
                _mark_cleanup_done "$dev_mode_file"
                result_json='{"status":"done","reason":"PR 已合并，工作流结束"}'
                break
            fi

            local _cleanup_script=""
            for _cs in \
                "${PROJECT_ROOT:-}/packages/engine/skills/dev/scripts/cleanup.sh" \
                "$HOME/.claude/skills/dev/scripts/cleanup.sh" \
                "$HOME/.claude-account1/skills/dev/scripts/cleanup.sh"; do
                [[ -f "$_cs" ]] && { _cleanup_script="$_cs"; break; }
            done
            if [[ -n "$_cleanup_script" ]]; then
                echo "🧹 自动执行 cleanup.sh..." >&2
                if (cd "$(git rev-parse --show-toplevel 2>/dev/null || pwd)" && bash "$_cleanup_script") 2>/dev/null; then
                    _mark_cleanup_done "$dev_mode_file"
                    result_json='{"status":"done","reason":"PR 已合并，cleanup 完成"}'
                else
                    result_json='{"status":"blocked","reason":"PR 已合并，cleanup.sh 执行失败","action":"立即读取 skills/dev/steps/04-ship.md 并执行 Stage 4 Ship"}'
                fi
            else
                result_json='{"status":"blocked","reason":"PR 已合并，未找到 cleanup.sh","action":"立即读取 skills/dev/steps/04-ship.md 并执行 Stage 4 Ship"}'
            fi
            break
        fi

        # ===== 条件 6: CI 通过 + Stage 4 Learning → 执行合并 =====
        local step_4_status
        step_4_status=$(_get_step4_status "$dev_mode_file")
        if [[ "$_harness_mode" != "true" ]] && [[ "$step_4_status" != "done" ]]; then
            result_json=$(_devloop_jq -n --arg pr "$pr_number" \
                '{"status":"blocked","reason":"CI 通过，Stage 4 Ship 未完成（合并前必须先写 Learning）","action":"立即读取 skills/dev/steps/04-ship.md 并执行 Stage 4，写 Learning + 合并 PR #\($pr)。禁止询问用户。"}')
            break
        fi

        # 合并前检查
        local _pms
        _pms=$(gh pr view "$pr_number" --json mergeable,state -q '{m:.mergeable,s:.state}' 2>/dev/null || echo '{}')
        if [[ "$(echo "$_pms" | jq -r '.m' 2>/dev/null)" == "CONFLICTING" ]]; then
            result_json=$(_devloop_jq -n --arg pr "$pr_number" \
                '{"status":"blocked","reason":"PR #\($pr) 存在冲突，需要 rebase","action":"解决冲突后重新 push"}')
            break
        fi
        if [[ "$(echo "$_pms" | jq -r '.s' 2>/dev/null)" != "OPEN" ]]; then
            result_json=$(_devloop_jq -n --arg pr "$pr_number" \
                '{"status":"blocked","reason":"PR #\($pr) 状态非 OPEN","action":"检查 PR 状态"}')
            break
        fi

        # 自动合并
        echo "[devloop-check] PR #$pr_number CI 通过 + Stage 4 完成，自动合并中..." >&2
        if gh pr merge "$pr_number" --squash --delete-branch 2>/dev/null; then
            local _cleanup_script_6=""
            for _cs6 in \
                "${PROJECT_ROOT:-}/packages/engine/skills/dev/scripts/cleanup.sh" \
                "$HOME/.claude/skills/dev/scripts/cleanup.sh" \
                "$HOME/.claude-account1/skills/dev/scripts/cleanup.sh"; do
                [[ -f "$_cs6" ]] && { _cleanup_script_6="$_cs6"; break; }
            done
            if [[ -n "$_cleanup_script_6" ]]; then
                echo "🧹 自动执行 cleanup.sh（合并后清理）..." >&2
                (cd "$(git rev-parse --show-toplevel 2>/dev/null || pwd)" && bash "$_cleanup_script_6") 2>/dev/null || true
            fi
            _mark_cleanup_done "$dev_mode_file"
            result_json=$(_devloop_jq -n --arg pr "$pr_number" \
                '{"status":"done","reason":"PR #\($pr) 已自动合并，工作流结束"}')
        else
            result_json=$(_devloop_jq -n --arg pr "$pr_number" \
                '{"status":"blocked","reason":"PR #\($pr) 自动合并失败","action":"检查冲突或权限问题，执行: gh pr merge \($pr) --squash --delete-branch"}')
        fi
        break
    done

    echo "$result_json"
    return 0
}
```

- [ ] **Step 3: 改 `_mark_cleanup_done` 和 `_increment_and_check_ci_counter` 的参数早退 `return 0` 为 `return`**

Read line 44-78 找：
```bash
_mark_cleanup_done() {
    local f="${1:-}"; [[ -z "$f" || ! -f "$f" ]] && return 0
    ...
```
和：
```bash
_increment_and_check_ci_counter() {
    local f="${1:-}"
    [[ -z "$f" || ! -f "$f" ]] && return 0
    ...
```

把这两处 `return 0` 改成 `return`（无参数，bash 会用上一个命令的 exit code，由 `[[ -z $f || ! -f $f ]] && return` 这种模式 return 是触发于条件成立 → 返回 0；语义不变，但语法上 grep `\breturn 0\b` 不再命中）。

实际编辑：

第一处（约 L45）：
```bash
    local f="${1:-}"; [[ -z "$f" || ! -f "$f" ]] && return 0
```
改为：
```bash
    local f="${1:-}"; [[ -z "$f" || ! -f "$f" ]] && return
```

第二处（约 L63）：
```bash
    [[ -z "$f" || ! -f "$f" ]] && return 0
```
改为：
```bash
    [[ -z "$f" || ! -f "$f" ]] && return
```

- [ ] **Step 4: 跑 12 场景 E2E 全量回归**

Run:
```bash
WT=/Users/administrator/worktrees/cecelia/single-exit-stop-hook
cd "$WT" && npx vitest run packages/engine/tests/e2e/stop-hook-full-lifecycle.test.ts 2>&1 | tail -25
```

Expected: 全部通过（与 Step 1 baseline 一致）

- [ ] **Step 5: 跑 Task 1 integration 测试，确认 classify_session 仍 green**

Run:
```bash
WT=/Users/administrator/worktrees/cecelia/single-exit-stop-hook
bash "$WT/packages/engine/tests/integration/devloop-classify.test.sh"
```

Expected: 8 PASS / 0 FAIL

- [ ] **Step 6: 检查 devloop-check.sh 单一 return 0**

Run:
```bash
WT=/Users/administrator/worktrees/cecelia/single-exit-stop-hook
sed 's/#.*//' "$WT/packages/engine/lib/devloop-check.sh" | grep -cE '\breturn 0\b'
```

Expected: `2`（classify_session 1 个 + devloop_check 1 个；辅助函数已改为 `return` 无参数）

- [ ] **Step 7: commit**

```bash
WT=/Users/administrator/worktrees/cecelia/single-exit-stop-hook
git -C "$WT" add packages/engine/lib/devloop-check.sh
git -C "$WT" commit -m "refactor(engine): devloop_check 单一 return 0 — while:; break 模式（cp-0504114459）

控制流改造：
- devloop_check() 主函数 4 处 return 0 + 11 处 return 2 → 末尾单一 echo + return 0
- 状态由 result_json 的 status 字段携带（done/blocked），不靠控制流分歧
- 辅助函数 _mark_cleanup_done / _increment_and_check_ci_counter 的参数校验 return 0 → return（语义不变，grep 不命中）

业务逻辑一字不动（auto-merge / cleanup.sh / harness 分叉 / Brain 回写 / DoD / CI 等待全保留）。
12 场景 E2E 全量绿灯，integration 8 分支绿灯。
"
```

---

## Task 4: 重构 stop-dev.sh 为单一 exit 0

**Files:**
- Modify: `packages/engine/hooks/stop-dev.sh`（整个文件重写）

- [ ] **Step 1: 整体替换 stop-dev.sh**

写入：

```bash
#!/usr/bin/env bash
# ============================================================================
# stop-dev.sh — 单一 exit 0 出口（v20.0.0）
# ============================================================================
# 入口契约：stop.sh 从 stdin JSON 解析 cwd 并 export CLAUDE_HOOK_CWD
# 业务 SSOT：classify_session（在 devloop-check.sh，封装所有判断到 status 字段）
# 单一出口：全文唯一 1 个 exit 0 在末尾 case，永不在中途散点放行。
# ============================================================================

set -euo pipefail

# ---- 加载 devloop-check SSOT（含 classify_session）-----------------------
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cwd="${CLAUDE_HOOK_CWD:-$PWD}"

devloop_lib=""
_wt_root=$(git -C "$cwd" rev-parse --show-toplevel 2>/dev/null || echo "")
for c in \
    "$_wt_root/packages/engine/lib/devloop-check.sh" \
    "$script_dir/../lib/devloop-check.sh" \
    "$HOME/.claude/lib/devloop-check.sh"; do
    [[ -f "$c" ]] && { devloop_lib="$c"; break; }
done
# shellcheck disable=SC1090
[[ -n "$devloop_lib" ]] && source "$devloop_lib"
command -v jq &>/dev/null || jq() { cat >/dev/null 2>&1; echo '{}'; }

# ---- 单一决策 ------------------------------------------------------------
if ! type classify_session &>/dev/null; then
    result='{"status":"blocked","reason":"classify_session 未加载，fail-closed"}'
else
    result=$(classify_session "$cwd" 2>/dev/null) || true
    [[ -z "$result" ]] && result='{"status":"blocked","reason":"classify_session 无输出，fail-closed"}'
fi

status=$(echo "$result" | jq -r '.status // "blocked"' 2>/dev/null || echo "blocked")

# ---- 单一 case + 单一 exit 0 ---------------------------------------------
case "$status" in
    not-dev|done)
        # done 路径：清理 .dev-mode 文件（透传字段由 classify_session 附加）
        if [[ "$status" == "done" ]]; then
            _dm=$(echo "$result" | jq -r '.dev_mode // ""' 2>/dev/null || echo "")
            [[ -n "$_dm" && -f "$_dm" ]] && rm -f "$_dm"
        fi
        echo "$result"
        exit 0
        ;;
    *)
        # block 路径：附加 action 提示词（保留原 stop-dev v19 的 ⚠️ 立即执行口吻）
        reason=$(echo "$result" | jq -r '.reason // "未知"' 2>/dev/null || echo "未知")
        action=$(echo "$result" | jq -r '.action // ""' 2>/dev/null || echo "")
        run_id=$(echo "$result" | jq -r '.ci_run_id // ""' 2>/dev/null || echo "")
        [[ -n "$action" ]] && reason="${reason}。下一步：${action}。⚠️ 立即执行，禁止询问用户。"

        jq -n --arg r "$reason" --arg id "$run_id" \
          '{"decision":"block","reason":$r,"ci_run_id":$id}'
        exit 2
        ;;
esac
```

- [ ] **Step 2: 跑 12 场景 E2E 全量回归**

Run:
```bash
WT=/Users/administrator/worktrees/cecelia/single-exit-stop-hook
cd "$WT" && npx vitest run packages/engine/tests/e2e/stop-hook-full-lifecycle.test.ts 2>&1 | tail -25
```

Expected: 全部通过

- [ ] **Step 3: 检查 stop-dev.sh 单一 exit 0**

Run:
```bash
WT=/Users/administrator/worktrees/cecelia/single-exit-stop-hook
sed 's/#.*//' "$WT/packages/engine/hooks/stop-dev.sh" | grep -cE '\bexit 0\b'
```

Expected: `1`

- [ ] **Step 4: commit**

```bash
WT=/Users/administrator/worktrees/cecelia/single-exit-stop-hook
git -C "$WT" add packages/engine/hooks/stop-dev.sh
git -C "$WT" commit -m "refactor(engine): stop-dev.sh 单一 exit 0 — case 单点出口（cp-0504114459）

7 处散点 exit 0（bypass / cwd / git rev-parse ×2 / 主分支 / 无 .dev-mode / done）
归一到末尾 case 单一 exit 0。所有判断收敛到 classify_session 返回的 status 字段。

12 场景 E2E 全量绿灯，行为完全保留（PR open/CI/merged/cleanup/harness 各路径同 v19）。
"
```

---

## Task 5: 镜像同步 hooks/stop-dev.sh

**Files:**
- Modify: `hooks/stop-dev.sh`（直接 cp 自 packages/engine/hooks/stop-dev.sh）

- [ ] **Step 1: cp 镜像副本**

Run:
```bash
WT=/Users/administrator/worktrees/cecelia/single-exit-stop-hook
cp "$WT/packages/engine/hooks/stop-dev.sh" "$WT/hooks/stop-dev.sh"
diff -q "$WT/packages/engine/hooks/stop-dev.sh" "$WT/hooks/stop-dev.sh"
```

Expected: 无输出（一致）

- [ ] **Step 2: 检查 hooks/stop-dev.sh 单一 exit 0**

Run:
```bash
WT=/Users/administrator/worktrees/cecelia/single-exit-stop-hook
sed 's/#.*//' "$WT/hooks/stop-dev.sh" | grep -cE '\bexit 0\b'
```

Expected: `1`

- [ ] **Step 3: commit**

```bash
WT=/Users/administrator/worktrees/cecelia/single-exit-stop-hook
git -C "$WT" add hooks/stop-dev.sh
git -C "$WT" commit -m "chore(engine): hooks/stop-dev.sh 镜像同步（单一 exit 0）"
```

---

## Task 6: CI 守护脚本 + 接入 engine-ci.yml

**Files:**
- Create: `scripts/check-single-exit.sh`
- Modify: `.github/workflows/engine-ci.yml`（lint job 增加 step）

- [ ] **Step 1: 创建 check-single-exit.sh**

写入 `scripts/check-single-exit.sh`：

```bash
#!/usr/bin/env bash
# check-single-exit.sh — Stop Hook 单一出口守护
# 永远阻止散点 exit 0 / return 0 复活。
# 触发：CI lint job 调用；本地 push 前可手动跑。

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

ERR=0

check_count() {
    local file="$1" pattern="$2" expected="$3" label="$4"
    if [[ ! -f "$file" ]]; then
        echo "❌ $label: 文件不存在 $file"
        ERR=1
        return
    fi
    # 注释行剔除（# 之后的内容），再 grep
    local count
    count=$(sed 's/#.*//' "$file" | grep -cE "$pattern" || true)
    count="${count:-0}"
    if [[ "$count" -ne "$expected" ]]; then
        echo "❌ $label: '$pattern' 出现 $count 次（期望 $expected）— $file"
        ERR=1
    else
        echo "✅ $label: $count / $expected"
    fi
}

# stop-dev.sh：唯一 1 个 exit 0
check_count "$REPO_ROOT/packages/engine/hooks/stop-dev.sh" '\bexit 0\b' 1 "packages/engine/hooks/stop-dev.sh exit 0"
check_count "$REPO_ROOT/hooks/stop-dev.sh" '\bexit 0\b' 1 "hooks/stop-dev.sh exit 0"

# devloop-check.sh：classify_session 1 个 + devloop_check 1 个 = 共 2 个 return 0
# 辅助函数 _mark_cleanup_done / _increment_and_check_ci_counter 已改为 return（无参数）
check_count "$REPO_ROOT/packages/engine/lib/devloop-check.sh" '\breturn 0\b' 2 "packages/engine/lib/devloop-check.sh return 0"

# 镜像一致性
if ! diff -q "$REPO_ROOT/packages/engine/hooks/stop-dev.sh" "$REPO_ROOT/hooks/stop-dev.sh" >/dev/null 2>&1; then
    echo "❌ packages/engine/hooks/stop-dev.sh 与 hooks/stop-dev.sh 不一致"
    ERR=1
else
    echo "✅ stop-dev.sh 镜像一致"
fi

if [[ "$ERR" -eq 0 ]]; then
    echo ""
    echo "✅ 单一出口检查通过"
    exit 0
fi

echo ""
echo "❌ 单一出口检查失败 — 散点 exit 0 / return 0 复活，禁止合并"
exit 1
```

- [ ] **Step 2: 让脚本可执行**

Run:
```bash
WT=/Users/administrator/worktrees/cecelia/single-exit-stop-hook
chmod +x "$WT/scripts/check-single-exit.sh"
bash "$WT/scripts/check-single-exit.sh"
echo "exit=$?"
```

Expected: 4 个 ✅ + `✅ 单一出口检查通过` + `exit=0`

- [ ] **Step 3: 接入 engine-ci.yml lint job**

Read `.github/workflows/engine-ci.yml` 找到 lint job（含 `lint-test-pairing` / `lint-tdd-commit-order` 等）。在并列位置加一个 job：

```yaml
  lint-single-exit:
    name: 'Lint: Stop Hook 单一出口守护'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Run check-single-exit
        run: bash scripts/check-single-exit.sh
```

具体插入位置：找到现有最后一个 lint job（如 `lint-tdd-commit-order`）的下方紧接着加。

- [ ] **Step 4: 跑 actionlint 验证 yaml 合法**

Run:
```bash
WT=/Users/administrator/worktrees/cecelia/single-exit-stop-hook
command -v actionlint && actionlint "$WT/.github/workflows/engine-ci.yml" || echo "actionlint 未安装，跳过本地校验"
```

- [ ] **Step 5: 跑 integration + E2E 确保不影响**

Run:
```bash
WT=/Users/administrator/worktrees/cecelia/single-exit-stop-hook
bash "$WT/packages/engine/tests/integration/devloop-classify.test.sh"
cd "$WT" && npx vitest run packages/engine/tests/e2e/stop-hook-full-lifecycle.test.ts 2>&1 | tail -10
```

Expected: integration 8 PASS；E2E 全过

- [ ] **Step 6: commit**

```bash
WT=/Users/administrator/worktrees/cecelia/single-exit-stop-hook
git -C "$WT" add scripts/check-single-exit.sh .github/workflows/engine-ci.yml
git -C "$WT" commit -m "feat(engine): CI 守护 — Stop Hook 单一出口检查（cp-0504114459）

- scripts/check-single-exit.sh: 严格 grep 卡 stop-dev.sh exit 0=1、devloop-check.sh return 0=2、镜像一致性
- .github/workflows/engine-ci.yml: lint-single-exit job 接入
"
```

---

## Task 7: Engine 版本 bump（5 文件同步）

**Files:**
- Modify: `packages/engine/package.json`
- Modify: `packages/engine/package-lock.json`（两处版本字段）
- Modify: `packages/engine/VERSION`
- Modify: `hooks/.hook-core-version` 和 `packages/engine/hooks/.hook-core-version`
- Modify: `packages/engine/regression-contract.yaml`

- [ ] **Step 1: 读当前版本**

```bash
WT=/Users/administrator/worktrees/cecelia/single-exit-stop-hook
grep '"version"' "$WT/packages/engine/package.json" | head -1
cat "$WT/packages/engine/VERSION"
cat "$WT/hooks/.hook-core-version"
```

记录当前 X.Y.Z（设为 `OLD_VER`），新版本为 `OLD_VER` 的 minor +1（PATCH 归零），因为这是一个 single-exit 重构（行为级改动，含 CI 守护新增）。

- [ ] **Step 2: 更新 packages/engine/package.json version 字段**

替换 `"version": "OLD_VER"` 为 `"version": "NEW_VER"`。

- [ ] **Step 3: 更新 packages/engine/package-lock.json 两处 version**

第一处：根 `"version"` 字段；第二处：`packages.""."version"` 字段。

- [ ] **Step 4: 更新 packages/engine/VERSION**

```bash
echo "NEW_VER" > "$WT/packages/engine/VERSION"
```

- [ ] **Step 5: 更新 hooks/.hook-core-version 和镜像**

```bash
echo "NEW_VER" > "$WT/hooks/.hook-core-version"
echo "NEW_VER" > "$WT/packages/engine/hooks/.hook-core-version"
```

- [ ] **Step 6: 更新 regression-contract.yaml 顶部版本字段**

Read `packages/engine/regression-contract.yaml` 顶部，找到 `version: OLD_VER` 改为 `version: NEW_VER`。

- [ ] **Step 7: 跑 facts-check 确认版本同步**

```bash
WT=/Users/administrator/worktrees/cecelia/single-exit-stop-hook
cd "$WT" && bash scripts/check-version-sync.sh
```

Expected: 5 文件版本一致 + ✅

- [ ] **Step 8: commit**

```bash
WT=/Users/administrator/worktrees/cecelia/single-exit-stop-hook
git -C "$WT" add packages/engine/package.json packages/engine/package-lock.json packages/engine/VERSION hooks/.hook-core-version packages/engine/hooks/.hook-core-version packages/engine/regression-contract.yaml
git -C "$WT" commit -m "chore(engine): [CONFIG] version bump OLD_VER → NEW_VER（Stop Hook 单一出口）"
```

把 `OLD_VER` `NEW_VER` 替换成实际值。

---

## Task 8: feature-registry.yml changelog + path-views 重生

**Files:**
- Modify: `packages/engine/feature-registry.yml`
- Modify: 若干 `packages/engine/path-views/*.md`（由 generate-path-views.sh 重生）

- [ ] **Step 1: 在 feature-registry.yml 末尾的 changelog 区域追加条目**

Read `packages/engine/feature-registry.yml` 找 changelog/版本历史段，加一条：

```yaml
  - version: NEW_VER
    date: 2026-05-04
    summary: Stop Hook 单一 exit 0 — stop-dev.sh 7 处归 1，devloop-check.sh 4 处 return 0 归 1，新增 classify_session 函数 + CI 守护 check-single-exit.sh
    branch: cp-0504114459-single-exit-stop-hook
```

- [ ] **Step 2: 重生 path-views**

```bash
WT=/Users/administrator/worktrees/cecelia/single-exit-stop-hook
cd "$WT" && bash packages/engine/scripts/generate-path-views.sh
```

- [ ] **Step 3: commit**

```bash
WT=/Users/administrator/worktrees/cecelia/single-exit-stop-hook
git -C "$WT" add packages/engine/feature-registry.yml packages/engine/path-views/
git -C "$WT" commit -m "chore(engine): [CONFIG] feature-registry changelog + path-views 重生 NEW_VER"
```

---

## Task 9: 写 Learning（Stage 4 Ship 前置）

**Files:**
- Create: `docs/learnings/cp-0504114459-single-exit-stop-hook.md`

- [ ] **Step 1: 写 learning（必须含 `### 根本原因` + `### 下次预防` + `- [ ]` checklist）**

写入 `docs/learnings/cp-0504114459-single-exit-stop-hook.md`：

```markdown
# Learning — Stop Hook 单一 exit 0 重构

分支：cp-0504114459-single-exit-stop-hook
日期：2026-05-04
Brain Task：24152bde-41d6-49c4-9344-78f60477e570

## 背景

Stop Hook trio（stop.sh + stop-dev.sh + devloop-check.sh）在 cwd-as-key 切线（4/21）声明"99 commit 终结"后，13 天内又出 5+ 次"再终结"修复（Phase 7.x bash 加固、5/2 v4.6.0 harness 单一 exit 0 等）。表面是 corner case 不断暴露，深层是**散点 exit 0 = 多攻击面**。

### 根本原因

stop-dev.sh 7 处 `exit 0` + devloop-check.sh 4 处 `return 0` = 12 个独立"真停"出口。任何一处误放行就 PR 没合就退场。历史最经典案例：4/21 修的是 stop.sh 一处 session_id 不匹配 → exit 0 早退，导致**所有** dev session 全放行，stop-dev 业务逻辑从未被调用。99 commit 的 fix 全在修 stop-dev 内部 bug，真凶在 stop.sh 第 100 行的散点出口。

### 本次解法

把出口拓扑归一到"全文唯一 1 个 exit 0 / return 0"：
- 新增 `classify_session(cwd)` 函数承载所有"非 dev 上下文"判断（bypass / cwd / git / 主分支 / 无 .dev-mode / 格式异常）
- `devloop_check()` 主函数用 `while :; do ... break; done` 模式收敛多分支到末尾单一 `echo + return 0`，状态由 result_json 的 status 字段携带
- `stop-dev.sh` 退化为 `case "$status"` 单一 exit 0
- 业务逻辑（auto-merge / cleanup.sh / CI 等待 / harness / Brain 回写 / DoD）一字不动

### 下次预防

- [ ] 任何 hook 脚本严禁多于 1 个 `exit 0` / `return 0`，CI lint-single-exit 强制
- [ ] 新增分支判定 → 加新 status 取值 + while:; break 分支，禁止散点 return/exit
- [ ] `_mark_cleanup_done` 这种辅助函数的参数早退用 `return` 不带数字，与"业务出口"语义区分
- [ ] check-single-exit.sh 永久守护：grep 卡死出现次数，永不放宽

## 验证证据

- 12 场景 E2E（packages/engine/tests/e2e/stop-hook-full-lifecycle.test.ts）100% 绿灯
- 8 分支 integration（packages/engine/tests/integration/devloop-classify.test.sh）100% 绿灯
- check-single-exit.sh CI 守护接入 engine-ci.yml lint-single-exit job
```

- [ ] **Step 2: commit learning + 标记 step_4_ship done（由 engine-ship 自动处理，仅在此 commit 文件）**

```bash
WT=/Users/administrator/worktrees/cecelia/single-exit-stop-hook
git -C "$WT" add docs/learnings/cp-0504114459-single-exit-stop-hook.md
git -C "$WT" commit -m "docs: Learning — Stop Hook 单一 exit 0 重构（cp-0504114459）"
```

---

## Self-Review 备注（已做）

1. **Spec 覆盖**：spec 第 6 段"实施顺序"7 步 → 本 plan 拆为 9 task（含 Task 1 写 fail test 红 + Task 9 Learning）。所有验收标准（grep 计数、12 场景、8 分支、CI 守护）都有对应 task。
2. **Placeholder 扫描**：plan 中 `OLD_VER` `NEW_VER` 是占位但**已注明替换为实际值**（Task 7 Step 1 读，后续步骤替换），其他无 TBD。
3. **Type 一致性**：`classify_session` / `result_json` / `status` 字段名在 task 间一致；`return 0` / `exit 0` 计数与 Task 6 守护正则匹配（`\bexit 0\b` / `\breturn 0\b`，sed 剔除注释）。
4. **风险核对**：Task 3 改 `_mark_cleanup_done` `_increment_and_check_ci_counter` 的 `return 0` → `return`，语义不变（条件成立时上一个命令是 `[[ ... ]]`，触发于 true 即 exit 0；语法上 grep 不再命中）。
