#!/bin/bash
# generate-gate-file.sh - 生成带签名的 gate 通过文件
#
# 用法: bash scripts/gate/generate-gate-file.sh <gate_type>
#   gate_type: prd | dod | test | audit
#
# 输出: .gate-<type>-passed 文件
#
# v2: 添加 head_sha/generated_at/task_id/tool_version 字段

set -e

GATE_TYPE="${1:-}"
SECRET_FILE="$HOME/.claude/.gate-secret"
GATE_FILE=".gate-${GATE_TYPE}-passed"
TOOL_VERSION="2.0.0"

# 验证参数
if [[ -z "$GATE_TYPE" ]]; then
    echo "❌ 用法: bash scripts/gate/generate-gate-file.sh <gate_type>" >&2
    echo "   gate_type: prd | dod | test | audit" >&2
    exit 1
fi

if [[ ! "$GATE_TYPE" =~ ^(prd|dod|test|audit)$ ]]; then
    echo "❌ 无效的 gate 类型: $GATE_TYPE" >&2
    echo "   有效类型: prd | dod | test | audit" >&2
    exit 1
fi

# 确保 secret 存在
ensure_secret() {
    local secret_dir="$HOME/.claude"

    if [[ ! -d "$secret_dir" ]]; then
        mkdir -p "$secret_dir"
    fi

    if [[ ! -f "$SECRET_FILE" ]]; then
        echo "ℹ️ 首次运行，生成 gate secret..." >&2
        openssl rand -hex 32 > "$SECRET_FILE"
        chmod 600 "$SECRET_FILE"
        echo "✅ Secret 已生成: $SECRET_FILE" >&2
    fi
}

# 获取当前分支
get_current_branch() {
    git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown"
}

# 获取当前 commit SHA
get_head_sha() {
    git rev-parse HEAD 2>/dev/null || echo "unknown"
}

# 从分支名提取 task_id（cp-MMDD-xxx → MMDD-xxx）
get_task_id() {
    local branch="$1"
    if [[ "$branch" =~ ^cp-(.+)$ ]]; then
        echo "${BASH_REMATCH[1]}"
    elif [[ "$branch" =~ ^feature/(.+)$ ]]; then
        echo "${BASH_REMATCH[1]}"
    else
        echo "$branch"
    fi
}

# 生成签名
generate_signature() {
    local gate="$1"
    local decision="$2"
    local timestamp="$3"
    local branch="$4"
    local secret="$5"

    # 签名算法: sha256("{gate}:{decision}:{timestamp}:{branch}:{secret}")
    echo -n "${gate}:${decision}:${timestamp}:${branch}:${secret}" | sha256sum | cut -d' ' -f1
}

# 主逻辑
main() {
    ensure_secret

    local secret
    secret=$(cat "$SECRET_FILE" | tr -d '\n\r')

    local branch
    branch=$(get_current_branch)

    local head_sha
    head_sha=$(get_head_sha)

    local task_id
    task_id=$(get_task_id "$branch")

    local generated_at
    generated_at=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

    local decision="PASS"

    # 签名包含所有关键字段
    local signature
    signature=$(generate_signature "$GATE_TYPE" "$decision" "$generated_at" "$branch" "$secret")

    # 生成 JSON 文件（使用 jq 防止特殊字符破坏 JSON）
    jq -n \
        --arg gate "$GATE_TYPE" \
        --arg decision "$decision" \
        --arg generated_at "$generated_at" \
        --arg branch "$branch" \
        --arg head_sha "$head_sha" \
        --arg task_id "$task_id" \
        --arg tool_version "$TOOL_VERSION" \
        --arg signature "$signature" \
        '{
          gate: $gate,
          decision: $decision,
          generated_at: $generated_at,
          branch: $branch,
          head_sha: $head_sha,
          task_id: $task_id,
          tool_version: $tool_version,
          signature: $signature
        }' \
        > "$GATE_FILE"

    echo "✅ Gate 文件已生成: $GATE_FILE" >&2
    echo "   gate: $GATE_TYPE" >&2
    echo "   branch: $branch" >&2
    echo "   head_sha: ${head_sha:0:8}..." >&2
    echo "   task_id: $task_id" >&2
    echo "   generated_at: $generated_at" >&2
}

main
