#!/usr/bin/env bash
# n8n-weibo-bridge.sh
#
# N8N → Mac mini 微博发布桥接脚本
#
# 由 N8N SSH 节点在 Mac mini 上调用（通过 VPS 跳板 SSH 到 Mac mini）
# 接受任务 ID 和 base64 编码的内容，准备目录后调用 publish-weibo-image.cjs
#
# 用法：
#   bash n8n-weibo-bridge.sh --task-id <taskId> --content-b64 <base64> [--image-urls <url1,url2>]
#
# 输出（stdout，JSON 格式）：
#   {"success": true}
#   {"success": false, "error": "错误信息"}
#
# 退出码：
#   0 = 成功
#   1 = 失败（含错误详情在 stdout JSON）

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WEIBO_PUBLISHER="${SCRIPT_DIR}/publish-weibo-image.cjs"
NODE_PATH_EXPORT="/Users/administrator/perfect21/cecelia/node_modules"
QUEUE_BASE="/tmp/n8n-weibo"
MAX_IMAGES=9

# ─────────────────────────────────────────────
# 参数解析
# ─────────────────────────────────────────────
TASK_ID=""
CONTENT_B64=""
IMAGE_URLS=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --task-id)     TASK_ID="$2";      shift 2 ;;
    --content-b64) CONTENT_B64="$2";  shift 2 ;;
    --image-urls)  IMAGE_URLS="$2";   shift 2 ;;
    *) echo "未知参数: $1" >&2; shift ;;
  esac
done

if [[ -z "$TASK_ID" ]]; then
  echo '{"success":false,"error":"缺少 --task-id 参数"}'
  exit 1
fi

# ─────────────────────────────────────────────
# 日志函数（输出到 stderr，不影响 stdout JSON）
# ─────────────────────────────────────────────
log() {
  local ts
  ts=$(TZ=Asia/Shanghai date '+%Y-%m-%d %H:%M:%S')
  echo "[${ts}] [INFO] $*" >&2
}

log_err() {
  local ts
  ts=$(TZ=Asia/Shanghai date '+%Y-%m-%d %H:%M:%S')
  echo "[${ts}] [ERROR] $*" >&2
}

# ─────────────────────────────────────────────
# 环境检查
# ─────────────────────────────────────────────
if [[ ! -f "$WEIBO_PUBLISHER" ]]; then
  log_err "发布脚本不存在: $WEIBO_PUBLISHER"
  echo '{"success":false,"error":"publish-weibo-image.cjs 不存在"}'
  exit 1
fi

# ─────────────────────────────────────────────
# 准备内容目录
# ─────────────────────────────────────────────
CONTENT_DIR="${QUEUE_BASE}/${TASK_ID}"
mkdir -p "$CONTENT_DIR"
log "内容目录: $CONTENT_DIR"

# 写入文案（base64 解码）
if [[ -n "$CONTENT_B64" ]]; then
  echo "$CONTENT_B64" | base64 -d > "${CONTENT_DIR}/content.txt" 2>/dev/null
  CONTENT_LEN=$(wc -c < "${CONTENT_DIR}/content.txt" 2>/dev/null || echo 0)
  log "文案已写入（${CONTENT_LEN} 字节）"
else
  log "无文案内容"
  touch "${CONTENT_DIR}/content.txt"
fi

# 下载图片（如有 image-urls）
IMAGE_COUNT=0
if [[ -n "$IMAGE_URLS" ]]; then
  IFS=',' read -ra URL_ARRAY <<< "$IMAGE_URLS"
  IDX=1
  for url in "${URL_ARRAY[@]}"; do
    [[ $IDX -gt $MAX_IMAGES ]] && { log "已达最大图片数（${MAX_IMAGES}），跳过余下"; break; }
    # 提取扩展名
    EXT="${url##*.}"
    EXT="${EXT%\?*}"   # 去掉 query string
    EXT="${EXT,,}"     # 转小写
    case "$EXT" in
      jpg|jpeg|png|gif|webp) ;;
      *) EXT="jpg" ;;
    esac
    IMG_FILE="${CONTENT_DIR}/image${IDX}.${EXT}"
    log "下载图片 ${IDX}: ${url}"
    if curl -fsSL --max-time 30 -o "$IMG_FILE" "$url" 2>/dev/null; then
      log "  ✓ ${IMG_FILE}"
      IDX=$((IDX + 1))
      IMAGE_COUNT=$((IMAGE_COUNT + 1))
    else
      log_err "  ✗ 下载失败: $url"
    fi
  done
fi

log "图片数量: ${IMAGE_COUNT}，开始调用 publish-weibo-image.cjs..."

# ─────────────────────────────────────────────
# 调用发布脚本
# ─────────────────────────────────────────────
PUBLISH_OUTPUT=""
PUBLISH_EXIT=0

PUBLISH_OUTPUT=$(
  NODE_PATH="$NODE_PATH_EXPORT" node "$WEIBO_PUBLISHER" --content "$CONTENT_DIR/" 2>&1
) || PUBLISH_EXIT=$?

log "发布脚本退出码: ${PUBLISH_EXIT}"
log "发布输出（最后 5 行）:"
echo "$PUBLISH_OUTPUT" | tail -5 | while IFS= read -r line; do log "  $line"; done

# ─────────────────────────────────────────────
# 清理临时目录
# ─────────────────────────────────────────────
rm -rf "$CONTENT_DIR" 2>/dev/null || true

# ─────────────────────────────────────────────
# 输出 JSON 结果（stdout）
# ─────────────────────────────────────────────
if [[ $PUBLISH_EXIT -eq 0 ]]; then
  echo '{"success":true}'
  exit 0
else
  LAST_ERR=$(echo "$PUBLISH_OUTPUT" | grep -E "\[ERROR\]|❌" | tail -1 \
    | sed 's/.*\[ERROR\] //' | sed 's/❌ //' || echo "")
  LAST_ERR="${LAST_ERR:-发布失败（退出码 ${PUBLISH_EXIT}）}"
  LAST_ERR_ESCAPED=$(echo "$LAST_ERR" | sed 's/"/\\"/g' | tr -d '\n')
  echo "{\"success\":false,\"error\":\"${LAST_ERR_ESCAPED}\"}"
  exit 1
fi
