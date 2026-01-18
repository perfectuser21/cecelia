#!/usr/bin/env bash
# ============================================================================
# project-detect.sh - 统一项目检测（PostToolUse）
# ============================================================================
#
# 触发：每次 Bash 命令执行后
# 作用：检测项目信息并缓存，避免重复扫描
#
# 检测内容：
#   1. 项目基础信息（git、CI、文档）
#   2. 项目类型（Node/Python/Go/Rust）
#   3. Monorepo 结构
#   4. 包依赖图
#   5. 测试能力 L1-L6
#
# 输出：.project-info.json（只在变化时更新）
#
# ============================================================================

set -euo pipefail

# 读取 stdin（Claude Code hooks 需要）
cat > /dev/null

# 获取项目根目录
PROJECT_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
cd "$PROJECT_ROOT"

INFO_FILE="$PROJECT_ROOT/.project-info.json"
CURRENT_HASH=""
NEW_HASH=""

# ===== 跨平台 md5 计算（兼容 Linux/MacOS）=====
compute_md5() {
    if command -v md5sum &>/dev/null; then
        md5sum | cut -d' ' -f1
    elif command -v md5 &>/dev/null; then
        md5 -r | cut -d' ' -f1
    else
        # fallback: 使用 cksum
        cksum | cut -d' ' -f1
    fi
}

# ===== 计算项目状态哈希（用于判断是否需要重新扫描）=====
compute_hash() {
    # 基于关键文件的修改时间计算哈希
    local hash_input=""
    for f in package.json pyproject.toml go.mod Cargo.toml pnpm-workspace.yaml lerna.json; do
        if [[ -f "$PROJECT_ROOT/$f" ]]; then
            hash_input+="$f:$(stat -c %Y "$PROJECT_ROOT/$f" 2>/dev/null || stat -f %m "$PROJECT_ROOT/$f" 2>/dev/null)"
        fi
    done
    # 加入 packages 目录结构
    if [[ -d "$PROJECT_ROOT/packages" ]]; then
        hash_input+=":packages:$(ls -la "$PROJECT_ROOT/packages" 2>/dev/null | compute_md5)"
    fi
    echo "$hash_input" | compute_md5
}

# 检查是否需要重新扫描
if [[ -f "$INFO_FILE" ]]; then
    CURRENT_HASH=$(jq -r '.hash // ""' "$INFO_FILE" 2>/dev/null || echo "")
fi
NEW_HASH=$(compute_hash)

if [[ "$CURRENT_HASH" == "$NEW_HASH" && -f "$INFO_FILE" ]]; then
    # 哈希未变，跳过扫描
    exit 0
fi

# ===== 开始扫描 =====

# 初始化变量
PROJECT_NAME=$(basename "$PROJECT_ROOT")
PROJECT_TYPE="unknown"
IS_MONOREPO=false
PACKAGES=()
DEPENDENCY_GRAPH="{}"

# 测试层级
L1=false L2=false L3=false L4=false L5=false L6=false
L1_DETAILS=() L2_DETAILS=() L3_DETAILS=() L4_DETAILS=() L5_DETAILS=() L6_DETAILS=()

# ===== 1. 检测项目类型 =====
if [[ -f "package.json" ]]; then
    PROJECT_TYPE="node"
elif [[ -f "pyproject.toml" || -f "setup.py" ]]; then
    PROJECT_TYPE="python"
elif [[ -f "go.mod" ]]; then
    PROJECT_TYPE="go"
elif [[ -f "Cargo.toml" ]]; then
    PROJECT_TYPE="rust"
fi

# ===== 2. 检测 Monorepo =====
if [[ -f "pnpm-workspace.yaml" || -f "lerna.json" ]]; then
    IS_MONOREPO=true
elif [[ -f "package.json" ]] && jq -e '.workspaces' package.json &>/dev/null; then
    IS_MONOREPO=true
fi

# ===== 3. 检测包列表和依赖图（Monorepo）=====
if [[ "$IS_MONOREPO" == "true" ]]; then
    # 查找所有包
    if [[ -d "packages" ]]; then
        while IFS= read -r pkg_dir; do
            if [[ -f "$pkg_dir/package.json" ]]; then
                pkg_name=$(jq -r '.name // ""' "$pkg_dir/package.json" 2>/dev/null)
                [[ -n "$pkg_name" ]] && PACKAGES+=("$pkg_name")
            fi
        done < <(find packages -maxdepth 2 -type d 2>/dev/null)
    fi
    if [[ -d "apps" ]]; then
        while IFS= read -r pkg_dir; do
            if [[ -f "$pkg_dir/package.json" ]]; then
                pkg_name=$(jq -r '.name // ""' "$pkg_dir/package.json" 2>/dev/null)
                [[ -n "$pkg_name" ]] && PACKAGES+=("$pkg_name")
            fi
        done < <(find apps -maxdepth 2 -type d 2>/dev/null)
    fi

    # 构建依赖图
    DEPENDENCY_GRAPH="{"
    first=true
    if [[ ${#PACKAGES[@]} -gt 0 ]]; then
        for pkg in "${PACKAGES[@]}"; do
            pkg_path=""
            if [[ -f "packages/$pkg/package.json" ]]; then
                pkg_path="packages/$pkg/package.json"
            elif [[ -f "packages/${pkg#@*/}/package.json" ]]; then
                pkg_path="packages/${pkg#@*/}/package.json"
            fi

            if [[ -n "$pkg_path" && -f "$pkg_path" ]]; then
                deps=$(jq -r '(.dependencies // {}) + (.devDependencies // {}) | keys[]' "$pkg_path" 2>/dev/null | grep -E "^@" | sed 's/.*/"&"/' | tr '\n' ',' | sed 's/,$//')
                if [[ -n "$deps" ]]; then
                    [[ "$first" != "true" ]] && DEPENDENCY_GRAPH+=","
                    DEPENDENCY_GRAPH+="\"$pkg\":[$deps]"
                    first=false
                fi
            fi
        done
    fi
    DEPENDENCY_GRAPH+="}"
fi

# ===== 4. 检测测试能力 L1-L6 =====

# L1 静态分析
if [[ -f "package.json" ]]; then
    grep -q '"typecheck"' package.json 2>/dev/null && L1=true && L1_DETAILS+=("typecheck")
    grep -q '"lint"' package.json 2>/dev/null && L1=true && L1_DETAILS+=("lint")
    grep -q '"format"' package.json 2>/dev/null && L1=true && L1_DETAILS+=("format")
fi
[[ -f "go.mod" ]] && L1=true && L1_DETAILS+=("go vet")
find . -name "*.sh" -type f -not -path "*/node_modules/*" 2>/dev/null | grep -q . && L1=true && L1_DETAILS+=("shellcheck")

# L2 单元测试
if [[ -f "package.json" ]]; then
    if grep -q '"test"' package.json 2>/dev/null; then
        grep -q "vitest" package.json && L2=true && L2_DETAILS+=("vitest")
        grep -q "jest" package.json && L2=true && L2_DETAILS+=("jest")
        grep -q "mocha" package.json && L2=true && L2_DETAILS+=("mocha")
        [[ "$L2" == "false" ]] && L2=true && L2_DETAILS+=("npm test")
    fi
fi
[[ -d "tests" || -f "pytest.ini" ]] && command -v pytest &>/dev/null && L2=true && L2_DETAILS+=("pytest")
[[ -f "go.mod" ]] && find . -name "*_test.go" 2>/dev/null | grep -q . && L2=true && L2_DETAILS+=("go test")

# L3 集成测试
[[ -f "package.json" ]] && grep -qE '"test:(integration|int)"' package.json 2>/dev/null && L3=true && L3_DETAILS+=("integration")
[[ -d "src/api" || -d "api" || -d "src/routes" ]] && L3=true && L3_DETAILS+=("api routes")
[[ -f "docker-compose.yml" || -f "docker-compose.test.yml" ]] && L3=true && L3_DETAILS+=("docker-compose")

# L4 E2E
[[ -f "playwright.config.ts" || -d "e2e" ]] && L4=true && L4_DETAILS+=("playwright")
[[ -f "cypress.config.ts" || -d "cypress" ]] && L4=true && L4_DETAILS+=("cypress")

# L5 性能
[[ -f "package.json" ]] && grep -qE '"(benchmark|perf)"' package.json 2>/dev/null && L5=true && L5_DETAILS+=("benchmark")
[[ -d "benchmark" || -d "benchmarks" ]] && L5=true && L5_DETAILS+=("benchmark dir")

# L6 安全
[[ -f "package.json" ]] && grep -q '"audit"' package.json 2>/dev/null && L6=true && L6_DETAILS+=("npm audit")
[[ -f ".snyk" ]] && L6=true && L6_DETAILS+=("snyk")

# 计算最高层级
MAX_LEVEL=0
[[ "$L1" == "true" ]] && MAX_LEVEL=1
[[ "$L2" == "true" ]] && MAX_LEVEL=2
[[ "$L3" == "true" ]] && MAX_LEVEL=3
[[ "$L4" == "true" ]] && MAX_LEVEL=4
[[ "$L5" == "true" ]] && MAX_LEVEL=5
[[ "$L6" == "true" ]] && MAX_LEVEL=6

# ===== 5. 生成 JSON =====

# JSON 字符串转义（防止注入）
json_escape() {
    local str="$1"
    # 转义反斜杠、双引号、控制字符
    str="${str//\\/\\\\}"
    str="${str//\"/\\\"}"
    str="${str//$'\n'/\\n}"
    str="${str//$'\r'/\\r}"
    str="${str//$'\t'/\\t}"
    echo "$str"
}

array_to_json() {
    if [[ $# -eq 0 ]]; then
        echo "[]"
    else
        local arr=("$@")
        printf '["%s"' "$(json_escape "${arr[0]}")"
        for ((i=1; i<${#arr[@]}; i++)); do
            printf ',"%s"' "$(json_escape "${arr[$i]}")"
        done
        printf ']'
    fi
}

packages_json="[]"
if [[ ${#PACKAGES[@]} -gt 0 ]]; then
    packages_json=$(printf '["%s"' "$(json_escape "${PACKAGES[0]}")")
    for ((i=1; i<${#PACKAGES[@]}; i++)); do
        packages_json+=",\"$(json_escape "${PACKAGES[$i]}")\""
    done
    packages_json+="]"
fi

cat > "$INFO_FILE" << EOF
{
  "hash": "$NEW_HASH",
  "detected_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "project": {
    "name": "$(json_escape "$PROJECT_NAME")",
    "type": "$(json_escape "$PROJECT_TYPE")",
    "is_monorepo": $IS_MONOREPO,
    "packages": $packages_json,
    "dependency_graph": $DEPENDENCY_GRAPH
  },
  "test_levels": {
    "max_level": $MAX_LEVEL,
    "L1": $L1,
    "L2": $L2,
    "L3": $L3,
    "L4": $L4,
    "L5": $L5,
    "L6": $L6,
    "details": {
      "L1": $(array_to_json ${L1_DETAILS[@]+"${L1_DETAILS[@]}"}),
      "L2": $(array_to_json ${L2_DETAILS[@]+"${L2_DETAILS[@]}"}),
      "L3": $(array_to_json ${L3_DETAILS[@]+"${L3_DETAILS[@]}"}),
      "L4": $(array_to_json ${L4_DETAILS[@]+"${L4_DETAILS[@]}"}),
      "L5": $(array_to_json ${L5_DETAILS[@]+"${L5_DETAILS[@]}"}),
      "L6": $(array_to_json ${L6_DETAILS[@]+"${L6_DETAILS[@]}"})
    }
  }
}
EOF

# 输出简要信息
echo "" >&2
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
echo "  项目检测完成" >&2
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
echo "" >&2
echo "  项目: $PROJECT_NAME ($PROJECT_TYPE)" >&2
if [[ "$IS_MONOREPO" == "true" ]]; then
    echo "  Monorepo: ${#PACKAGES[@]} 个包" >&2
fi
echo "  测试能力: L$MAX_LEVEL" >&2
echo "" >&2
echo "  已保存: .project-info.json" >&2
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2

exit 0
