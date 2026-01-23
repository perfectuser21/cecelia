#!/usr/bin/env bash
# ============================================================================
# QA Report Generator v3
# ============================================================================
#
# 生成 QA 审计报告 JSON，供 Dashboard 使用
#
# 用法:
#   bash scripts/qa-report.sh              # 完整检查（包括运行测试）
#   bash scripts/qa-report.sh --fast       # 快速检查（跳过 npm run qa）
#   bash scripts/qa-report.sh --output     # 输出到 .qa-report.json
#   bash scripts/qa-report.sh --post URL   # POST 到指定 URL
#
# v3 新增:
#   - Features 增加 description, rci_count, rcis, in_golden_paths
#   - RCIs 增加完整详情列表
#   - Golden Paths 增加 rcis, covers_features
#
# ============================================================================

set -euo pipefail

PROJECT_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
RC_FILE="$PROJECT_ROOT/regression-contract.yaml"
FEATURES_FILE="$PROJECT_ROOT/FEATURES.md"
PACKAGE_FILE="$PROJECT_ROOT/package.json"

# 全局变量
FAST_MODE=false

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
# Python 生成完整报告（v3 核心）
# ============================================================================
# L3 note: This embedded Python is intentionally kept inline to avoid external
# dependencies and simplify deployment. The Python code parses YAML/Markdown
# and generates JSON. If modifications are needed, consider:
# 1. Keep changes minimal and well-tested
# 2. Ensure PyYAML is installed (pip install pyyaml)
# 3. Test with: python3 -c "import yaml; import json; print('ok')"
# ============================================================================

generate_full_data() {
    python3 << 'PYTHON'
import yaml
import re
import json
import sys

# Feature 人话描述映射
FEATURE_DESCRIPTIONS = {
    "H1": "禁止在 main/develop 直接写代码，强制走分支",
    "H2": "创建 PR 前强制跑测试，不过不让提",
    "W1": "统一开发入口：需求→分支→写码→测试→PR→合并",
    "W3": "测试失败不中止，自动回去继续修",
    "W5": "/dev 入口自动识别四种模式（new/continue/fix/merge）",
    "C1": "PR 必须更新版本号，否则 CI 红",
    "C2": "CI 跑 typecheck + test + build",
    "C3": "CI 检查所有 .sh 脚本语法",
    "C5": "Release 前检查 DoD 完成度",
    "E1": "生成 QA 审计 JSON 给 Dashboard 用",
    "E2": "开发任务报告（有头/无头模式标识）"
}

# 读取文件
try:
    with open('FEATURES.md', 'r') as f:
        features_content = f.read()
except:
    features_content = ""

try:
    with open('regression-contract.yaml', 'r') as f:
        rc_data = yaml.safe_load(f)
except:
    rc_data = {}

# ============================================================================
# 1. 提取所有 RCIs
# ============================================================================
all_rcis = []
rci_by_feature = {}  # feature -> [rci_ids]
rci_details = {}     # rci_id -> {feature, name, priority, trigger, method}

for section in ['hooks', 'workflow', 'ci', 'business', 'export']:
    if section in rc_data and rc_data[section]:
        for rci in rc_data[section]:
            rci_id = rci.get('id', '')
            feature = rci.get('feature', '')

            detail = {
                "id": rci_id,
                "feature": feature,
                "name": rci.get('name', ''),
                "priority": rci.get('priority', 'P2'),
                "trigger": rci.get('trigger', []),
                "method": rci.get('method', 'manual'),
                "scope": rci.get('scope', section)
            }

            all_rcis.append(detail)
            rci_details[rci_id] = detail

            if feature not in rci_by_feature:
                rci_by_feature[feature] = []
            rci_by_feature[feature].append(rci_id)

# ============================================================================
# 2. 提取 Golden Paths
# ============================================================================
golden_paths = []
gp_by_feature = {}  # feature -> [gp_ids]

gps = rc_data.get('golden_paths', [])
for gp in gps:
    gp_id = gp.get('id', '')
    gp_rcis = gp.get('rcis', [])

    # 计算覆盖的 features
    covers_features = set()
    for rci_id in gp_rcis:
        if rci_id in rci_details:
            covers_features.add(rci_details[rci_id]['feature'])

    gp_detail = {
        "id": gp_id,
        "name": gp.get('name', ''),
        "description": gp.get('description', ''),
        "trigger": gp.get('trigger', []),
        "method": gp.get('method', 'manual'),
        "rcis": gp_rcis,
        "covers_features": list(covers_features)
    }
    golden_paths.append(gp_detail)

    # 反向映射：feature -> gp
    for f in covers_features:
        if f not in gp_by_feature:
            gp_by_feature[f] = []
        gp_by_feature[f].append(gp_id)

# ============================================================================
# 3. 提取 Committed Features
# ============================================================================
committed_features = []

for match in re.finditer(r'\|\s*([A-Z]\d+)\s*\|\s*([^\|]+)\s*\|\s*\*\*Committed\*\*', features_content):
    fid = match.group(1)
    fname = match.group(2).strip()

    feature_detail = {
        "id": fid,
        "name": fname,
        "description": FEATURE_DESCRIPTIONS.get(fid, fname),
        "status": "Committed",
        "scope": "hook" if fid.startswith("H") else
                 "workflow" if fid.startswith("W") else
                 "ci" if fid.startswith("C") else
                 "business" if fid.startswith("B") else
                 "export" if fid.startswith("E") else "other",
        "rci_count": len(rci_by_feature.get(fid, [])),
        "rcis": rci_by_feature.get(fid, []),
        "in_golden_paths": gp_by_feature.get(fid, [])
    }
    committed_features.append(feature_detail)

# ============================================================================
# 4. 计算 Meta 分数
# ============================================================================
committed_ids = {f['id'] for f in committed_features}
covered_ids = set(rci_by_feature.keys())
gaps = list(committed_ids - covered_ids)

# P0 必须在 PR 触发
p0_violations = []
for rci in all_rcis:
    if rci['priority'] == 'P0' and 'PR' not in rci['trigger']:
        p0_violations.append(rci['id'])

meta_score = int(len(committed_ids - set(gaps)) * 100 / len(committed_ids)) if committed_ids else 0

meta_result = {
    "score": meta_score,
    "total_features": len(committed_ids),
    "covered_features": len(committed_ids) - len(gaps),
    "gaps": gaps,
    "p0_violations": p0_violations
}

# ============================================================================
# 5. 计算 E2E 分数
# ============================================================================
gp_coverage = set()
for gp in golden_paths:
    gp_coverage.update(gp['covers_features'])

uncovered = list(committed_ids - gp_coverage)
e2e_score = 100 if golden_paths else 0  # GP 结构完整即 100

e2e_result = {
    "score": e2e_score,
    "gp_count": len(golden_paths),
    "gp_coverage": list(gp_coverage),
    "uncovered_features": uncovered,
    "unresolved_rcis": []
}

# ============================================================================
# 6. RCI 统计
# ============================================================================
p0_rcis = [r for r in all_rcis if r['priority'] == 'P0']
p1_rcis = [r for r in all_rcis if r['priority'] == 'P1']
p2_rcis = [r for r in all_rcis if r['priority'] == 'P2']

rcis_result = {
    "total": len(all_rcis),
    "by_priority": {
        "P0": [r['id'] for r in p0_rcis],
        "P1": [r['id'] for r in p1_rcis],
        "P2": [r['id'] for r in p2_rcis]
    },
    "counts": {
        "P0": len(p0_rcis),
        "P1": len(p1_rcis),
        "P2": len(p2_rcis)
    },
    "details": all_rcis
}

# ============================================================================
# 7. Gates 统计
# ============================================================================
pr_count = len([r for r in all_rcis if 'PR' in r['trigger']])
release_count = len([r for r in all_rcis if 'Release' in r['trigger']])

gates_result = {
    "pr": {
        "name": "PR Gate",
        "description": "跑 trigger 包含 PR 的 RCIs",
        "count": pr_count,
        "rcis": [r['id'] for r in all_rcis if 'PR' in r['trigger']]
    },
    "release": {
        "name": "Release Gate",
        "description": "跑 trigger 包含 Release 的 RCIs",
        "count": release_count,
        "rcis": [r['id'] for r in all_rcis if 'Release' in r['trigger']]
    },
    "nightly": {
        "name": "Nightly",
        "description": "跑全部 RCIs",
        "count": len(all_rcis),
        "rcis": [r['id'] for r in all_rcis]
    }
}

# 输出
output = {
    "features": committed_features,
    "rcis": rcis_result,
    "golden_paths": golden_paths,
    "gates": gates_result,
    "meta": meta_result,
    "e2e": e2e_result
}

print(json.dumps(output))
PYTHON
}

# ============================================================================
# Unit 检查（需要实际运行）
# ============================================================================

calculate_unit() {
    # Fast mode: 跳过实际运行
    if [[ "$FAST_MODE" == "true" ]]; then
        cat <<EOF
{
    "score": -1,
    "passed": null,
    "test_count": 0,
    "duration": "skipped",
    "error_summary": null,
    "note": "Fast mode: skipped npm run qa"
  }
EOF
        return
    fi

    local start_time=$(date +%s)
    local output
    local exit_code=0

    # 真实运行
    output=$(npm run qa 2>&1) || exit_code=$?

    local end_time=$(date +%s)
    local duration=$((end_time - start_time))

    # 提取测试数量
    # L2 fix: 更健壮的 test_count 提取逻辑
    local test_count="0"
    # 尝试多种格式: "Tests 123 passed", "123 passed", "123 tests"
    if echo "$output" | grep -qE "Tests\s+[0-9]+ passed"; then
        test_count=$(echo "$output" | grep -oE "Tests\s+[0-9]+ passed" | grep -oE "[0-9]+" | head -1)
    elif echo "$output" | grep -qE "[0-9]+ passed"; then
        test_count=$(echo "$output" | grep -oE "[0-9]+ passed" | grep -oE "[0-9]+" | sort -rn | head -1)
    elif echo "$output" | grep -qE "[0-9]+ tests"; then
        test_count=$(echo "$output" | grep -oE "[0-9]+ tests" | grep -oE "[0-9]+" | head -1)
    fi
    # 确保 test_count 是有效数字
    if ! [[ "$test_count" =~ ^[0-9]+$ ]]; then
        test_count="0"
    fi

    # 判断是否通过
    local passed="false"
    local score=0
    local error_summary="null"

    if [[ $exit_code -eq 0 ]]; then
        passed="true"
        score=100
    else
        # L2 fix: 提取错误摘要，处理非法 UTF-8 字符
        # 先用 tr 清理非 UTF-8 字符，再用 jq 转义
        error_summary=$(printf '%s' "$output" | tail -10 | tr -cd '\11\12\15\40-\176' | jq -Rs . 2>/dev/null)
        # 如果 jq 失败，使用 null
        if [[ -z "$error_summary" || "$error_summary" == '""' ]]; then
            error_summary="null"
        fi
    fi

    cat <<EOF
{
    "score": $score,
    "passed": $passed,
    "test_count": $test_count,
    "duration": "${duration}s",
    "error_summary": $error_summary
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

    # 获取完整数据
    local full_data
    full_data=$(generate_full_data)

    # L2 fix: 验证 full_data 是有效 JSON
    if ! echo "$full_data" | jq empty 2>/dev/null; then
        echo -e "${RED}错误: Python 生成的数据不是有效 JSON${NC}" >&2
        echo '{"error": "invalid json from python"}' >&2
        return 1
    fi

    # 提取各部分
    local features rcis golden_paths gates meta e2e
    features=$(echo "$full_data" | jq '.features // []')
    rcis=$(echo "$full_data" | jq '.rcis // {}')
    golden_paths=$(echo "$full_data" | jq '.golden_paths // []')
    gates=$(echo "$full_data" | jq '.gates // {}')
    meta=$(echo "$full_data" | jq '.meta // {"score": 0}')
    e2e=$(echo "$full_data" | jq '.e2e // {"score": 0}')

    # 计算 Unit
    local unit=$(calculate_unit)

    # 计算 overall
    local meta_score=$(echo "$meta" | jq -r '.score')
    local unit_score=$(echo "$unit" | jq -r '.score')
    local e2e_score=$(echo "$e2e" | jq -r '.score')

    local overall
    if [[ "$unit_score" == "-1" ]]; then
        overall=$(( (meta_score + e2e_score) / 2 ))
    else
        overall=$(( (meta_score + unit_score + e2e_score) / 3 ))
    fi

    cat <<EOF
{
  "repo": "$repo",
  "version": "$version",
  "timestamp": "$timestamp",
  "summary": {
    "meta": $meta,
    "unit": $unit,
    "e2e": $e2e,
    "overall": $overall
  },
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
            --fast|-f)
                FAST_MODE=true
                shift
                ;;
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
                echo "用法: $0 [--fast] [--output] [--post URL]"
                echo ""
                echo "选项:"
                echo "  --fast, -f      快速模式（跳过 npm run qa）"
                echo "  --output, -o    输出到 .qa-report.json"
                echo "  --post, -p URL  POST 到指定 URL"
                echo "  --help, -h      显示帮助"
                exit 0
                ;;
            *)
                # L3 fix: 警告未知参数而不是静默忽略
                echo -e "${YELLOW}警告: 未知参数 '$1'，已忽略${NC}" >&2
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
            # L1 fix: 添加 curl 超时参数
            if ! echo "$report" | curl -s --max-time 30 --connect-timeout 10 -X POST "$url" \
                -H "Content-Type: application/json" \
                -d @-; then
                echo -e "${RED}错误: POST 请求失败${NC}" >&2
                exit 1
            fi
            echo -e "${GREEN}报告已 POST 到 $url${NC}"
            ;;
    esac
}

main "$@"
