#!/bin/bash
# generate-gate-file.sh - 生成带签名的 gate 通过文件
#
# 用法: bash scripts/gate/generate-gate-file.sh <gate_type>
#   gate_type: prd | dod | test | audit
#
# 输出: .gate-<type>-passed 文件
#
# v3: 添加 expires_at/tree_sha/repo_id 字段，改进 secret 读取
# v2.1: head_sha 加入签名算法，防止跨 commit 复用
# v2: 添加 head_sha/generated_at/task_id/tool_version 字段

set -e

GATE_TYPE="${1:-}"
GATE_FILE=".gate-${GATE_TYPE}-passed"
TOOL_VERSION="3.0.0"

# 默认 30 分钟过期
TTL_SECONDS="${GATE_TTL_SECONDS:-1800}"

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

# 确保在 git 仓库中
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || {
    echo "❌ 不在 git 仓库中" >&2
    exit 2
}

# 获取 secret（优先级：env → keychain → 新路径文件 → 旧路径文件）
get_gate_secret() {
    # 1. 环境变量
    if [[ -n "${GATE_SECRET:-}" ]]; then
        printf "%s" "$GATE_SECRET"
        return 0
    fi

    # 2. macOS Keychain（如果可用）
    if command -v security >/dev/null 2>&1; then
        local kc
        kc="$(security find-generic-password -a "$USER" -s "cecelia-gate-secret" -w 2>/dev/null || true)"
        if [[ -n "$kc" ]]; then
            printf "%s" "$kc"
            return 0
        fi
    fi

    # 3. 新路径文件
    local new_secret_file="${GATE_SECRET_FILE:-$HOME/.config/cecelia/gate-secret}"
    if [[ -f "$new_secret_file" ]]; then
        chmod 600 "$new_secret_file" 2>/dev/null || true
        cat "$new_secret_file" | tr -d '\n\r'
        return 0
    fi

    # 4. 旧路径文件（向后兼容）
    local old_secret_file="$HOME/.claude/.gate-secret"
    if [[ -f "$old_secret_file" ]]; then
        chmod 600 "$old_secret_file" 2>/dev/null || true
        cat "$old_secret_file" | tr -d '\n\r'
        return 0
    fi

    # 5. 自动生成（首次运行）
    echo "ℹ️ 首次运行，生成 gate secret..." >&2
    mkdir -p "$(dirname "$new_secret_file")"
    openssl rand -hex 32 > "$new_secret_file"
    chmod 600 "$new_secret_file"
    echo "✅ Secret 已生成: $new_secret_file" >&2
    cat "$new_secret_file" | tr -d '\n\r'
}

# 获取当前分支
get_current_branch() {
    git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown"
}

# 获取当前 commit SHA
get_head_sha() {
    git rev-parse HEAD 2>/dev/null || echo "unknown"
}

# 获取当前 tree SHA
get_tree_sha() {
    git rev-parse HEAD^{tree} 2>/dev/null || echo "unknown"
}

# 获取 repo_id（基于 remote URL 或工作区路径的 hash）
get_repo_id() {
    local remote_url
    remote_url="$(git remote get-url origin 2>/dev/null || true)"

    local repo_id_raw
    if [[ -n "$remote_url" ]]; then
        repo_id_raw="$remote_url"
    else
        repo_id_raw="$(pwd)"
    fi

    printf "%s" "$repo_id_raw" | sha256sum | cut -d' ' -f1
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
# v3: 增加 tree_sha 和 repo_id 参数
generate_signature() {
    local gate="$1"
    local decision="$2"
    local created_at="$3"
    local expires_at="$4"
    local branch="$5"
    local head_sha="$6"
    local tree_sha="$7"
    local repo_id="$8"
    local secret="$9"

    # 签名算法 v3: sha256("{gate}:{decision}:{created_at}:{expires_at}:{branch}:{head_sha}:{tree_sha}:{repo_id}:{secret}")
    echo -n "${gate}:${decision}:${created_at}:${expires_at}:${branch}:${head_sha}:${tree_sha}:${repo_id}:${secret}" | sha256sum | cut -d' ' -f1
}

# 主逻辑
main() {
    local secret
    secret=$(get_gate_secret)

    local branch
    branch=$(get_current_branch)

    local head_sha
    head_sha=$(get_head_sha)

    local tree_sha
    tree_sha=$(get_tree_sha)

    local repo_id
    repo_id=$(get_repo_id)

    local task_id
    task_id=$(get_task_id "$branch")

    # 时间戳（Unix epoch）
    local now
    now=$(date +%s)

    local created_at
    created_at=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

    local expires_at_epoch
    expires_at_epoch=$((now + TTL_SECONDS))

    local expires_at
    expires_at=$(date -u -d "@$expires_at_epoch" +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || \
                 date -u -r "$expires_at_epoch" +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || \
                 echo "")

    local decision="PASS"

    # 签名包含所有关键字段（v3: 增加 tree_sha, repo_id）
    local signature
    signature=$(generate_signature "$GATE_TYPE" "$decision" "$created_at" "$expires_at" "$branch" "$head_sha" "$tree_sha" "$repo_id" "$secret")

    # 生成 JSON 文件（使用 jq 防止特殊字符破坏 JSON）
    jq -n \
        --argjson version 3 \
        --arg gate "$GATE_TYPE" \
        --arg decision "$decision" \
        --arg created_at "$created_at" \
        --arg expires_at "$expires_at" \
        --argjson expires_at_epoch "$expires_at_epoch" \
        --arg branch "$branch" \
        --arg head_sha "$head_sha" \
        --arg tree_sha "$tree_sha" \
        --arg repo_id "$repo_id" \
        --arg task_id "$task_id" \
        --arg tool_version "$TOOL_VERSION" \
        --arg signature "$signature" \
        '{
          version: $version,
          gate: $gate,
          decision: $decision,
          created_at: $created_at,
          expires_at: $expires_at,
          expires_at_epoch: $expires_at_epoch,
          branch: $branch,
          head_sha: $head_sha,
          tree_sha: $tree_sha,
          repo_id: $repo_id,
          task_id: $task_id,
          tool_version: $tool_version,
          signature: $signature
        }' \
        > "$GATE_FILE"

    local ttl_minutes=$((TTL_SECONDS / 60))
    echo "✅ Gate 文件已生成: $GATE_FILE" >&2
    echo "   version: 3" >&2
    echo "   gate: $GATE_TYPE" >&2
    echo "   branch: $branch" >&2
    echo "   head_sha: ${head_sha:0:8}..." >&2
    echo "   tree_sha: ${tree_sha:0:8}..." >&2
    echo "   expires_in: ${ttl_minutes} 分钟" >&2
}

main
