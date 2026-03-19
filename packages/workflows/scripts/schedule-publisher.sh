#!/usr/bin/env bash
# 定时发布内容队列调度脚本
#
# 用法：bash schedule-publisher.sh
# 推荐：通过 setup-publisher-cron.sh 注册为 cron，每 5 分钟自动运行
#
# schedule.json 格式（放在 NAS 每个内容目录下）：
# {
#   "publishAt": "2026-03-19T14:00:00+08:00",   // 计划发布时间（ISO 8601，支持时区）
#   "platforms": ["douyin", "xiaohongshu"],       // 目标平台列表
#   "contentType": "video",                       // 内容类型：video / image / article
#   "title": "内容标题",                          // 可选，默认用 content_id
#   "published_at": null                          // 发布后写入时间戳（防重复触发）
# }

set -euo pipefail

# ─── 配置 ─────────────────────────────────────────────────────────────────────
NAS_IP="${NAS_IP:-100.110.241.76}"
NAS_USER="${NAS_USER:-徐啸}"
NAS_BASE="${NAS_BASE:-/volume1/workspace/vault/zenithjoy-creator/content}"
N8N_API_URL="${N8N_API_URL:-http://localhost:5679}"
N8N_WEBHOOK_PATH="content-publish"
FEISHU_BOT_WEBHOOK="${FEISHU_BOT_WEBHOOK:-}"

# 时间窗口：publishAt 在未来 300 秒（5 分钟）内的内容将被触发
TRIGGER_WINDOW_SECONDS=300

# 已过期超过此时间（秒）的内容跳过（避免意外补发）
EXPIRE_GRACE_SECONDS=3600

# 日志前缀（带时区）
LOG_PREFIX="[schedule-publisher] $(TZ=Asia/Shanghai date '+%Y-%m-%d %H:%M:%S')"

# ─── 工具函数 ─────────────────────────────────────────────────────────────────
log_info()  { echo "${LOG_PREFIX} [INFO]  $*"; }
log_warn()  { echo "${LOG_PREFIX} [WARN]  $*" >&2; }
log_error() { echo "${LOG_PREFIX} [ERROR] $*" >&2; }

# 依赖检查
check_deps() {
    local missing=0
    for cmd in ssh jq curl; do
        if ! command -v "$cmd" &>/dev/null; then
            log_error "缺少依赖：$cmd"
            missing=1
        fi
    done
    [[ $missing -eq 0 ]] || { log_error "请先安装缺少的依赖"; exit 1; }
}

# 飞书通知（失败不影响主流程）
notify_feishu() {
    local message="$1"
    if [[ -z "$FEISHU_BOT_WEBHOOK" ]]; then
        log_warn "FEISHU_BOT_WEBHOOK 未配置，跳过飞书通知"
        return 0
    fi
    curl -s -X POST "$FEISHU_BOT_WEBHOOK" \
        -H "Content-Type: application/json" \
        -d "{\"msg_type\":\"text\",\"content\":{\"text\":\"${message}\"}}" \
        --max-time 10 \
        > /dev/null 2>&1 || log_warn "飞书通知发送失败（非致命）"
}

# 触发 N8N content-publish Webhook
trigger_n8n() {
    local content_id="$1"
    local title="$2"
    local platforms="$3"
    local content_type="$4"
    local content_dir="${NAS_BASE}/${content_id}"

    # 构造 platforms JSON 数组（逗号分隔字符串 → JSON）
    local platforms_json
    platforms_json=$(echo "$platforms" | jq -R 'split(",") | map(select(length > 0))')

    local webhook_url="${N8N_API_URL}/webhook/${N8N_WEBHOOK_PATH}"

    log_info "触发 N8N Webhook: ${webhook_url}"
    log_info "  内容: ${content_id} | 平台: ${platforms} | 类型: ${content_type}"

    local response
    response=$(curl -s -X POST "$webhook_url" \
        -H "Content-Type: application/json" \
        -d "{
            \"taskId\": \"sched-${content_id}\",
            \"title\": \"${title}\",
            \"content\": \"\",
            \"contentDir\": \"${content_dir}\",
            \"targetPlatforms\": ${platforms_json},
            \"contentType\": \"${content_type}\",
            \"scheduledPublish\": true
        }" \
        --max-time 30 \
        2>&1) || {
        log_error "N8N Webhook 调用失败：$response"
        return 1
    }

    log_info "N8N 响应: ${response:0:200}"
    return 0
}

# 将 published_at 写入 NAS schedule.json（防重复触发）
mark_published() {
    local content_id="$1"
    local schedule_path="${NAS_BASE}/${content_id}/schedule.json"
    local timestamp
    timestamp=$(TZ=Asia/Shanghai date '+%Y-%m-%dT%H:%M:%S+08:00')

    log_info "写入 published_at: ${content_id}"
    ssh "${NAS_USER}@${NAS_IP}" \
        "cat '${schedule_path}' | jq --arg ts '${timestamp}' '. + {\"published_at\": \$ts}' > /tmp/schedule_updated.json && mv /tmp/schedule_updated.json '${schedule_path}'" \
        2>/dev/null || {
        log_error "写入 published_at 失败：${content_id}"
        return 1
    }
}

# 解析 ISO 8601 时间为 Unix 时间戳（兼容 macOS 和 Linux）
parse_timestamp() {
    local iso_time="$1"
    # 取前 19 位（去掉时区后缀）
    local dt="${iso_time:0:19}"
    # 尝试 macOS BSD date 格式，失败则尝试 Linux GNU date 格式
    date -j -f "%Y-%m-%dT%H:%M:%S" "$dt" '+%s' 2>/dev/null \
        || date -d "$iso_time" '+%s' 2>/dev/null \
        || echo 0
}

# ─── 主扫描逻辑 ───────────────────────────────────────────────────────────────
main() {
    check_deps

    log_info "开始扫描 NAS 内容目录..."
    log_info "NAS: ${NAS_USER}@${NAS_IP}:${NAS_BASE}"

    # 获取所有包含 schedule.json 的内容目录
    local schedule_files
    schedule_files=$(ssh "${NAS_USER}@${NAS_IP}" \
        "find '${NAS_BASE}' -maxdepth 2 -name 'schedule.json' -type f 2>/dev/null | sort" \
        2>/dev/null) || {
        log_error "无法连接 NAS 或扫描目录"
        notify_feishu "⚠️ 定时发布扫描失败：无法连接 NAS ${NAS_IP}"
        exit 1
    }

    if [[ -z "$schedule_files" ]]; then
        log_info "未找到任何 schedule.json，本次扫描结束"
        exit 0
    fi

    local now_ts
    now_ts=$(date +%s)
    local triggered_count=0
    local skipped_count=0
    local error_count=0

    while IFS= read -r schedule_file; do
        [[ -z "$schedule_file" ]] && continue

        local content_id
        content_id=$(basename "$(dirname "$schedule_file")")

        # 读取 schedule.json
        local schedule_json
        schedule_json=$(ssh "${NAS_USER}@${NAS_IP}" "cat '${schedule_file}' 2>/dev/null") || {
            log_warn "无法读取 ${schedule_file}，跳过"
            ((error_count++)) || true
            continue
        }

        # 解析字段
        local publish_at published_at platforms content_type title
        publish_at=$(echo "$schedule_json"   | jq -r '.publishAt    // empty')
        published_at=$(echo "$schedule_json" | jq -r '.published_at // empty')
        platforms=$(echo "$schedule_json"    | jq -r '.platforms    // [] | join(",")')
        content_type=$(echo "$schedule_json" | jq -r '.contentType  // "image"')
        title=$(echo "$schedule_json"        | jq -r ".title        // \"${content_id}\"")

        # 跳过已发布
        if [[ -n "$published_at" && "$published_at" != "null" ]]; then
            log_info "已发布（${published_at}），跳过：${content_id}"
            ((skipped_count++)) || true
            continue
        fi

        # 跳过未设置 publishAt
        if [[ -z "$publish_at" || "$publish_at" == "null" ]]; then
            log_warn "未设置 publishAt，跳过：${content_id}"
            ((skipped_count++)) || true
            continue
        fi

        # 转换 publishAt 为 Unix 时间戳
        local publish_ts
        publish_ts=$(parse_timestamp "$publish_at")

        if [[ "$publish_ts" -eq 0 ]]; then
            log_warn "无法解析 publishAt 时间 '${publish_at}'，跳过：${content_id}"
            ((error_count++)) || true
            continue
        fi

        local time_diff=$(( publish_ts - now_ts ))

        # 跳过：未来 5 分钟之外（尚未到时）
        if [[ "$time_diff" -gt "$TRIGGER_WINDOW_SECONDS" ]]; then
            log_info "时间未到（还有 ${time_diff}s），跳过：${content_id}"
            ((skipped_count++)) || true
            continue
        fi

        # 跳过：已过期超过 1 小时（避免意外补发）
        if [[ "$time_diff" -lt "-${EXPIRE_GRACE_SECONDS}" ]]; then
            log_warn "发布时间已过期超过 ${EXPIRE_GRACE_SECONDS}s（diff=${time_diff}s），跳过：${content_id}"
            ((skipped_count++)) || true
            continue
        fi

        # ─── 触发发布 ─────────────────────────────────────────────────────
        log_info "⏰ 触发定时发布: ${content_id} | publishAt=${publish_at} | 平台=${platforms}"

        if trigger_n8n "$content_id" "$title" "$platforms" "$content_type"; then
            mark_published "$content_id"
            ((triggered_count++)) || true

            notify_feishu "⏰ 定时发布已触发
内容: ${content_id}
标题: ${title}
平台: ${platforms}
类型: ${content_type}
计划时间: ${publish_at}"
        else
            ((error_count++)) || true
            notify_feishu "❌ 定时发布触发失败
内容: ${content_id}
计划时间: ${publish_at}"
        fi

    done <<< "$schedule_files"

    log_info "扫描完成：触发 ${triggered_count} 个，跳过 ${skipped_count} 个，错误 ${error_count} 个"
}

main "$@"
