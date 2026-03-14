#!/usr/bin/env bash
# ============================================================================
# /dev 健康检查脚本 v1.0.0
# ============================================================================
# 验证 /dev 工作流的核心机制是否正常：
#   1. Hook 语法检查（stop.sh、branch-protect.sh）
#   2. Stop Hook 无锁文件 exit 0（快速路径）
#   3. .dev-lock 格式必填字段验证
#   4. Step 00 包含 .dev-lock 重建逻辑
#   5. required-dev-paths 包含关键路径
#
# 使用方式:
#   bash packages/engine/scripts/test-dev-health.sh
#
# exit 0 = 全部通过
# exit 1 = 有检查失败
# ============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENGINE_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PROJECT_ROOT="$(cd "$ENGINE_ROOT/../.." && pwd)"

PASS=0
FAIL=0
ERRORS=()

pass() { echo "  ✅ $1"; PASS=$((PASS + 1)); }
fail() { echo "  ❌ $1"; FAIL=$((FAIL + 1)); ERRORS+=("$1"); }
section() { echo ""; echo "━━ $1 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"; }

echo "🔍 /dev 健康检查 v1.0.0"
echo "   Engine: $ENGINE_ROOT"
echo "   Project: $PROJECT_ROOT"

# ─── 1. Hook 语法检查 ──────────────────────────────────────────────────────
section "1. Hook 语法检查"

HOOKS=(
    "$ENGINE_ROOT/hooks/stop.sh"
    "$ENGINE_ROOT/hooks/stop-dev.sh"
    "$ENGINE_ROOT/hooks/branch-protect.sh"
    "$ENGINE_ROOT/hooks/bash-guard.sh"
)

for hook in "${HOOKS[@]}"; do
    name=$(basename "$hook")
    if [[ ! -f "$hook" ]]; then
        fail "$name 文件不存在: $hook"
        continue
    fi
    if bash -n "$hook" 2>/dev/null; then
        pass "$name 语法正确"
    else
        fail "$name 语法错误"
        bash -n "$hook" 2>&1 | head -5 | sed 's/^/    /'
    fi
done

# ─── 2. Stop Hook 无锁文件 exit 0（快速路径）──────────────────────────────
section "2. Stop Hook 无锁文件 exit 0 验证"

TMPDIR_TEST=$(mktemp -d)
# 创建一个临时 git 仓库（无 .dev-lock 文件）
git -C "$TMPDIR_TEST" init -q
git -C "$TMPDIR_TEST" commit --allow-empty -m "init" -q

# 在临时目录运行 stop.sh — 无 .dev-lock.* 文件应该 exit 0
cd "$TMPDIR_TEST"
if bash "$ENGINE_ROOT/hooks/stop.sh" > /dev/null 2>&1; then
    pass "stop.sh 无锁文件时 exit 0（正确）"
else
    EXIT_CODE=$?
    fail "stop.sh 无锁文件时 exit $EXIT_CODE（期望 exit 0）"
fi
cd "$PROJECT_ROOT"
rm -rf "$TMPDIR_TEST"

# ─── 3. .dev-lock 格式验证 ────────────────────────────────────────────────
section "3. .dev-lock 必填字段验证"

LOCK_FILES=()
while IFS= read -r -d '' f; do LOCK_FILES+=("$f"); done < <(find "$PROJECT_ROOT" -maxdepth 1 -name '.dev-lock.*' -print0 2>/dev/null || true)
if [[ ${#LOCK_FILES[@]} -eq 0 ]]; then
    echo "  ℹ️  当前无活跃 .dev-lock 文件（新环境，跳过格式验证）"
else
    for lock_file in "${LOCK_FILES[@]}"; do
        [[ -f "$lock_file" ]] || continue
        lock_name=$(basename "$lock_file")

        # 必填字段
        REQUIRED_FIELDS=("branch:" "provider:")
        ALL_GOOD=true
        for field in "${REQUIRED_FIELDS[@]}"; do
            if ! grep -q "^${field}" "$lock_file" 2>/dev/null; then
                fail "$lock_name 缺少必填字段: $field"
                ALL_GOOD=false
            fi
        done
        [[ "$ALL_GOOD" == "true" ]] && pass "$lock_name 格式正确（含必填字段）"
    done
fi

# ─── 4. Step 00 包含 .dev-lock 重建逻辑 ──────────────────────────────────
section "4. Step 00 .dev-lock 重建逻辑验证"

STEP_00="$ENGINE_ROOT/skills/dev/steps/00-worktree-auto.md"
if [[ ! -f "$STEP_00" ]]; then
    fail "Step 00 文件不存在: $STEP_00"
else
    # 检查重建逻辑关键词
    if grep -q "dev-lock.*重建\|重建.*dev-lock\|auto.*rebuild\|cp.*dev-mode.*dev-lock\|dev-lock.*丢失" "$STEP_00" 2>/dev/null; then
        pass "Step 00 包含 .dev-lock 重建逻辑"
    else
        fail "Step 00 缺少 .dev-lock 重建逻辑（context 恢复场景无法自动修复）"
    fi

    # 检查版本号是否已更新（应该 >= 2.2.0）
    VERSION=$(grep "^version:" "$STEP_00" | head -1 | awk '{print $2}')
    MAJOR=$(echo "$VERSION" | cut -d. -f1)
    MINOR=$(echo "$VERSION" | cut -d. -f2)
    if [[ "$MAJOR" -gt 2 ]] || [[ "$MAJOR" -eq 2 && "$MINOR" -ge 2 ]]; then
        pass "Step 00 版本 v${VERSION} >= v2.2.0"
    else
        fail "Step 00 版本 v${VERSION} 过旧（需要 >= v2.2.0 含重建逻辑）"
    fi
fi

# ─── 5. required-dev-paths 关键路径覆盖 ──────────────────────────────────
section "5. 高风险路径覆盖验证"

PATHS_CONFIG="$ENGINE_ROOT/config/required-dev-paths.yml"
if [[ ! -f "$PATHS_CONFIG" ]]; then
    fail "required-dev-paths.yml 不存在"
else
    check_one_path() {
        local path_to_check="$1"
        if grep -q "$path_to_check" "$PATHS_CONFIG" 2>/dev/null; then
            pass "高风险路径已覆盖: $path_to_check"
        else
            fail "高风险路径未覆盖: $path_to_check（/dev 改动此路径时 CI 不会强制要求证据）"
        fi
    }
    check_one_path "packages/engine/hooks/"
    check_one_path "packages/engine/skills/dev/"
    check_one_path ".github/workflows/"
    check_one_path "packages/engine/scripts/devgate/"
fi

# ─── 总结 ─────────────────────────────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  /dev 健康检查结果：通过 $PASS / 失败 $FAIL"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if [[ $FAIL -gt 0 ]]; then
    echo ""
    echo "  ❌ 以下检查失败："
    for err in "${ERRORS[@]}"; do
        echo "     - $err"
    done
    echo ""
    exit 1
fi

echo ""
echo "  ✅ /dev 健康检查全部通过"
echo ""
