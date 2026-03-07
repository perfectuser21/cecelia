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
# 输出: JSON 格式，包含 success/count/platform 字段
# 部署: 复制到 VPS scraper 服务器 ~/platform_scrape.sh
#
# 注意: 知乎使用独立脚本 ~/.zhihu/vnc_scrape.sh，不经过本脚本

set -euo pipefail

PLATFORM="${1:-}"
SCRAPER_DIR="${SCRAPER_DIR:-${HOME}}"

# 输出 JSON 错误并退出
error_json() {
    local msg="$1"
    local code="${2:-1}"
    printf '{"success":false,"error":"%s","platform":"%s","count":0}\n' \
        "$msg" "$PLATFORM" >&1
    exit "$code"
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

# 执行采集（stdout 透传给 N8N 解析节点）
node "$SCRAPER"
