#!/bin/bash
# platform_scrape.sh - 平台数据采集统一调度器
#
# 用法: bash ~/platform_scrape.sh <platform>
#
# 支持的平台:
#   douyin        抖音
#   kuaishou      快手
#   xiaohongshu   小红书
#   toutiao       今日头条（大号，CDP 端口 19225）
#   toutiao-2     今日头条（小号，CDP 端口 19226）
#   weibo         微博
#   channels      视频号
#   gongzhonghao  公众号
#
# 输出: JSON 格式，包含 success/count/platform/duration_ms 字段
# 部署: 复制到 VPS scraper 服务器 ~/platform_scrape.sh
#
# 注意: 知乎使用独立脚本 ~/.zhihu/vnc_scrape.sh，不经过本脚本

set -uo pipefail

PLATFORM="${1:-}"
SCRAPER_DIR="${SCRAPER_DIR:-${HOME}}"
# 若设置此变量，采集完成后自动 POST 结果到 Brain API
# 示例：BRAIN_API_URL=http://38.23.47.81:5221
BRAIN_API_URL="${BRAIN_API_URL:-}"
# content_publish 任务 ID（可选，有则写入 pipeline_publish_stats）
PUBLISH_TASK_ID="${PUBLISH_TASK_ID:-}"
PIPELINE_ID="${PIPELINE_ID:-}"

# 输出 JSON 错误并退出（含 duration_ms，exit 0 让 N8N 通过 JSON 判断成功）
error_json() {
    local msg="$1"
    local dur="${2:-0}"
    printf '{"success":false,"error":"%s","platform":"%s","count":0,"duration_ms":%d}\n' \
        "$msg" "$PLATFORM" "$dur" >&1
    exit 0
}

# 参数校验
if [[ -z "$PLATFORM" ]]; then
    error_json "missing platform argument"
fi

# 检查 node 可用性
if ! command -v node >/dev/null 2>&1; then
    error_json "node is not installed or not in PATH"
fi

# 平台 → 脚本映射
case "$PLATFORM" in
    douyin)
        SCRAPER="${SCRAPER_DIR}/scraper-douyin-v3.js"
        ;;
    kuaishou)
        SCRAPER="${SCRAPER_DIR}/scraper-kuaishou-v3.js"
        ;;
    xiaohongshu)
        SCRAPER="${SCRAPER_DIR}/scraper-xiaohongshu-v3.js"
        ;;
    toutiao)
        SCRAPER="${SCRAPER_DIR}/scraper-toutiao-v3.js"
        ;;
    toutiao-2)
        SCRAPER="${SCRAPER_DIR}/scraper-toutiao-v3.js"
        export CDP_PORT=19226
        export ACCOUNT_INDEX=2
        ;;
    weibo)
        SCRAPER="${SCRAPER_DIR}/scraper-weibo-v3.js"
        ;;
    channels)
        SCRAPER="${SCRAPER_DIR}/scraper-channels-v3.js"
        ;;
    gongzhonghao)
        SCRAPER="${SCRAPER_DIR}/scraper-wechat-v3.js"
        ;;
    *)
        error_json "unknown platform: ${PLATFORM}"
        ;;
esac

# 检查脚本文件存在
if [[ ! -f "$SCRAPER" ]]; then
    error_json "scraper not found: ${SCRAPER}"
fi

# 执行采集，记录耗时，注入 duration_ms 到输出 JSON
START_MS=$(date +%s%3N)

set +e
SCRAPER_OUTPUT=$(node "$SCRAPER" 2>&1)
SCRAPER_EXIT=$?
set -e

END_MS=$(date +%s%3N)
DURATION_MS=$((END_MS - START_MS))

# 采集失败：输出错误 JSON
if [[ "$SCRAPER_EXIT" -ne 0 ]] || [[ -z "$SCRAPER_OUTPUT" ]]; then
    ERR_MSG="scraper failed (exit ${SCRAPER_EXIT})"
    if [[ -n "$SCRAPER_OUTPUT" ]]; then
        FIRST_LINE=$(echo "$SCRAPER_OUTPUT" | head -c 200 | tr '"' "'")
        ERR_MSG="${ERR_MSG}: ${FIRST_LINE}"
    fi
    error_json "$ERR_MSG" "$DURATION_MS"
fi

# 将 duration_ms 注入采集器输出 JSON，并可选回写到 Brain API
FINAL_OUTPUT=$(echo "$SCRAPER_OUTPUT" | node -e "
const chunks = [];
process.stdin.on('data', c => chunks.push(c));
process.stdin.on('end', () => {
    const durMs = parseInt(process.argv[1]);
    try {
        const d = JSON.parse(chunks.join('').trim());
        d.duration_ms = durMs;
        process.stdout.write(JSON.stringify(d) + '\n');
    } catch (e) {
        const raw = chunks.join('').trim().slice(0, 100).replace(/\"/g, \"'\");
        process.stdout.write(JSON.stringify({
            success: false,
            error: 'output parse failed: ' + e.message,
            raw_output: raw,
            count: 0,
            duration_ms: durMs
        }) + '\n');
    }
});
" "$DURATION_MS")

# 输出最终 JSON（N8N 读取）
echo "$FINAL_OUTPUT"

# 若设置了 BRAIN_API_URL，将采集结果 POST 到 Brain analytics 端点
if [[ -n "$BRAIN_API_URL" ]] && command -v curl >/dev/null 2>&1; then
    # 构造写回 payload：从输出中提取 items（若有），否则发空 items（触发平台有数据的信号）
    WRITE_BACK_PAYLOAD=$(echo "$FINAL_OUTPUT" | node -e "
const chunks = [];
process.stdin.on('data', c => chunks.push(c));
process.stdin.on('end', () => {
    try {
        const d = JSON.parse(chunks.join('').trim());
        const payload = {
            platform: process.env.PLATFORM,
            publishTaskId: process.env.PUBLISH_TASK_ID || undefined,
            pipelineId: process.env.PIPELINE_ID || undefined,
            items: Array.isArray(d.items) ? d.items : [],
        };
        if (!payload.publishTaskId) delete payload.publishTaskId;
        if (!payload.pipelineId) delete payload.pipelineId;
        process.stdout.write(JSON.stringify(payload));
    } catch (e) {
        process.stdout.write(JSON.stringify({ platform: process.env.PLATFORM, items: [] }));
    }
});
" 2>/dev/null)

    BRAIN_ENDPOINT="${BRAIN_API_URL}/api/brain/analytics/scrape-result"
    curl -s -o /dev/null -w "%{http_code}" \
        -X POST \
        -H "Content-Type: application/json" \
        -d "$WRITE_BACK_PAYLOAD" \
        "$BRAIN_ENDPOINT" \
        --max-time 10 \
        2>/dev/null || true
fi
