#!/usr/bin/env bash
# schedule.json 格式验证脚本
#
# 用法：
#   bash validate-schedule-json.sh <schedule.json 路径>
#   echo '{"publishAt":"2026-03-19T14:00:00+08:00","platforms":["douyin"]}' | bash validate-schedule-json.sh -
#
# 退出码：
#   0 - 验证通过
#   1 - 验证失败（错误信息输出到 stderr）

set -euo pipefail

VALID_PLATFORMS=("douyin" "xiaohongshu" "weibo" "kuaishou" "toutiao" "zhihu" "wechat" "shipinhao")
VALID_CONTENT_TYPES=("video" "image" "article")

# ─── 颜色输出 ─────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

error()   { echo -e "${RED}[ERROR]${NC} $*" >&2; }
success() { echo -e "${GREEN}[OK]${NC}   $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC} $*" >&2; }

# ─── 主验证逻辑 ───────────────────────────────────────────────────────────────
validate() {
    local input_file="${1:--}"
    local json_content errors=0

    # 读取 JSON
    if [[ "$input_file" == "-" ]]; then
        json_content=$(cat)
    else
        if [[ ! -f "$input_file" ]]; then
            error "文件不存在：$input_file"
            exit 1
        fi
        json_content=$(cat "$input_file")
    fi

    # 检查 jq 依赖
    if ! command -v jq &>/dev/null; then
        error "缺少依赖：jq（请安装：brew install jq）"
        exit 1
    fi

    # 检查 JSON 语法
    if ! echo "$json_content" | jq . > /dev/null 2>&1; then
        error "无效的 JSON 格式"
        exit 1
    fi

    echo "验证 schedule.json 格式..."
    echo ""

    # ── 必填字段：publishAt ─────────────────────────────────────────────────
    local publish_at
    publish_at=$(echo "$json_content" | jq -r '.publishAt // empty')

    if [[ -z "$publish_at" ]]; then
        error "缺少必填字段：publishAt"
        ((errors++)) || true
    else
        # 验证 ISO 8601 格式（基本检查：包含 T 分隔符）
        if [[ ! "$publish_at" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2} ]]; then
            error "publishAt 格式无效（需为 ISO 8601：2026-03-19T14:00:00+08:00）：$publish_at"
            ((errors++)) || true
        else
            success "publishAt: $publish_at"
        fi
    fi

    # ── 必填字段：platforms ──────────────────────────────────────────────────
    local platforms_json platforms_count
    platforms_json=$(echo "$json_content" | jq -r '.platforms // empty')

    if [[ -z "$platforms_json" ]]; then
        error "缺少必填字段：platforms"
        ((errors++)) || true
    else
        platforms_count=$(echo "$json_content" | jq '.platforms | length')

        if [[ "$platforms_count" -eq 0 ]]; then
            error "platforms 不能为空数组"
            ((errors++)) || true
        else
            # 验证每个平台名称
            local invalid_platforms=()
            while IFS= read -r platform; do
                local valid=false
                for vp in "${VALID_PLATFORMS[@]}"; do
                    [[ "$platform" == "$vp" ]] && valid=true && break
                done
                [[ "$valid" == false ]] && invalid_platforms+=("$platform")
            done < <(echo "$json_content" | jq -r '.platforms[]')

            if [[ ${#invalid_platforms[@]} -gt 0 ]]; then
                error "无效平台名称：${invalid_platforms[*]}"
                error "  允许的平台：${VALID_PLATFORMS[*]}"
                ((errors++)) || true
            else
                local platforms_str
                platforms_str=$(echo "$json_content" | jq -r '.platforms | join(", ")')
                success "platforms: [$platforms_str]"
            fi
        fi
    fi

    # ── 可选字段：contentType ────────────────────────────────────────────────
    local content_type
    content_type=$(echo "$json_content" | jq -r '.contentType // empty')

    if [[ -z "$content_type" ]]; then
        warn "contentType 未设置（将使用默认值 'image'）"
    else
        local valid_type=false
        for vt in "${VALID_CONTENT_TYPES[@]}"; do
            [[ "$content_type" == "$vt" ]] && valid_type=true && break
        done

        if [[ "$valid_type" == false ]]; then
            error "无效的 contentType：$content_type（允许：${VALID_CONTENT_TYPES[*]}）"
            ((errors++)) || true
        else
            success "contentType: $content_type"
        fi
    fi

    # ── 可选字段：published_at ───────────────────────────────────────────────
    local published_at
    published_at=$(echo "$json_content" | jq -r '.published_at // empty')

    if [[ -n "$published_at" && "$published_at" != "null" ]]; then
        warn "published_at 已设置（${published_at}）——此内容已发布，不会被再次触发"
    fi

    echo ""

    # ── 总结 ────────────────────────────────────────────────────────────────
    if [[ $errors -gt 0 ]]; then
        echo -e "${RED}✗ 验证失败（${errors} 个错误）${NC}" >&2
        exit 1
    else
        echo -e "${GREEN}✓ 验证通过${NC}"
        exit 0
    fi
}

# ─── 使用说明 ─────────────────────────────────────────────────────────────────
usage() {
    echo "用法：bash validate-schedule-json.sh [schedule.json 路径]"
    echo ""
    echo "示例："
    echo "  bash validate-schedule-json.sh /path/to/schedule.json"
    echo "  echo '{\"publishAt\":\"2026-03-19T14:00:00+08:00\",\"platforms\":[\"douyin\"]}' | bash validate-schedule-json.sh -"
    echo ""
    echo "schedule.json 格式："
    echo '  {'
    echo '    "publishAt": "2026-03-19T14:00:00+08:00",  // 必填，ISO 8601 格式'
    echo '    "platforms": ["douyin", "xiaohongshu"],      // 必填，至少一个平台'
    echo '    "contentType": "video",                      // 可选：video/image/article'
    echo '    "title": "内容标题",                         // 可选'
    echo '    "published_at": null                         // 系统自动写入，勿手动填写'
    echo '  }'
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
    usage
    exit 0
fi

validate "${1:--}"
