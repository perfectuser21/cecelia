#!/bin/bash
# verify-gate-signature.sh - 验证 gate 文件签名
#
# 用法: bash scripts/gate/verify-gate-signature.sh <gate_file>
#
# Exit Code 分层（v3）:
#   0 - 验证通过
#   2 - 策略拦截（阻止型，用于 Hook）
#   3 - 验证器缺失/配置错误（secret 不存在）
#   4 - 输入格式错误/JSON 解析失败
#   5 - 签名/校验失败
#   6 - 分支/任务不匹配
#   7 - Gate 文件已过期（v3 新增）
#   8 - HEAD 不匹配（commit 或 tree 变化）（v3 新增）
#   9 - Repo ID 不匹配（v3 新增）
#
# v3: 添加过期检查、tree_sha 验证、repo_id 验证
# v2.1: head_sha 加入签名算法，防止跨 commit 复用

set -e

GATE_FILE="${1:-}"

# Exit codes
EXIT_OK=0
EXIT_POLICY_BLOCK=2
EXIT_CONFIG_ERROR=3
EXIT_FORMAT_ERROR=4
EXIT_SIGNATURE_FAIL=5
EXIT_BRANCH_MISMATCH=6
EXIT_EXPIRED=7
EXIT_HEAD_MISMATCH=8
EXIT_REPO_MISMATCH=9

# 验证参数
if [[ -z "$GATE_FILE" ]]; then
    echo "❌ 用法: bash scripts/gate/verify-gate-signature.sh <gate_file>" >&2
    exit $EXIT_FORMAT_ERROR
fi

if [[ ! -f "$GATE_FILE" ]]; then
    echo "❌ Gate 文件不存在: $GATE_FILE" >&2
    exit $EXIT_FORMAT_ERROR
fi

# 获取 secret（与 generate-gate-file.sh 保持一致）
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

    echo "" # 返回空，让调用者处理
}

# 获取当前分支
get_current_branch() {
    git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown"
}

# 获取当前 HEAD SHA
get_head_sha() {
    git rev-parse HEAD 2>/dev/null || echo "unknown"
}

# 获取当前 tree SHA
get_tree_sha() {
    git rev-parse HEAD^{tree} 2>/dev/null || echo "unknown"
}

# 获取当前 repo_id
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

# 生成签名（v2 格式，向后兼容）
generate_signature_v2() {
    local gate="$1"
    local decision="$2"
    local generated_at="$3"
    local branch="$4"
    local head_sha="$5"
    local secret="$6"

    echo -n "${gate}:${decision}:${generated_at}:${branch}:${head_sha}:${secret}" | sha256sum | cut -d' ' -f1
}

# 生成签名（v3 格式）
generate_signature_v3() {
    local gate="$1"
    local decision="$2"
    local created_at="$3"
    local expires_at="$4"
    local branch="$5"
    local head_sha="$6"
    local tree_sha="$7"
    local repo_id="$8"
    local secret="$9"

    echo -n "${gate}:${decision}:${created_at}:${expires_at}:${branch}:${head_sha}:${tree_sha}:${repo_id}:${secret}" | sha256sum | cut -d' ' -f1
}

# 主逻辑
main() {
    local secret
    secret=$(get_gate_secret)

    if [[ -z "$secret" ]]; then
        echo "❌ Secret 文件不存在" >&2
        echo "   请先运行 generate-gate-file.sh 生成 secret" >&2
        exit $EXIT_CONFIG_ERROR
    fi

    local current_branch
    current_branch=$(get_current_branch)

    local current_head
    current_head=$(get_head_sha)

    local current_tree
    current_tree=$(get_tree_sha)

    local current_repo_id
    current_repo_id=$(get_repo_id)

    # 解析 JSON 文件
    if ! jq empty "$GATE_FILE" 2>/dev/null; then
        echo "❌ Gate 文件不是有效的 JSON: $GATE_FILE" >&2
        exit $EXIT_FORMAT_ERROR
    fi

    # 读取版本号
    local version
    version=$(jq -r '.version // 2' "$GATE_FILE")

    local gate decision branch head_sha signature
    gate=$(jq -r '.gate // ""' "$GATE_FILE")
    decision=$(jq -r '.decision // ""' "$GATE_FILE")
    branch=$(jq -r '.branch // ""' "$GATE_FILE")
    head_sha=$(jq -r '.head_sha // ""' "$GATE_FILE")
    signature=$(jq -r '.signature // ""' "$GATE_FILE")

    # 检查必需字段
    if [[ -z "$gate" || "$gate" == "null" ]]; then
        echo "❌ Gate 文件缺少 'gate' 字段" >&2
        exit $EXIT_FORMAT_ERROR
    fi
    if [[ -z "$decision" || "$decision" == "null" ]]; then
        echo "❌ Gate 文件缺少 'decision' 字段" >&2
        exit $EXIT_FORMAT_ERROR
    fi
    if [[ -z "$branch" || "$branch" == "null" ]]; then
        echo "❌ Gate 文件缺少 'branch' 字段" >&2
        exit $EXIT_FORMAT_ERROR
    fi
    if [[ -z "$signature" || "$signature" == "null" ]]; then
        echo "❌ Gate 文件缺少 'signature' 字段" >&2
        exit $EXIT_FORMAT_ERROR
    fi

    # 检查分支匹配
    if [[ "$branch" != "$current_branch" ]]; then
        echo "❌ Gate 文件分支不匹配" >&2
        echo "   文件分支: $branch" >&2
        echo "   当前分支: $current_branch" >&2
        exit $EXIT_BRANCH_MISMATCH
    fi

    # 根据版本号选择验证逻辑
    if [[ "$version" -ge 3 ]]; then
        # ===== v3 验证 =====
        local created_at expires_at expires_at_epoch tree_sha repo_id
        created_at=$(jq -r '.created_at // ""' "$GATE_FILE")
        expires_at=$(jq -r '.expires_at // ""' "$GATE_FILE")
        expires_at_epoch=$(jq -r '.expires_at_epoch // 0' "$GATE_FILE")
        tree_sha=$(jq -r '.tree_sha // ""' "$GATE_FILE")
        repo_id=$(jq -r '.repo_id // ""' "$GATE_FILE")

        # 检查 v3 必需字段
        if [[ -z "$created_at" || "$created_at" == "null" ]]; then
            echo "❌ Gate 文件缺少 'created_at' 字段" >&2
            exit $EXIT_FORMAT_ERROR
        fi
        if [[ -z "$head_sha" || "$head_sha" == "null" ]]; then
            echo "❌ Gate 文件缺少 'head_sha' 字段" >&2
            exit $EXIT_FORMAT_ERROR
        fi
        if [[ -z "$tree_sha" || "$tree_sha" == "null" ]]; then
            echo "❌ Gate 文件缺少 'tree_sha' 字段" >&2
            exit $EXIT_FORMAT_ERROR
        fi
        if [[ -z "$repo_id" || "$repo_id" == "null" ]]; then
            echo "❌ Gate 文件缺少 'repo_id' 字段" >&2
            exit $EXIT_FORMAT_ERROR
        fi

        # 1. 过期检查（硬失败）
        local now
        now=$(date +%s)
        if [[ "$expires_at_epoch" -gt 0 && "$now" -gt "$expires_at_epoch" ]]; then
            echo "❌ Gate 文件已过期" >&2
            echo "   过期时间: $expires_at" >&2
            echo "   当前时间: $(date -u +"%Y-%m-%dT%H:%M:%SZ")" >&2
            echo "   请重新运行对应的 gate skill 生成新文件" >&2
            exit $EXIT_EXPIRED
        fi

        # 2. HEAD 绑定检查（commit + tree 都要匹配）
        if [[ "$head_sha" != "$current_head" ]]; then
            echo "❌ Gate 文件 HEAD 不匹配" >&2
            echo "   文件 commit: ${head_sha:0:8}..." >&2
            echo "   当前 commit: ${current_head:0:8}..." >&2
            echo "   代码已变更，请重新运行 gate skill" >&2
            exit $EXIT_HEAD_MISMATCH
        fi
        if [[ "$tree_sha" != "$current_tree" ]]; then
            echo "❌ Gate 文件 tree 不匹配" >&2
            echo "   文件 tree: ${tree_sha:0:8}..." >&2
            echo "   当前 tree: ${current_tree:0:8}..." >&2
            echo "   代码已变更，请重新运行 gate skill" >&2
            exit $EXIT_HEAD_MISMATCH
        fi

        # 3. Repo ID 检查（防止跨仓库复用）
        if [[ "$repo_id" != "$current_repo_id" ]]; then
            echo "❌ Gate 文件 repo 不匹配" >&2
            echo "   文件是在其他仓库生成的" >&2
            exit $EXIT_REPO_MISMATCH
        fi

        # 4. 签名验证
        local expected_signature
        expected_signature=$(generate_signature_v3 "$gate" "$decision" "$created_at" "$expires_at" "$branch" "$head_sha" "$tree_sha" "$repo_id" "$secret")

        if [[ "$signature" != "$expected_signature" ]]; then
            echo "❌ Gate 文件签名无效" >&2
            echo "   可能原因: 文件被篡改或 secret 不匹配" >&2
            exit $EXIT_SIGNATURE_FAIL
        fi

    else
        # ===== v2 验证（向后兼容）=====
        # 兼容旧版本（timestamp）和新版本（generated_at）
        local generated_at
        generated_at=$(jq -r '.generated_at // .timestamp // ""' "$GATE_FILE")

        if [[ -z "$generated_at" || "$generated_at" == "null" ]]; then
            echo "❌ Gate 文件缺少时间戳字段" >&2
            exit $EXIT_FORMAT_ERROR
        fi

        # v2 需要 head_sha
        if [[ -z "$head_sha" || "$head_sha" == "null" ]]; then
            echo "❌ Gate 文件缺少 'head_sha' 字段" >&2
            echo "   此文件是旧版本生成的，请重新运行 generate-gate-file.sh" >&2
            exit $EXIT_FORMAT_ERROR
        fi

        # 签名验证
        local expected_signature
        expected_signature=$(generate_signature_v2 "$gate" "$decision" "$generated_at" "$branch" "$head_sha" "$secret")

        if [[ "$signature" != "$expected_signature" ]]; then
            echo "❌ Gate 文件签名无效" >&2
            echo "   可能原因: 文件被篡改或 secret 不匹配" >&2
            exit $EXIT_SIGNATURE_FAIL
        fi

        # v2 文件警告：建议升级
        echo "⚠️  Gate 文件是 v2 格式，建议重新生成以获得更好的安全性" >&2
    fi

    # 验证通过
    local tool_version
    tool_version=$(jq -r '.tool_version // "unknown"' "$GATE_FILE")

    echo "✅ Gate 文件验证通过: $GATE_FILE" >&2
    echo "   version: $version" >&2
    echo "   gate: $gate" >&2
    echo "   branch: $branch" >&2
    echo "   head_sha: ${head_sha:0:8}..." >&2
    if [[ "$version" -ge 3 ]]; then
        echo "   tree_sha: ${tree_sha:0:8}..." >&2
        echo "   expires_at: $expires_at" >&2
    fi
    exit $EXIT_OK
}

main
