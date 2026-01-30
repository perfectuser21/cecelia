#!/bin/bash
# verify-gate-signature.sh - 验证 gate 文件签名
#
# 用法: bash scripts/gate/verify-gate-signature.sh <gate_file>
#
# Exit Code 分层（v2）:
#   0 - 验证通过
#   2 - 策略拦截（阻止型，用于 Hook）
#   3 - 验证器缺失/配置错误（secret 不存在）
#   4 - 输入格式错误/JSON 解析失败
#   5 - 签名/校验失败
#   6 - 分支/任务不匹配

set -e

GATE_FILE="${1:-}"
SECRET_FILE="$HOME/.claude/.gate-secret"

# Exit codes
EXIT_OK=0
EXIT_POLICY_BLOCK=2
EXIT_CONFIG_ERROR=3
EXIT_FORMAT_ERROR=4
EXIT_SIGNATURE_FAIL=5
EXIT_BRANCH_MISMATCH=6

# 验证参数
if [[ -z "$GATE_FILE" ]]; then
    echo "❌ 用法: bash scripts/gate/verify-gate-signature.sh <gate_file>" >&2
    exit $EXIT_FORMAT_ERROR
fi

if [[ ! -f "$GATE_FILE" ]]; then
    echo "❌ Gate 文件不存在: $GATE_FILE" >&2
    exit $EXIT_FORMAT_ERROR
fi

if [[ ! -f "$SECRET_FILE" ]]; then
    echo "❌ Secret 文件不存在: $SECRET_FILE" >&2
    echo "   请先运行 generate-gate-file.sh 生成 secret" >&2
    exit $EXIT_CONFIG_ERROR
fi

# 获取当前分支
get_current_branch() {
    git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown"
}

# 生成签名（与 generate-gate-file.sh 保持一致）
generate_signature() {
    local gate="$1"
    local decision="$2"
    local generated_at="$3"
    local branch="$4"
    local secret="$5"

    echo -n "${gate}:${decision}:${generated_at}:${branch}:${secret}" | sha256sum | cut -d' ' -f1
}

# 主逻辑
main() {
    local secret
    secret=$(cat "$SECRET_FILE" | tr -d '\n\r')

    local current_branch
    current_branch=$(get_current_branch)

    # 解析 JSON 文件
    if ! jq empty "$GATE_FILE" 2>/dev/null; then
        echo "❌ Gate 文件不是有效的 JSON: $GATE_FILE" >&2
        exit $EXIT_FORMAT_ERROR
    fi

    local gate decision generated_at branch head_sha task_id tool_version signature
    gate=$(jq -r '.gate // ""' "$GATE_FILE")
    decision=$(jq -r '.decision // ""' "$GATE_FILE")
    # 兼容旧版本（timestamp）和新版本（generated_at）
    generated_at=$(jq -r '.generated_at // .timestamp // ""' "$GATE_FILE")
    branch=$(jq -r '.branch // ""' "$GATE_FILE")
    head_sha=$(jq -r '.head_sha // ""' "$GATE_FILE")
    task_id=$(jq -r '.task_id // ""' "$GATE_FILE")
    tool_version=$(jq -r '.tool_version // ""' "$GATE_FILE")
    signature=$(jq -r '.signature // ""' "$GATE_FILE")

    # 检查必需字段（gate, decision, generated_at, branch, signature）
    if [[ -z "$gate" || "$gate" == "null" ]]; then
        echo "❌ Gate 文件缺少 'gate' 字段: $GATE_FILE" >&2
        exit $EXIT_FORMAT_ERROR
    fi
    if [[ -z "$decision" || "$decision" == "null" ]]; then
        echo "❌ Gate 文件缺少 'decision' 字段: $GATE_FILE" >&2
        exit $EXIT_FORMAT_ERROR
    fi
    if [[ -z "$generated_at" || "$generated_at" == "null" ]]; then
        echo "❌ Gate 文件缺少 'generated_at' 字段: $GATE_FILE" >&2
        exit $EXIT_FORMAT_ERROR
    fi
    if [[ -z "$branch" || "$branch" == "null" ]]; then
        echo "❌ Gate 文件缺少 'branch' 字段: $GATE_FILE" >&2
        exit $EXIT_FORMAT_ERROR
    fi
    if [[ -z "$signature" || "$signature" == "null" ]]; then
        echo "❌ Gate 文件缺少 'signature' 字段: $GATE_FILE" >&2
        exit $EXIT_FORMAT_ERROR
    fi

    # 检查分支匹配
    if [[ "$branch" != "$current_branch" ]]; then
        echo "❌ Gate 文件分支不匹配" >&2
        echo "   文件分支: $branch" >&2
        echo "   当前分支: $current_branch" >&2
        exit $EXIT_BRANCH_MISMATCH
    fi

    # 验证签名
    local expected_signature
    expected_signature=$(generate_signature "$gate" "$decision" "$generated_at" "$branch" "$secret")

    if [[ "$signature" != "$expected_signature" ]]; then
        echo "❌ Gate 文件签名无效" >&2
        echo "   可能原因: 文件被篡改或 secret 不匹配" >&2
        exit $EXIT_SIGNATURE_FAIL
    fi

    # 验证通过，输出详情
    echo "✅ Gate 文件验证通过: $GATE_FILE" >&2
    echo "   gate: $gate" >&2
    echo "   branch: $branch" >&2
    if [[ -n "$head_sha" && "$head_sha" != "null" ]]; then
        echo "   head_sha: ${head_sha:0:8}..." >&2
    fi
    if [[ -n "$task_id" && "$task_id" != "null" ]]; then
        echo "   task_id: $task_id" >&2
    fi
    echo "   generated_at: $generated_at" >&2
    exit $EXIT_OK
}

main
