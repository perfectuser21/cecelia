#!/usr/bin/env bash
# 定时发布 cron 注册脚本
#
# 用法：bash setup-publisher-cron.sh [--dry-run] [--remove]
#
# 选项：
#   --dry-run   只预览，不实际写入 crontab
#   --remove    移除定时发布 cron 任务
#
# 功能：
#   注册 cron，每 5 分钟执行 schedule-publisher.sh
#   日志写入 ~/logs/schedule-publisher.log

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PUBLISHER_SCRIPT="${SCRIPT_DIR}/schedule-publisher.sh"
LOG_DIR="${HOME}/logs"
LOG_FILE="${LOG_DIR}/schedule-publisher.log"
CRON_MARKER="# cecelia-schedule-publisher"

DRY_RUN=false
REMOVE=false

# ─── 参数解析 ─────────────────────────────────────────────────────────────────
for arg in "$@"; do
    case "$arg" in
        --dry-run) DRY_RUN=true ;;
        --remove)  REMOVE=true ;;
        -h|--help)
            echo "用法：bash setup-publisher-cron.sh [--dry-run] [--remove]"
            echo ""
            echo "  --dry-run   只预览，不实际写入 crontab"
            echo "  --remove    移除定时发布 cron 任务"
            echo ""
            echo "日志位置：${LOG_FILE}"
            exit 0
            ;;
        *) echo "未知参数：$arg"; exit 1 ;;
    esac
done

# ─── 前置检查 ─────────────────────────────────────────────────────────────────
if [[ ! -f "$PUBLISHER_SCRIPT" ]]; then
    echo "错误：找不到发布脚本：$PUBLISHER_SCRIPT"
    exit 1
fi

# 确保脚本可执行
chmod +x "$PUBLISHER_SCRIPT"

# ─── 移除模式 ─────────────────────────────────────────────────────────────────
if [[ "$REMOVE" == true ]]; then
    echo "移除定时发布 cron 任务..."
    if crontab -l 2>/dev/null | grep -q "$CRON_MARKER"; then
        crontab -l 2>/dev/null | grep -v "$CRON_MARKER" | crontab -
        echo "✓ 已移除定时发布 cron 任务"
    else
        echo "ℹ️  未找到定时发布 cron 任务（可能已未注册）"
    fi
    exit 0
fi

# ─── Cron 任务行 ──────────────────────────────────────────────────────────────
# 确保日志目录存在
mkdir -p "$LOG_DIR"

CRON_LINE="*/5 * * * * bash '${PUBLISHER_SCRIPT}' >> '${LOG_FILE}' 2>&1 ${CRON_MARKER}"

echo "定时发布 cron 配置："
echo ""
echo "  脚本路径：${PUBLISHER_SCRIPT}"
echo "  日志路径：${LOG_FILE}"
echo "  执行周期：每 5 分钟（*/5 * * * *）"
echo ""
echo "Cron 任务行："
echo "  ${CRON_LINE}"
echo ""

# ─── 检查是否已注册 ───────────────────────────────────────────────────────────
if crontab -l 2>/dev/null | grep -q "$CRON_MARKER"; then
    echo "ℹ️  定时发布 cron 已存在，更新..."
    # 移除旧条目
    crontab -l 2>/dev/null | grep -v "$CRON_MARKER" | crontab - 2>/dev/null || true
fi

# ─── 注册 cron ────────────────────────────────────────────────────────────────
if [[ "$DRY_RUN" == true ]]; then
    echo "⚠️  DRY RUN 模式：以上配置未写入 crontab"
    echo ""
    echo "当前 crontab（预览）："
    {
        crontab -l 2>/dev/null || true
        echo "$CRON_LINE"
    }
    exit 0
fi

# 写入 crontab
{
    crontab -l 2>/dev/null || true
    echo "$CRON_LINE"
} | crontab -

echo "✓ 定时发布 cron 已注册"
echo ""
echo "验证："
crontab -l | grep "$CRON_MARKER" | head -3

echo ""
echo "环境变量配置（可选）："
echo "  export NAS_IP=100.110.241.76"
echo "  export NAS_USER=徐啸"
echo "  export N8N_API_URL=http://localhost:5679"
echo "  export FEISHU_BOT_WEBHOOK=https://open.feishu.cn/open-apis/bot/v2/hook/..."
echo ""
echo "查看日志："
echo "  tail -f ${LOG_FILE}"
echo ""
echo "立即测试："
echo "  bash '${PUBLISHER_SCRIPT}'"
