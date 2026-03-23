#!/usr/bin/env bash
# ============================================================================
# verify-step.sh — /dev 步骤完成验证（State Machine 强制层）v1.0.0
# ============================================================================
# 由 branch-protect.sh 在 AI 向 .dev-mode 写入 step_N: done 时调用。
# 验证 AI 自报的步骤完成情况是否有真实证据支撑。
#
# 用法：
#   bash verify-step.sh step1 [BRANCH] [PROJECT_ROOT]
#   bash verify-step.sh step2 [BRANCH] [PROJECT_ROOT]
#   bash verify-step.sh step4 [BRANCH] [PROJECT_ROOT]
#
# 返回值：
#   0 = 验证通过
#   1 = 验证失败（具体错误输出到 stderr）
#
# 版本: v1.0.0
# 创建: 2026-03-18
# ============================================================================

set -euo pipefail

STEP="${1:-}"
BRANCH="${2:-$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")}"
PROJECT_ROOT="${3:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"

if [[ -z "$STEP" ]]; then
    echo "用法: verify-step.sh <step1|step2|step4> [BRANCH] [PROJECT_ROOT]" >&2
    exit 1
fi

# ============================================================================
# 执行日志记录器（source）
# ============================================================================
_EXEC_LOGGER="$PROJECT_ROOT/packages/engine/lib/execution-logger.sh"
if [[ -f "$_EXEC_LOGGER" ]]; then
    source "$_EXEC_LOGGER"
fi

# ============================================================================
# 工具函数
# ============================================================================

_fail() {
    # 记录执行日志
    if command -v _devlog_event &>/dev/null; then
        _devlog_event "verify-step" "$STEP" "fail" "$1"
    fi
    echo "" >&2
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
    echo "  ❌ [STATE MACHINE] Step 验证失败" >&2
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
    echo "" >&2
    echo "$1" >&2
    echo "" >&2
    exit 1
}

_pass() {
    # 记录执行日志
    if command -v _devlog_event &>/dev/null; then
        _devlog_event "verify-step" "$STEP" "pass" "$1"
    fi
    echo "  ✅ [STATE MACHINE] $1 验证通过" >&2
    # 写入验签到 .dev-seal.${BRANCH}（供 Stop Hook 三层兜底检查）
    if [[ -n "${PROJECT_ROOT:-}" && -n "${BRANCH:-}" ]]; then
        local _seal_file="$PROJECT_ROOT/.dev-seal.${BRANCH}"
        local _ts
        _ts=$(TZ=Asia/Shanghai date +%Y-%m-%dT%H:%M:%S+08:00 2>/dev/null || date -u +%Y-%m-%dT%H:%M:%SZ)
        # seal key 映射：STEP 变量值 → stop-dev.sh _SEALED_STEPS 期望的 key 名
        local _seal_key
        case "$STEP" in
            step1) _seal_key="step_1_spec_seal" ;;
            step2) _seal_key="step_2_code_seal" ;;
            step4) _seal_key="step_4_ship_seal" ;;
            *)     _seal_key="${STEP}_seal" ;;
        esac
        echo "${_seal_key}: verified@${_ts}" >> "$_seal_file" 2>/dev/null || true
        echo "  🔏 验签已写入: ${_seal_key} → .dev-seal.${BRANCH}" >&2
    fi
}

# ============================================================================
# manual: 命令白名单检查（Gate 1b）
# ============================================================================

check_manual_whitelist() {
    local card_path="$1"
    [[ -z "$card_path" || ! -f "$card_path" ]] && return 0

    # 查找 check-manual-cmd-whitelist.cjs（相对于 PROJECT_ROOT）
    local whitelist_script="$PROJECT_ROOT/packages/engine/scripts/devgate/check-manual-cmd-whitelist.cjs"
    if [[ ! -f "$whitelist_script" ]]; then
        echo "  ⏭ [Gate 1b] check-manual-cmd-whitelist.cjs 未找到，跳过白名单检查" >&2
        return 0
    fi

    echo "  🔍 [Gate 1b] manual: 命令白名单检查..." >&2
    local output
    local exit_code=0
    output=$(cd "$PROJECT_ROOT" && node "$whitelist_script" "$card_path" 2>&1) || exit_code=$?

    if [[ $exit_code -ne 0 ]]; then
        _fail "Gate 1b: manual: 命令白名单检查失败
$output

  CI 白名单仅允许：node / npm / curl / bash / psql
  修复：将非白名单命令改写为 manual:node -e \"...\" 形式
  示例：
    ❌ Test: manual:grep -c 'pattern' file
    ✅ Test: manual:node -e \"const c=require('fs').readFileSync('file','utf8');if(!c.includes('pattern'))process.exit(1)\""
    fi

    echo "  ✅ [Gate 1b] manual: 命令白名单检查通过" >&2
}

# ============================================================================
# Step 1 验证：Task Card DoD Test 字段无假命令
# ============================================================================
verify_step1() {
    local task_card=""

    if [[ -n "$BRANCH" ]]; then
        task_card="$PROJECT_ROOT/.task-${BRANCH}.md"
    fi

    if [[ -z "$task_card" || ! -f "$task_card" ]]; then
        task_card=$(find "$PROJECT_ROOT" -maxdepth 1 -name ".task-cp-*.md" 2>/dev/null | head -1 || echo "")
    fi

    if [[ -z "$task_card" || ! -f "$task_card" ]]; then
        _fail "找不到 Task Card 文件（.task-${BRANCH}.md）
  请先完成 Stage 1 Spec，再标记 step_1_spec: done"
    fi

    local test_lines
    test_lines=$(grep -E '^\s+Test:' "$task_card" 2>/dev/null || echo "")

    if [[ -z "$test_lines" ]]; then
        _fail "Task Card 中没有找到任何 Test: 字段
  文件: $task_card
  每个 DoD 条目必须有对应的 Test: 命令（不能是 TODO）"
    fi

    if echo "$test_lines" | grep -qE "Test:[[:space:]]*TODO" 2>/dev/null; then
        _fail "Task Card 存在 Test: TODO 未填写
  文件: $task_card
  Step 1 完成前必须填写所有 Test: 命令"
    fi

    # 检查假命令模式（本地快速检测，CI 通过 check-fake-dod-tests.cjs 全量检测）
    local found_fake
    found_fake=$(echo "$test_lines" | grep -E 'Test:\s*(manual:)?(echo |ls( |$)|cat |test -f|true$|exit 0|printf |wc )|Test:.*\|[[:space:]]*wc' 2>/dev/null || echo "")

    if [[ -n "$found_fake" ]]; then
        _fail "Task Card 包含假 Test 命令（不验证真实行为）：
$found_fake
  禁止的假命令：echo / ls / cat / test -f / true / exit 0 / printf / wc / grep|wc
  正确示例：
    Test: manual:node -e \"const c=require('fs').readFileSync('file','utf8');if(!c.includes('X'))process.exit(1)\"
    Test: tests/my.test.ts
    Test: contract:my-behavior"
    fi

    # Gate 1: CI 镜像 — Stage 1 跳过完整 DoD 检查（未勾选项在 Stage 1 是预期的）
    # Stage 1 只写 Spec/DoD 条目，验证在 Stage 2 做。CI L1 会在 push 后做完整检查。
    echo "  ⏭ [Gate 1] Stage 1 跳过 DoD 完整检查（CI L1 将在 push 后检查）" >&2

    # Gate 1b: manual: 命令白名单检查（本地前置拦截）
    check_manual_whitelist "$task_card"

    _pass "Step 1 Task Card 验证通过"
}

# ============================================================================
# Step 2 验证：代码已写，有实现文件改动
# ============================================================================
verify_step2() {
    local base_branch="main"
    # 此仓库无 develop 分支，固定使用 main

    local changed_files=""
    changed_files=$(git diff --name-only "origin/${base_branch}...HEAD" 2>/dev/null || \
                    git diff --name-only "${base_branch}...HEAD" 2>/dev/null || \
                    git diff --name-only HEAD~1 2>/dev/null || echo "")

    if [[ -z "$changed_files" ]]; then
        _fail "当前分支没有任何代码改动
  分支: $BRANCH
  Step 2 完成前必须有实际的代码提交"
    fi

    # 排除纯文档/配置文件，检查是否有实现代码改动
    local impl_files
    impl_files=$(echo "$changed_files" | grep -vE '^docs/|^\.prd|^\.dod|^\.task|^\.dev-mode|^\.history/' 2>/dev/null || echo "")

    if [[ -z "$impl_files" ]]; then
        _fail "当前分支只有文档/配置改动，没有实现代码
  分支: $BRANCH
  Step 2 完成前必须有实际的实现文件改动（.js/.ts/.sh/.cjs 等）"
    fi

    # Gate 0a: PRESERVE 基线快照检查
    local task_card_early=""
    if [[ -n "$BRANCH" ]]; then
        task_card_early="$PROJECT_ROOT/.task-${BRANCH}.md"
    fi
    if [[ -z "$task_card_early" || ! -f "$task_card_early" ]]; then
        task_card_early=$(find "$PROJECT_ROOT" -maxdepth 1 -name ".task-cp-*.md" 2>/dev/null | head -1 || echo "")
    fi

    if [[ -n "$task_card_early" && -f "$task_card_early" ]]; then
        local preserve_count
        preserve_count=$(grep -c '^\s*-\s*\[.\]\s*\[PRESERVE\]' "$task_card_early" 2>/dev/null || echo 0)
        if [[ "$preserve_count" -eq 0 ]]; then
            _fail "Gate 0a: Task Card 缺少 [PRESERVE] 行为快照条目
  文件: $task_card_early
  要求：Task Card 验收条件中至少有 1 条 [PRESERVE] 条目
  作用：记录改动前的系统行为基线，防止无意识破坏现有功能"
        fi
        echo "  ✅ [Gate 0a] PRESERVE 基线快照: ${preserve_count} 条" >&2
    else
        echo "  ⚠️  [Gate 0a] 未找到 Task Card，跳过 PRESERVE 检查" >&2
    fi

    # Gate 0b: TDD 红灯确认检查
    local dev_mode_file="$PROJECT_ROOT/.dev-mode.${BRANCH}"
    if [[ -f "$dev_mode_file" ]]; then
        if ! grep -q "^tdd_red_confirmed:" "$dev_mode_file" 2>/dev/null; then
            _fail "Gate 0b: TDD 红灯未确认
  文件: $dev_mode_file
  要求：.dev-mode 中必须有 tdd_red_confirmed: 行
  作用：确保写代码前已先跑失败测试（红灯），遵循 TDD 原则
  修复：在 .dev-mode 文件中追加 'tdd_red_confirmed: true'"
        fi
        echo "  ✅ [Gate 0b] TDD 红灯已确认" >&2
    else
        echo "  ⚠️  [Gate 0b] .dev-mode 文件不存在，跳过 TDD 确认检查" >&2
    fi

    # Gate 0c: 垃圾清理检查（console.log / debugger）
    local garbage_found=0
    local garbage_files=()
    while IFS= read -r fpath; do
        [[ -z "$fpath" ]] && continue
        # 跳过测试文件、.md 文件、verify-step.sh 自身
        [[ "$fpath" =~ \.(test|spec)\. ]] && continue
        [[ "$fpath" =~ \.md$ ]] && continue
        [[ "$fpath" =~ verify-step\.sh$ ]] && continue
        local full_path="$PROJECT_ROOT/$fpath"
        [[ ! -f "$full_path" ]] && continue
        # 只检查 diff 中新增的行（'+' 开头，非 '++'），不扫描整个文件
        # 避免误报预存在的结构化日志（如 executor.js 含大量 console.log）
        local diff_added=""
        diff_added=$(git diff "origin/${base_branch}...HEAD" -- "$fpath" 2>/dev/null || \
                     git diff "${base_branch}...HEAD" -- "$fpath" 2>/dev/null || echo "")
        if echo "$diff_added" | grep -qE '^\+\s*console\.log\s*\(|^\+\s*debugger\s*;?' 2>/dev/null; then
            garbage_files+=("$fpath")
            garbage_found=1
        fi
    done <<< "$impl_files"

    if [[ $garbage_found -ne 0 ]]; then
        _fail "Gate 0c: 变更文件含调试垃圾代码
  文件: ${garbage_files[*]}
  禁止内容：console.log() 调用、debugger 语句
  要求：提交前必须清理所有调试代码
  修复：删除上述文件中的 console.log 和 debugger"
    fi
    echo "  ✅ [Gate 0c] 垃圾清理检查通过（无 console.log/debugger）" >&2

    # Gate 0d: 周边一致性扫描（同目录文件引用被改模块的旧版本号）
    local consistency_issues=()
    local version_files
    version_files=$(echo "$impl_files" | grep -E '(package\.json|VERSION|\.hook-core-version)$' 2>/dev/null || echo "")
    if [[ -n "$version_files" ]]; then
        while IFS= read -r vfile; do
            [[ -z "$vfile" ]] && continue
            local full_vpath="$PROJECT_ROOT/$vfile"
            [[ ! -f "$full_vpath" ]] && continue
            local new_ver
            new_ver=$(grep -oE '"version"\s*:\s*"[^"]+"' "$full_vpath" 2>/dev/null | head -1 | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' || echo "")
            [[ -z "$new_ver" ]] && new_ver=$(cat "$full_vpath" 2>/dev/null | grep -oE '^[0-9]+\.[0-9]+\.[0-9]+' | head -1 || echo "")
            if [[ -n "$new_ver" ]]; then
                local vdir
                vdir=$(dirname "$full_vpath")
                while IFS= read -r sf; do
                    [[ "$sf" == "$full_vpath" ]] && continue
                    # 只检查已知版本同步文件（跳过独立版本体系如 skills-registry.json）
                    local _sf_base
                    _sf_base=$(basename "$sf")
                    [[ "$_sf_base" =~ ^(package\.json|package-lock\.json|regression-contract\.yaml)$ ]] || continue
                    local sv
                    sv=$(grep -oE '"version"\s*:\s*"[^"]+"' "$sf" 2>/dev/null | head -1 | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' || echo "")
                    if [[ -n "$sv" && "$sv" != "$new_ver" ]]; then
                        consistency_issues+=("sibling $sf 版本($sv) 与 $vfile 版本($new_ver) 不一致")
                    fi
                done < <(find "$vdir" -maxdepth 1 \( -name "*.json" -o -name "*.yaml" -o -name "*.yml" \) 2>/dev/null)
            fi
        done <<< "$version_files"
    fi

    if [[ ${#consistency_issues[@]} -gt 0 ]]; then
        _fail "Gate 0d: 周边一致性检查失败
  发现同目录文件引用旧版本号（sibling consistency violation）：
$(printf '  %s\n' "${consistency_issues[@]}")
  要求：修改模块时，同目录下引用该模块版本号的文件必须同步更新"
    fi
    echo "  ✅ [Gate 0d] 周边一致性扫描通过" >&2

    # 检查是否有测试文件（仅警告）
    local test_files
    test_files=$(echo "$changed_files" | grep -E '\.(test|spec)\.(ts|js|mjs|cjs|tsx|jsx)$|/__tests__/' 2>/dev/null || echo "")

    if [[ -z "$test_files" ]]; then
        echo "  ⚠️  [STATE MACHINE] 警告：分支没有测试文件改动" >&2
        echo "     Shell 脚本/Engine 配置任务可继续" >&2
        echo "     功能代码任务应先补充测试" >&2
    fi

    # Gate 1: CI 镜像 — 检查所有有变更的 packages（不硬编码 engine）
    local changed_pkgs
    changed_pkgs=$(echo "$changed_files" | grep "^packages/" | cut -d'/' -f2 | sort -u 2>/dev/null || echo "")

    if [[ -n "$changed_pkgs" ]]; then
        echo "  🔍 [Gate 1] 检测到变更 packages: $(echo $changed_pkgs | tr '\n' ' ')" >&2
        local gate1_failed=0
        for _pkg in $changed_pkgs; do
            local _pkg_dir="$PROJECT_ROOT/packages/$_pkg"
            if [[ ! -d "$_pkg_dir" || ! -f "$_pkg_dir/package.json" ]]; then
                continue
            fi
            local _has_test
            _has_test=$(node -e "try{const p=require('$_pkg_dir/package.json');console.log(p.scripts&&p.scripts.test?'yes':'no')}catch(e){console.log('no')}" 2>/dev/null || echo "no")
            if [[ "$_has_test" != "yes" ]]; then
                echo "  ⏭  [Gate 1] $_pkg: 无 test script，跳过" >&2
                continue
            fi
            echo "  🔍 [Gate 1] 运行 $_pkg npm test..." >&2
            if ! (cd "$_pkg_dir" && npm test 2>&1); then
                echo "  ❌ [Gate 1] $_pkg 测试失败" >&2
                gate1_failed=1
            else
                echo "  ✅ [Gate 1] $_pkg 测试通过" >&2
            fi
        done
        if [[ $gate1_failed -ne 0 ]]; then
            _fail "Gate 1 失败：有 package 测试不通过
  请分别进入对应 package 目录运行 npm test 查看详情。"
        fi
    else
        echo "  ⏭  [Gate 1] 无 packages/ 变更，跳过 Gate 1" >&2
    fi

    # Gate 2: DoD 逐条执行 — 读 Task Card 中所有 [BEHAVIOR] 条目的 Test 命令并执行
    local task_card=""
    if [[ -n "$BRANCH" ]]; then
        task_card="$PROJECT_ROOT/.task-${BRANCH}.md"
    fi
    if [[ -z "$task_card" || ! -f "$task_card" ]]; then
        task_card=$(find "$PROJECT_ROOT" -maxdepth 1 -name ".task-cp-*.md" 2>/dev/null | head -1 || echo "")
    fi

    if [[ -z "$task_card" || ! -f "$task_card" ]]; then
        echo "  ⚠️  [Gate 2] 未找到 Task Card，跳过 DoD 逐条验证" >&2
    else
        echo "  🔍 [Gate 2] 逐条执行 DoD [BEHAVIOR] Test 命令..." >&2
        echo "  Task Card: $task_card" >&2

        local DOD_TOTAL=0
        local DOD_PASSED=0
        local DOD_FAILED=0
        local DOD_DEFERRED=0
        local FAILED_ITEMS=()

        local IN_DOD=false
        local DOD_TYPE=""
        local BEHAVIOR_DESC=""
        local CURRENT_LINE=0
        local DOD_ITEM_LINE=0

        while IFS= read -r line; do
            CURRENT_LINE=$((CURRENT_LINE + 1))
            # 检测新条目行（重置状态）
            if echo "$line" | grep -qE '^\s*-\s+\[(x| )\]\s+\['; then
                IN_DOD=false
                DOD_TYPE=""
                BEHAVIOR_DESC=""
                DOD_ITEM_LINE=$CURRENT_LINE

                if echo "$line" | grep -qE '^\s*-\s+\[(x| )\]\s+\[BEHAVIOR\]'; then
                    IN_DOD=true
                    DOD_TYPE="BEHAVIOR"
                    BEHAVIOR_DESC=$(echo "$line" | sed 's/^[[:space:]]*-[[:space:]]*\[.\][[:space:]]*\[BEHAVIOR\][[:space:]]*//')
                elif echo "$line" | grep -qE '^\s*-\s+\[(x| )\]\s+\[ARTIFACT\]'; then
                    IN_DOD=true
                    DOD_TYPE="ARTIFACT"
                    BEHAVIOR_DESC=$(echo "$line" | sed 's/^[[:space:]]*-[[:space:]]*\[.\][[:space:]]*\[ARTIFACT\][[:space:]]*//')
                elif echo "$line" | grep -qE '^\s*-\s+\[(x| )\]\s+\[GATE\]'; then
                    IN_DOD=true
                    DOD_TYPE="GATE"
                    BEHAVIOR_DESC=$(echo "$line" | sed 's/^[[:space:]]*-[[:space:]]*\[.\][[:space:]]*\[GATE\][[:space:]]*//')
                elif echo "$line" | grep -qE '^\s*-\s+\[(x| )\]\s+\[PRESERVE\]'; then
                    IN_DOD=true
                    DOD_TYPE="PRESERVE"
                    BEHAVIOR_DESC=$(echo "$line" | sed 's/^[[:space:]]*-[[:space:]]*\[.\][[:space:]]*\[PRESERVE\][[:space:]]*//')
                fi
                continue
            fi

            # 在 DoD 条目内（[BEHAVIOR]/[ARTIFACT]/[GATE]）：检测 Test: 行
            if [[ "$IN_DOD" == true ]]; then
                if echo "$line" | grep -qE '^[[:space:]]+Test:[[:space:]]+'; then
                    local TEST_REF
                    TEST_REF=$(echo "$line" | sed 's/^[[:space:]]*Test:[[:space:]]*//')
                    DOD_TOTAL=$((DOD_TOTAL + 1))

                    echo "  [$DOD_TYPE] $BEHAVIOR_DESC" >&2
                    echo "  Test: $TEST_REF" >&2

                    # DEFERRED: contract:（合约验证，跳过执行）
                    if echo "$TEST_REF" | grep -qE '^contract:'; then
                        echo "  ⏭  DEFERRED (合约验证，跳过执行)" >&2
                        DOD_DEFERRED=$((DOD_DEFERRED + 1))
                        echo "" >&2
                        IN_DOD=false
                        continue
                    fi

                    # DEFERRED: manual:curl（需要服务）
                    if echo "$TEST_REF" | grep -qE '^manual:curl\b'; then
                        echo "  ⏭  DEFERRED (需要运行服务: curl)" >&2
                        DOD_DEFERRED=$((DOD_DEFERRED + 1))
                        echo "" >&2
                        IN_DOD=false
                        continue
                    fi

                    # tests/<path> → 检查文件存在性
                    if echo "$TEST_REF" | grep -qE '^tests/'; then
                        local TEST_PATH="$PROJECT_ROOT/$TEST_REF"
                        if [[ -f "$TEST_PATH" ]]; then
                            echo "  ✅ PASS (文件存在: $TEST_REF)" >&2
                            DOD_PASSED=$((DOD_PASSED + 1))
                            # 写回 [x]：状态机与 CI 同步（dod_complete）
                            if [[ $DOD_ITEM_LINE -gt 0 ]]; then
                                local _tmp; _tmp=$(mktemp)
                                awk -v n="$DOD_ITEM_LINE" 'NR==n{sub(/- \[ \] \[/, "- [x] [")}1' "$task_card" > "$_tmp" && mv "$_tmp" "$task_card"
                            fi
                        else
                            echo "  ❌ FAIL (文件不存在: $TEST_REF)" >&2
                            DOD_FAILED=$((DOD_FAILED + 1))
                            FAILED_ITEMS+=("[$DOD_TYPE] $BEHAVIOR_DESC → 文件不存在: $TEST_REF")
                        fi
                        echo "" >&2
                        IN_DOD=false
                        continue
                    fi

                    # manual:<cmd> → 提取并执行命令
                    if echo "$TEST_REF" | grep -qE '^manual:'; then
                        local CMD
                        CMD=$(echo "$TEST_REF" | sed 's/^manual://')

                        # 服务依赖命令跳过
                        if echo "$CMD" | grep -qE '\bcurl\b|\bchrome\b|\bselenium\b|\bpuppeteer\b'; then
                            echo "  ⏭  DEFERRED (需要外部服务)" >&2
                            DOD_DEFERRED=$((DOD_DEFERRED + 1))
                            echo "" >&2
                            IN_DOD=false
                            continue
                        fi

                        set +e
                        local OUTPUT
                        OUTPUT=$(cd "$PROJECT_ROOT" && eval "$CMD" 2>&1)
                        local EXIT_CODE=$?
                        set -e

                        if [[ $EXIT_CODE -eq 0 ]]; then
                            echo "  ✅ PASS (exit 0)" >&2
                            if [[ -n "$OUTPUT" ]]; then
                                echo "  输出: $(echo "$OUTPUT" | head -2)" >&2
                            fi
                            DOD_PASSED=$((DOD_PASSED + 1))
                            # 写回 [x]：状态机与 CI 同步（dod_complete）
                            if [[ $DOD_ITEM_LINE -gt 0 ]]; then
                                local _tmp; _tmp=$(mktemp)
                                awk -v n="$DOD_ITEM_LINE" 'NR==n{sub(/- \[ \] \[/, "- [x] [")}1' "$task_card" > "$_tmp" && mv "$_tmp" "$task_card"
                            fi
                        else
                            echo "  ❌ FAIL (exit $EXIT_CODE)" >&2
                            if [[ -n "$OUTPUT" ]]; then
                                echo "  输出: $(echo "$OUTPUT" | head -3)" >&2
                            fi
                            DOD_FAILED=$((DOD_FAILED + 1))
                            FAILED_ITEMS+=("[$DOD_TYPE] $BEHAVIOR_DESC → exit $EXIT_CODE: $CMD")
                        fi
                        echo "" >&2
                        IN_DOD=false
                        continue
                    fi

                    # 未匹配格式：DEFERRED
                    echo "  ⏭  DEFERRED (未知格式，跳过: $TEST_REF)" >&2
                    DOD_DEFERRED=$((DOD_DEFERRED + 1))
                    echo "" >&2
                    IN_DOD=false
                fi
            fi
        done < "$task_card"

        # 汇总
        echo "  ─── Gate 2 DoD 执行汇总 ───" >&2
        echo "  [BEHAVIOR]/[ARTIFACT]/[GATE] Test 总数: $DOD_TOTAL" >&2
        echo "  ✅ 通过: $DOD_PASSED" >&2
        echo "  ⏭  延迟: $DOD_DEFERRED" >&2
        echo "  ❌ 失败: $DOD_FAILED" >&2

        if [[ $DOD_FAILED -gt 0 ]]; then
            local fail_detail=""
            for item in "${FAILED_ITEMS[@]}"; do
                fail_detail="${fail_detail}
  ❌ $item"
            done
            _fail "Gate 2 失败：DoD Test 未通过（${DOD_FAILED}/${DOD_TOTAL} 条失败）
  请修复代码使所有 DoD Test 通过后重新执行 Step 2。
${fail_detail}"
        fi

        if [[ $DOD_TOTAL -gt 0 ]]; then
            echo "  ✅ [Gate 2] DoD Test 全部通过（[BEHAVIOR]/[ARTIFACT]/[GATE]）" >&2
        else
            echo "  ⚠️  [Gate 2] Task Card 无可执行 DoD 条目，跳过" >&2
        fi
    fi

    _pass "Step 2 代码改动验证通过"
}

# ============================================================================
# Step 4 验证：Learning 文件有必需章节
# ============================================================================
verify_step4() {
    local learning_dir="$PROJECT_ROOT/docs/learnings"
    local learning_file=""

    if [[ -n "$BRANCH" ]]; then
        learning_file="$learning_dir/${BRANCH}.md"
    fi

    if [[ -z "$learning_file" || ! -f "$learning_file" ]]; then
        if [[ -n "$BRANCH" ]]; then
            local branch_prefix
            branch_prefix=$(echo "$BRANCH" | cut -c1-30)
            learning_file=$(find "$learning_dir" -name "cp-*.md" 2>/dev/null | grep "$branch_prefix" | head -1 || echo "")
        fi
    fi

    if [[ -z "$learning_file" || ! -f "$learning_file" ]]; then
        _fail "找不到 Learning 文件
  期望路径: docs/learnings/${BRANCH}.md
  Step 4 完成前必须创建 Learning 文件

  文件必须包含：
    ### 根本原因
    ### 下次预防
    - [ ] 预防措施"
    fi

    local content
    content=$(cat "$learning_file" 2>/dev/null || echo "")

    local errors=""
    if ! echo "$content" | grep -qE '^#{2,3}[[:space:]]+根本原因'; then
        errors="${errors}
  ❌ 缺少 '### 根本原因' 章节"
    fi
    if ! echo "$content" | grep -qE '^#{2,3}[[:space:]]+下次预防'; then
        errors="${errors}
  ❌ 缺少 '### 下次预防' 章节"
    fi

    if [[ -n "$errors" ]]; then
        _fail "Learning 文件格式不完整：
  文件: $learning_file
$errors"
    fi

    if ! echo "$content" | grep -qE '^\s*-\s*\[[ x]\]'; then
        _fail "Learning 文件的 '### 下次预防' 缺少 checklist（- [ ] 格式）
  文件: $learning_file"
    fi

    _pass "Step 4 Learning 文件验证通过"
}

# ============================================================================
# 主入口
# ============================================================================
case "$STEP" in
    step1) verify_step1 ;;
    step2) verify_step2 ;;
    step4) verify_step4 ;;
    *)
        echo "未知的步骤: ${STEP}（支持: step1, step2, step4）" >&2
        exit 1
        ;;
esac
