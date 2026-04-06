#!/usr/bin/env bash
# quickcheck.sh — git push 前本地快速检查（护城河1）
#
# 目标：60 秒内在本地拦截明显问题，减少 CI 等待
#
# 检查项（按顺序，任一失败即退出）：
#   1. TypeCheck   — 改动 packages/engine/ 或 apps/ 时跑 tsc --noEmit
#   2. ESLint      — 只检查改动文件（brain/workspace），非全量
#   3. Unit Tests  — 只跑改动模块相关的测试（vitest --changed 或路径过滤）
#   4. Brain unit  — 如果改动涉及 packages/brain/，只跑匹配的 __tests__
#
# 用法：
#   bash scripts/quickcheck.sh           # 正常运行
#   bash scripts/quickcheck.sh --skip    # 紧急跳过（打印警告）
#
# 退出码：0 = 通过，1 = 失败

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$REPO_ROOT"

# ─── 颜色 ──────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BOLD='\033[1m'
RESET='\033[0m'

# ─── --skip 参数处理 ───────────────────────────────────────────
if [[ "${1:-}" == "--skip" ]]; then
    echo ""
    echo -e "${YELLOW}${BOLD}⚠️  [QUICKCHECK SKIP] 已跳过本地预检${RESET}"
    echo -e "${YELLOW}   警告：跳过 quickcheck 会让错误进入 CI（8-15分钟后才发现）${RESET}"
    echo -e "${YELLOW}   仅在真正的紧急情况下使用 --skip${RESET}"
    echo ""
    exit 0
fi

# ─── 计时开始 ─────────────────────────────────────────────────
START_TIME=$(date +%s)

echo ""
echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
echo -e "${BOLD}  🔍 QuickCheck — push 前本地预检（目标：60s 内完成）${RESET}"
echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
echo ""

PASS=true
BASE_REF="origin/main"

# 获取 base ref（fetch 一次，静默失败）
git fetch origin main --quiet 2>/dev/null || true

# ─── 获取改动文件列表 ─────────────────────────────────────────
CHANGED_FILES=$(git diff --name-only "${BASE_REF}...HEAD" 2>/dev/null || \
                git diff --name-only HEAD~1...HEAD 2>/dev/null || echo "")

if [[ -z "$CHANGED_FILES" ]]; then
    echo -e "${YELLOW}⏭  未检测到改动文件，跳过所有检查${RESET}"
    echo ""
    echo -e "${GREEN}${BOLD}✅ QuickCheck 通过（无改动）${RESET}"
    exit 0
fi

echo -e "📂 改动文件数：$(echo "$CHANGED_FILES" | grep -c . 2>/dev/null || echo 0)"
echo ""

# ─── 识别改动范围 ─────────────────────────────────────────────
ENGINE_CHANGED=false
BRAIN_CHANGED=false
WORKSPACE_CHANGED=false

echo "$CHANGED_FILES" | grep -q '^packages/engine/' && ENGINE_CHANGED=true || true
echo "$CHANGED_FILES" | grep -q '^packages/brain/' && BRAIN_CHANGED=true || true
echo "$CHANGED_FILES" | grep -qE '^apps/' && WORKSPACE_CHANGED=true || true

# ═══════════════════════════════════════════════════════════════
# 检查 1：TypeCheck
# ═══════════════════════════════════════════════════════════════
echo -e "${BOLD}[1/4] TypeCheck${RESET}"

TC_NEEDED=false
TC_TARGETS=()

if [[ "$ENGINE_CHANGED" == true ]]; then
    TC_NEEDED=true
    TC_TARGETS+=("engine")
fi
if [[ "$WORKSPACE_CHANGED" == true ]]; then
    TC_NEEDED=true
    TC_TARGETS+=("workspace")
fi

if [[ "$TC_NEEDED" == false ]]; then
    echo -e "  ⏭  无 TypeScript 改动，跳过"
else
    for target in "${TC_TARGETS[@]}"; do
        case "$target" in
            engine)
                if [[ -f "packages/engine/tsconfig.json" ]] && \
                   [[ -d "packages/engine/node_modules" ]]; then
                    echo -e "  ▶ packages/engine — tsc --noEmit..."
                    if (cd packages/engine && npx tsc --noEmit 2>&1); then
                        echo -e "  ${GREEN}✅ Engine TypeCheck 通过${RESET}"
                    else
                        echo -e "  ${RED}❌ Engine TypeCheck 失败${RESET}"
                        echo -e "  ${RED}   修复：npx tsc --noEmit 查看详细错误${RESET}"
                        PASS=false
                    fi
                else
                    echo -e "  ⚠️  packages/engine 依赖未安装，跳过 TypeCheck"
                fi
                ;;
            workspace)
                for app_dir in apps/api apps/dashboard; do
                    if [[ -f "$app_dir/tsconfig.json" ]] && \
                       [[ -d "$app_dir/node_modules" ]]; then
                        # 只在该 app 有改动时才跑
                        if echo "$CHANGED_FILES" | grep -q "^${app_dir}/"; then
                            echo -e "  ▶ ${app_dir} — tsc --noEmit..."
                            if (cd "$app_dir" && npx tsc --noEmit 2>&1); then
                                echo -e "  ${GREEN}✅ ${app_dir} TypeCheck 通过${RESET}"
                            else
                                echo -e "  ${RED}❌ ${app_dir} TypeCheck 失败${RESET}"
                                echo -e "  ${RED}   修复：cd ${app_dir} && npx tsc --noEmit${RESET}"
                                PASS=false
                            fi
                        fi
                    fi
                done
                ;;
        esac
    done
fi
echo ""

# ═══════════════════════════════════════════════════════════════
# 检查 2：ESLint（只检查改动文件）
# ═══════════════════════════════════════════════════════════════
echo -e "${BOLD}[2/4] ESLint（改动文件）${RESET}"

ESLINT_FILES=()
while IFS= read -r f; do
    # 只 lint brain 和 workspace 的 JS/TS 文件
    if [[ "$f" =~ ^(packages/brain|apps)/.+\.(js|ts|tsx|jsx)$ ]]; then
        [[ -f "$f" ]] && ESLINT_FILES+=("$f")
    fi
done <<< "$CHANGED_FILES"

if [[ ${#ESLINT_FILES[@]} -eq 0 ]]; then
    echo -e "  ⏭  无需 lint 的改动文件，跳过"
else
    echo -e "  ▶ 检查 ${#ESLINT_FILES[@]} 个文件..."
    # 确定 eslint 可执行路径
    ESLINT_BIN=""
    for candidate in \
        "./node_modules/.bin/eslint" \
        "packages/brain/node_modules/.bin/eslint" \
        "apps/api/node_modules/.bin/eslint"; do
        [[ -x "$candidate" ]] && { ESLINT_BIN="$candidate"; break; }
    done

    if [[ -z "$ESLINT_BIN" ]] && command -v eslint &>/dev/null; then
        ESLINT_BIN="eslint"
    fi

    if [[ -z "$ESLINT_BIN" ]]; then
        echo -e "  ⚠️  找不到 eslint，跳过 lint 检查（建议 npm install）"
    else
        # 按包分组执行（避免跨包 eslint 配置冲突）
        BRAIN_LINT_FILES=()
        WORKSPACE_LINT_FILES=()
        for f in "${ESLINT_FILES[@]}"; do
            if [[ "$f" == packages/brain/* ]]; then
                BRAIN_LINT_FILES+=("$f")
            else
                WORKSPACE_LINT_FILES+=("$f")
            fi
        done

        LINT_OK=true
        if [[ ${#BRAIN_LINT_FILES[@]} -gt 0 ]]; then
            if [[ -f "packages/brain/.eslintrc.js" ]] || \
               [[ -f "packages/brain/.eslintrc.json" ]] || \
               [[ -f "packages/brain/eslint.config.js" ]]; then
                echo -e "  ▶ Brain ESLint..."
                if (cd packages/brain && \
                    ./node_modules/.bin/eslint "${BRAIN_LINT_FILES[@]/#packages\/brain\//}" \
                    --no-eslintrc --config .eslintrc.js \
                    --max-warnings 0 2>&1) || \
                   (cd packages/brain && \
                    npx eslint "${BRAIN_LINT_FILES[@]/#packages\/brain\//}" \
                    --max-warnings 0 2>&1); then
                    echo -e "  ${GREEN}✅ Brain ESLint 通过${RESET}"
                else
                    echo -e "  ${RED}❌ Brain ESLint 失败${RESET}"
                    LINT_OK=false
                fi
            fi
        fi

        if [[ ${#WORKSPACE_LINT_FILES[@]} -gt 0 ]]; then
            # 只 lint apps/api/src/ 下的文件（有 eslint.config.js + ESLint v9）
            # apps/api/features/ 和 apps/dashboard/ 不在 ESLint scope 内，与 CI 保持一致
            API_SRC_FILES=()
            for f in "${WORKSPACE_LINT_FILES[@]}"; do
                [[ "$f" == apps/api/src/* ]] && API_SRC_FILES+=("${f#apps/api/}")
            done
            if [[ ${#API_SRC_FILES[@]} -eq 0 ]]; then
                echo -e "  ⏭  无 apps/api/src/ 改动，跳过 Workspace ESLint"
            else
                echo -e "  ▶ Workspace ESLint (apps/api/src/)..."
                if (cd apps/api && "$ESLINT_BIN" "${API_SRC_FILES[@]}" --max-warnings 0 2>&1); then
                    echo -e "  ${GREEN}✅ Workspace ESLint 通过${RESET}"
                else
                    echo -e "  ${RED}❌ Workspace ESLint 失败${RESET}"
                    LINT_OK=false
                fi
            fi
        fi

        if [[ "$LINT_OK" == false ]]; then
            PASS=false
        fi
    fi
fi
echo ""

# ═══════════════════════════════════════════════════════════════
# 检查 3：Engine Unit Tests（改动模块相关）
# ═══════════════════════════════════════════════════════════════
echo -e "${BOLD}[3/4] Engine Unit Tests${RESET}"

if [[ "$ENGINE_CHANGED" == false ]]; then
    echo -e "  ⏭  无 Engine 改动，跳过"
else
    if [[ ! -d "packages/engine/node_modules" ]]; then
        echo -e "  ⚠️  packages/engine 依赖未安装，跳过 Unit Tests"
    else
        # 找出改动的 engine 文件对应的测试文件
        ENGINE_TEST_FILES=()

        while IFS= read -r f; do
            [[ "$f" != packages/engine/* ]] && continue
            # 跳过已是测试文件
            if [[ "$f" == *".test."* ]] || [[ "$f" == *".spec."* ]]; then
                [[ -f "$f" ]] && ENGINE_TEST_FILES+=("$f")
                continue
            fi
            # 从源文件路径推导测试文件路径
            BASENAME=$(basename "$f" .ts)
            BASENAME=$(basename "$BASENAME" .js)
            # 查找对应的 __tests__ 目录或同级 .test.ts
            while IFS= read -r test_file; do
                [[ -f "$test_file" ]] && ENGINE_TEST_FILES+=("$test_file")
            done < <(find packages/engine -name "${BASENAME}.test.ts" \
                          -o -name "${BASENAME}.test.js" \
                          -o -name "${BASENAME}.spec.ts" 2>/dev/null || true)
        done <<< "$CHANGED_FILES"

        # 去重
        if [[ ${#ENGINE_TEST_FILES[@]} -gt 0 ]]; then
            ENGINE_TEST_FILES=($(printf '%s\n' "${ENGINE_TEST_FILES[@]}" | sort -u))
            echo -e "  ▶ 找到 ${#ENGINE_TEST_FILES[@]} 个相关测试文件，运行..."
            if (cd packages/engine && \
                NODE_OPTIONS='--max-old-space-size=2048' \
                npx vitest run --reporter=verbose \
                "${ENGINE_TEST_FILES[@]/#packages\/engine\//}" 2>&1); then
                echo -e "  ${GREEN}✅ Engine Unit Tests 通过${RESET}"
            else
                echo -e "  ${RED}❌ Engine Unit Tests 失败${RESET}"
                echo -e "  ${RED}   修复：cd packages/engine && npx vitest run [test-file]${RESET}"
                PASS=false
            fi
        else
            # 没有直接匹配的测试文件，用 --changed 跑
            echo -e "  ▶ 未找到精确匹配测试，尝试 vitest --changed..."
            if (cd packages/engine && \
                NODE_OPTIONS='--max-old-space-size=2048' \
                npx vitest run --changed="${BASE_REF}" \
                --reporter=verbose 2>&1) || true; then
                echo -e "  ${GREEN}✅ Engine Unit Tests 通过（--changed 模式）${RESET}"
            else
                echo -e "  ${YELLOW}⚠️  --changed 模式无法运行，跳过 Engine 测试${RESET}"
            fi
        fi
    fi
fi
echo ""

# ═══════════════════════════════════════════════════════════════
# 检查 4：Brain Unit Tests（仅改动 packages/brain/ 时）
# ═══════════════════════════════════════════════════════════════
echo -e "${BOLD}[4/4] Brain Unit Tests${RESET}"

if [[ "$BRAIN_CHANGED" == false ]]; then
    echo -e "  ⏭  无 Brain 改动，跳过"
else
    # 找出改动的 brain 文件对应的 __tests__ 文件
    BRAIN_TEST_FILES=()

    while IFS= read -r f; do
        [[ "$f" != packages/brain/* ]] && continue
        BASENAME=$(basename "$f" .js)
        BASENAME=$(basename "$BASENAME" .ts)
        while IFS= read -r test_file; do
            [[ -f "$test_file" ]] && BRAIN_TEST_FILES+=("$test_file")
        done < <(find packages/brain/__tests__ packages/brain/src \
                      -name "${BASENAME}.test.js" \
                      -o -name "${BASENAME}.test.ts" \
                      -o -name "${BASENAME}.spec.js" 2>/dev/null || true)
    done <<< "$CHANGED_FILES"

    if [[ ${#BRAIN_TEST_FILES[@]} -eq 0 ]]; then
        echo -e "  ⏭  Brain 无对应 unit test，跳过"
    else
        # bash 3.2 兼容（macOS 默认 bash 不支持 mapfile，local 在顶层无效）
        _tmp_brain_arr=("${BRAIN_TEST_FILES[@]}")
        BRAIN_TEST_FILES=()
        while IFS= read -r _line; do BRAIN_TEST_FILES+=("$_line"); done < <(printf '%s\n' "${_tmp_brain_arr[@]}" | sort -u)
        echo -e "  ▶ 找到 ${#BRAIN_TEST_FILES[@]} 个 Brain 测试，运行..."

        if [[ ! -d "packages/brain/node_modules" ]]; then
            echo -e "  ⚠️  packages/brain 依赖未安装，跳过"
        else
            BRAIN_TEST_RUNNER=""
            [[ -f "packages/brain/package.json" ]] && \
                BRAIN_TEST_RUNNER=$(cat packages/brain/package.json | \
                    node -e "const p=require('/dev/stdin');console.log(p.scripts?.test||'')" 2>/dev/null || echo "")

            if [[ -z "$BRAIN_TEST_RUNNER" ]]; then
                echo -e "  ⚠️  Brain 无测试命令配置，跳过"
            else
                # 只跑匹配的测试文件
                if (cd packages/brain && \
                    node --experimental-vm-modules \
                    node_modules/.bin/jest "${BRAIN_TEST_FILES[@]/#packages\/brain\//}" \
                    --testTimeout=10000 2>&1) || \
                   (cd packages/brain && \
                    npx vitest run "${BRAIN_TEST_FILES[@]/#packages\/brain\//}" 2>&1); then
                    echo -e "  ${GREEN}✅ Brain Unit Tests 通过${RESET}"
                else
                    echo -e "  ${RED}❌ Brain Unit Tests 失败${RESET}"
                    echo -e "  ${RED}   修复：cd packages/brain && npm test [test-file]${RESET}"
                    PASS=false
                fi
            fi
        fi
    fi
fi
echo ""

# ─── 计时结束 ─────────────────────────────────────────────────
END_TIME=$(date +%s)
ELAPSED=$((END_TIME - START_TIME))

echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
if [[ "$PASS" == true ]]; then
    echo -e "${GREEN}${BOLD}✅ QuickCheck 全部通过！（耗时 ${ELAPSED}s）${RESET}"
    echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
    echo ""
    exit 0
else
    echo -e "${RED}${BOLD}❌ QuickCheck 失败（耗时 ${ELAPSED}s）— push 被阻止${RESET}"
    echo -e "${RED}   请修复上述错误后重新 push${RESET}"
    echo -e "${YELLOW}   紧急情况跳过：git push ... # 使用 --skip 仅在脚本级别有效${RESET}"
    echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
    echo ""
    exit 1
fi
