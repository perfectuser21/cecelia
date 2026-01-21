#!/usr/bin/env bash
# ============================================================================
# QA Report Generator
# ============================================================================
#
# 生成 QA 审计报告 JSON，供 Dashboard 使用
#
# 用法:
#   bash scripts/qa-report.sh              # 输出到 stdout
#   bash scripts/qa-report.sh --output     # 输出到 .qa-report.json
#   bash scripts/qa-report.sh --post URL   # POST 到指定 URL
#
# ============================================================================

set -euo pipefail

PROJECT_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
RC_FILE="$PROJECT_ROOT/regression-contract.yaml"
FEATURES_FILE="$PROJECT_ROOT/FEATURES.md"
PACKAGE_FILE="$PROJECT_ROOT/package.json"

# 颜色
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m'

# ============================================================================
# 辅助函数
# ============================================================================

get_repo_name() {
    basename "$PROJECT_ROOT"
}

get_version() {
    if [[ -f "$PACKAGE_FILE" ]]; then
        grep '"version"' "$PACKAGE_FILE" | head -1 | sed 's/.*"version".*"\([^"]*\)".*/\1/'
    else
        echo "unknown"
    fi
}

get_timestamp() {
    date -u +"%Y-%m-%dT%H:%M:%SZ"
}

# ============================================================================
# Features 提取
# ============================================================================

extract_features() {
    if [[ ! -f "$FEATURES_FILE" ]]; then
        echo "[]"
        return
    fi

    # 提取 Committed features（简化实现）
    local features=()

    # H1, H2
    if grep -q "H1.*Committed" "$FEATURES_FILE"; then
        features+=('{"id":"H1","name":"branch-protect","status":"Committed","scope":"hook"}')
    fi
    if grep -q "H2.*Committed" "$FEATURES_FILE"; then
        features+=('{"id":"H2","name":"pr-gate-v2","status":"Committed","scope":"hook"}')
    fi

    # W1, W3, W4
    if grep -q "W1.*Committed" "$FEATURES_FILE"; then
        features+=('{"id":"W1","name":"/dev 流程","status":"Committed","scope":"workflow"}')
    fi
    if grep -q "W3.*Committed" "$FEATURES_FILE"; then
        features+=('{"id":"W3","name":"循环回退","status":"Committed","scope":"workflow"}')
    fi
    if grep -q "W4.*Committed" "$FEATURES_FILE"; then
        features+=('{"id":"W4","name":"测试任务模式","status":"Committed","scope":"workflow"}')
    fi

    # C1-C4
    if grep -q "C1.*Committed" "$FEATURES_FILE"; then
        features+=('{"id":"C1","name":"version-check","status":"Committed","scope":"ci"}')
    fi
    if grep -q "C2.*Committed" "$FEATURES_FILE"; then
        features+=('{"id":"C2","name":"test job","status":"Committed","scope":"ci"}')
    fi
    if grep -q "C3.*Committed" "$FEATURES_FILE"; then
        features+=('{"id":"C3","name":"shell syntax check","status":"Committed","scope":"ci"}')
    fi
    if grep -q "C4.*Committed" "$FEATURES_FILE"; then
        features+=('{"id":"C4","name":"notify-failure","status":"Committed","scope":"ci"}')
    fi

    # B1
    if grep -q "B1.*Committed" "$FEATURES_FILE"; then
        features+=('{"id":"B1","name":"calculator","status":"Committed","scope":"business"}')
    fi

    # E1 (QA Reporting)
    if grep -q "E1.*Committed" "$FEATURES_FILE"; then
        features+=('{"id":"E1","name":"QA Reporting","status":"Committed","scope":"export"}')
    fi

    # 输出 JSON 数组
    if [[ ${#features[@]} -eq 0 ]]; then
        echo "[]"
    else
        local IFS=','
        echo "[${features[*]}]"
    fi
}

# ============================================================================
# RCIs 提取
# ============================================================================

extract_rcis() {
    if [[ ! -f "$RC_FILE" ]]; then
        echo '{"total":0,"by_priority":{"P0":[],"P1":[],"P2":[]},"details":[]}'
        return
    fi

    # 统计
    local total=$(grep -c "^\s*- id:" "$RC_FILE" 2>/dev/null || echo 0)
    local p0=$(grep -c "priority: P0" "$RC_FILE" 2>/dev/null || echo 0)
    local p1=$(grep -c "priority: P1" "$RC_FILE" 2>/dev/null || echo 0)
    local p2=$(grep -c "priority: P2" "$RC_FILE" 2>/dev/null || echo 0)

    # 提取 P0 IDs
    local p0_ids=$(grep -B1 "priority: P0" "$RC_FILE" | grep "id:" | sed 's/.*id: //' | tr -d '"' | tr '\n' ',' | sed 's/,$//')
    local p1_ids=$(grep -B1 "priority: P1" "$RC_FILE" | grep "id:" | sed 's/.*id: //' | tr -d '"' | tr '\n' ',' | sed 's/,$//')
    local p2_ids=$(grep -B1 "priority: P2" "$RC_FILE" | grep "id:" | sed 's/.*id: //' | tr -d '"' | tr '\n' ',' | sed 's/,$//')

    # 格式化为 JSON 数组
    format_ids() {
        local ids="$1"
        if [[ -z "$ids" ]]; then
            echo "[]"
        else
            echo "[\"$(echo "$ids" | sed 's/,/","/g')\"]"
        fi
    }

    cat <<EOF
{
    "total": $total,
    "by_priority": {
      "P0": $(format_ids "$p0_ids"),
      "P1": $(format_ids "$p1_ids"),
      "P2": $(format_ids "$p2_ids")
    },
    "counts": {
      "P0": $p0,
      "P1": $p1,
      "P2": $p2
    }
  }
EOF
}

# ============================================================================
# Golden Paths 提取
# ============================================================================

extract_golden_paths() {
    if [[ ! -f "$RC_FILE" ]]; then
        echo '[]'
        return
    fi

    # 检查是否有 golden_paths 部分
    if ! grep -q "^golden_paths:" "$RC_FILE"; then
        echo '[]'
        return
    fi

    # 简化提取：只获取 GP IDs 和名称
    local gps=()

    # GP-001
    if grep -q "GP-001" "$RC_FILE"; then
        local name=$(grep -A1 "id: GP-001" "$RC_FILE" | grep "name:" | sed 's/.*name: "//' | sed 's/".*//')
        gps+=("{\"id\":\"GP-001\",\"name\":\"$name\"}")
    fi

    # GP-002
    if grep -q "GP-002" "$RC_FILE"; then
        local name=$(grep -A1 "id: GP-002" "$RC_FILE" | grep "name:" | sed 's/.*name: "//' | sed 's/".*//')
        gps+=("{\"id\":\"GP-002\",\"name\":\"$name\"}")
    fi

    # GP-003
    if grep -q "GP-003" "$RC_FILE"; then
        local name=$(grep -A1 "id: GP-003" "$RC_FILE" | grep "name:" | sed 's/.*name: "//' | sed 's/".*//')
        gps+=("{\"id\":\"GP-003\",\"name\":\"$name\"}")
    fi

    # GP-004
    if grep -q "GP-004" "$RC_FILE"; then
        local name=$(grep -A1 "id: GP-004" "$RC_FILE" | grep "name:" | sed 's/.*name: "//' | sed 's/".*//')
        gps+=("{\"id\":\"GP-004\",\"name\":\"$name\"}")
    fi

    if [[ ${#gps[@]} -eq 0 ]]; then
        echo "[]"
    else
        local IFS=','
        echo "[${gps[*]}]"
    fi
}

# ============================================================================
# Gates 提取
# ============================================================================

extract_gates() {
    if [[ ! -f "$RC_FILE" ]]; then
        echo '{}'
        return
    fi

    # PR Gate: trigger 包含 PR 的 RCIs
    local pr_count=$(grep -E "trigger:.*PR" "$RC_FILE" | wc -l || echo 0)

    # Release Gate: trigger 包含 Release 的 RCIs
    local release_count=$(grep -E "trigger:.*Release" "$RC_FILE" | wc -l || echo 0)

    # Nightly: 全部
    local total=$(grep -c "^\s*- id:" "$RC_FILE" 2>/dev/null || echo 0)
    # 减去 golden_paths 部分
    local gp_count=$(grep -c "id: GP-" "$RC_FILE" 2>/dev/null || echo 0)
    total=$((total - gp_count))

    cat <<EOF
{
    "pr": {
      "name": "PR Gate",
      "description": "跑 trigger 包含 PR 的 RCIs",
      "count": $pr_count
    },
    "release": {
      "name": "Release Gate",
      "description": "跑 trigger 包含 Release 的 RCIs",
      "count": $release_count
    },
    "nightly": {
      "name": "Nightly",
      "description": "跑全部 RCIs",
      "count": $total
    }
  }
EOF
}

# ============================================================================
# Summary 计算
# ============================================================================

calculate_summary() {
    # Meta 层：检查关键文件存在
    local meta=0
    local meta_checks=0

    # regression-contract.yaml
    [[ -f "$RC_FILE" ]] && ((meta+=1))
    ((meta_checks+=1))

    # FEATURES.md
    [[ -f "$FEATURES_FILE" ]] && ((meta+=1))
    ((meta_checks+=1))

    # hooks/
    [[ -d "$PROJECT_ROOT/hooks" ]] && ((meta+=1))
    ((meta_checks+=1))

    # golden_paths
    grep -q "^golden_paths:" "$RC_FILE" 2>/dev/null && ((meta+=1))
    ((meta_checks+=1))

    # skills/qa
    [[ -d "$PROJECT_ROOT/skills/qa" ]] && ((meta+=1))
    ((meta_checks+=1))

    local meta_pct=$((meta * 100 / meta_checks))

    # Unit 层：检查测试
    local unit=0
    local unit_checks=0

    # tests/ 目录
    [[ -d "$PROJECT_ROOT/tests" ]] && ((unit+=1))
    ((unit_checks+=1))

    # vitest/jest
    grep -q "vitest\|jest" "$PACKAGE_FILE" 2>/dev/null && ((unit+=1))
    ((unit_checks+=1))

    # npm test 脚本
    grep -q '"test"' "$PACKAGE_FILE" 2>/dev/null && ((unit+=1))
    ((unit_checks+=1))

    # hooks 测试
    [[ -f "$PROJECT_ROOT/tests/hooks/branch-protect.test.ts" ]] && ((unit+=1))
    ((unit_checks+=1))

    [[ -f "$PROJECT_ROOT/tests/hooks/pr-gate.test.ts" ]] && ((unit+=1))
    ((unit_checks+=1))

    local unit_pct=$((unit * 100 / unit_checks))

    # E2E 层：Golden Paths
    local e2e=0
    local e2e_checks=0

    # golden_paths 定义
    grep -q "^golden_paths:" "$RC_FILE" 2>/dev/null && ((e2e+=1))
    ((e2e_checks+=1))

    # GP 数量 >= 3
    local gp_count=$(grep -c "id: GP-" "$RC_FILE" 2>/dev/null || echo 0)
    [[ $gp_count -ge 3 ]] && ((e2e+=1))
    ((e2e_checks+=1))

    # e2e/ 目录（可选）
    [[ -d "$PROJECT_ROOT/e2e" ]] && ((e2e+=1))
    ((e2e_checks+=1))

    # golden-path-test.sh（可选）
    [[ -f "$PROJECT_ROOT/scripts/golden-path-test.sh" ]] && ((e2e+=1))
    ((e2e_checks+=1))

    local e2e_pct=$((e2e * 100 / e2e_checks))

    # Overall
    local overall=$(( (meta_pct + unit_pct + e2e_pct) / 3 ))

    cat <<EOF
{
    "meta": $meta_pct,
    "unit": $unit_pct,
    "e2e": $e2e_pct,
    "overall": $overall
  }
EOF
}

# ============================================================================
# 主函数
# ============================================================================

generate_report() {
    local repo=$(get_repo_name)
    local version=$(get_version)
    local timestamp=$(get_timestamp)
    local summary=$(calculate_summary)
    local features=$(extract_features)
    local rcis=$(extract_rcis)
    local golden_paths=$(extract_golden_paths)
    local gates=$(extract_gates)

    cat <<EOF
{
  "repo": "$repo",
  "version": "$version",
  "timestamp": "$timestamp",
  "summary": $summary,
  "features": $features,
  "rcis": $rcis,
  "golden_paths": $golden_paths,
  "gates": $gates
}
EOF
}

# ============================================================================
# 入口
# ============================================================================

main() {
    local mode="stdout"
    local url=""

    while [[ $# -gt 0 ]]; do
        case $1 in
            --output|-o)
                mode="file"
                shift
                ;;
            --post|-p)
                mode="post"
                url="$2"
                shift 2
                ;;
            --help|-h)
                echo "用法: $0 [--output] [--post URL]"
                echo ""
                echo "选项:"
                echo "  --output, -o    输出到 .qa-report.json"
                echo "  --post, -p URL  POST 到指定 URL"
                echo "  --help, -h      显示帮助"
                exit 0
                ;;
            *)
                shift
                ;;
        esac
    done

    local report=$(generate_report)

    case $mode in
        stdout)
            echo "$report"
            ;;
        file)
            echo "$report" > "$PROJECT_ROOT/.qa-report.json"
            echo -e "${GREEN}✅ 报告已保存到 .qa-report.json${NC}"
            ;;
        post)
            if [[ -z "$url" ]]; then
                echo -e "${RED}错误: 缺少 URL${NC}"
                exit 1
            fi
            echo "$report" | curl -s -X POST "$url" \
                -H "Content-Type: application/json" \
                -d @-
            echo -e "${GREEN}✅ 报告已 POST 到 $url${NC}"
            ;;
    esac
}

main "$@"
