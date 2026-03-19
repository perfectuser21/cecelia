#!/usr/bin/env bash
# batch-publish-douyin.sh — 抖音批量发布脚本
#
# 按顺序发布指定日期目录下的所有内容（视频或图文），
# 每条发布之间等待 60 秒避免频率限制。
#
# 用法：
#   bash batch-publish-douyin.sh [日期目录]
#   bash batch-publish-douyin.sh 2026-03-19
#   bash batch-publish-douyin.sh  # 使用今天的日期
#
# 内容目录结构：
#   ~/.douyin-queue/{date}/
#   ├── video-1/
#   │   ├── type.txt     → "video"
#   │   ├── title.txt    → 视频标题
#   │   ├── tags.txt     → 标签
#   │   └── video.mp4    → 视频文件
#   └── image-1/
#       ├── type.txt     → "image"
#       ├── title.txt    → 标题
#       ├── content.txt  → 文案
#       └── image.jpg    → 图片
#
# 退出码：
#   0 - 全部发布成功
#   1 - 部分失败
#   2 - 无内容或配置错误

set -euo pipefail

QUEUE_BASE="${DOUYIN_QUEUE_DIR:-$HOME/.douyin-queue}"
DATE_DIR="${1:-$(TZ=Asia/Shanghai date +%Y-%m-%d)}"
QUEUE_DIR="$QUEUE_BASE/$DATE_DIR"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NODE_PATH="${NODE_PATH:-/Users/administrator/perfect21/cecelia/node_modules}"

VIDEO_SCRIPT="$SCRIPT_DIR/publish-douyin-video.cjs"
IMAGE_SCRIPT="$SCRIPT_DIR/publish-douyin-image.cjs"
SLEEP_BETWEEN=60

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  抖音批量发布 — $DATE_DIR"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# ── 检查队列目录 ──────────────────────────────────────────────
if [[ ! -d "$QUEUE_DIR" ]]; then
  echo "❌ 队列目录不存在: $QUEUE_DIR"
  exit 2
fi

# ── 枚举内容目录 ──────────────────────────────────────────────
CONTENT_DIRS=()
while IFS= read -r -d '' dir; do
  CONTENT_DIRS+=("$dir")
done < <(find "$QUEUE_DIR" -mindepth 1 -maxdepth 1 -type d -print0 | sort -z)

if [[ ${#CONTENT_DIRS[@]} -eq 0 ]]; then
  echo "⚠️  无内容目录: $QUEUE_DIR"
  exit 2
fi

echo "📦 找到 ${#CONTENT_DIRS[@]} 个内容目录"
echo ""

# ── 逐个发布 ─────────────────────────────────────────────────
TOTAL=${#CONTENT_DIRS[@]}
SUCCESS=0
FAILED=0

for i in "${!CONTENT_DIRS[@]}"; do
  DIR="${CONTENT_DIRS[$i]}"
  NAME=$(basename "$DIR")
  NUM=$((i + 1))

  # 检查是否已发布
  if [[ -f "$DIR/done.txt" ]]; then
    echo "[$NUM/$TOTAL] ⏭️  跳过（已发布）: $NAME"
    SUCCESS=$((SUCCESS + 1))
    continue
  fi

  # 读取内容类型
  TYPE_FILE="$DIR/type.txt"
  if [[ -f "$TYPE_FILE" ]]; then
    TYPE=$(cat "$TYPE_FILE" | tr -d '[:space:]')
  else
    # 自动检测：有视频文件 → video，否则 → image
    if find "$DIR" -maxdepth 1 -name "*.mp4" -o -name "*.mov" -o -name "*.avi" | grep -q .; then
      TYPE="video"
    else
      TYPE="image"
    fi
  fi

  echo "[$NUM/$TOTAL] 🚀 发布 $NAME（$TYPE）..."

  SCRIPT=""
  case "$TYPE" in
    video)
      SCRIPT="$VIDEO_SCRIPT"
      ;;
    image)
      SCRIPT="$IMAGE_SCRIPT"
      ;;
    *)
      echo "  ❌ 未知类型: $TYPE（跳过）"
      FAILED=$((FAILED + 1))
      continue
      ;;
  esac

  if NODE_PATH="$NODE_PATH" node "$SCRIPT" --content "$DIR"; then
    echo "  ✅ 发布成功: $NAME"
    echo "published: $(TZ=Asia/Shanghai date +%Y-%m-%dT%H:%M:%S+08:00)" > "$DIR/done.txt"
    SUCCESS=$((SUCCESS + 1))
  else
    EXIT_CODE=$?
    echo "  ❌ 发布失败: $NAME (exit $EXIT_CODE)"
    FAILED=$((FAILED + 1))
  fi

  # 发布之间等待（最后一个不等待）
  if [[ $i -lt $((TOTAL - 1)) ]]; then
    echo "  ⏳ 等待 ${SLEEP_BETWEEN}s 避免频率限制..."
    sleep "$SLEEP_BETWEEN"
  fi
  echo ""
done

# ── 汇总报告 ─────────────────────────────────────────────────
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  发布汇总"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  总计: $TOTAL 条"
echo "  成功: $SUCCESS 条"
echo "  失败: $FAILED 条"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

if [[ $FAILED -gt 0 ]]; then
  exit 1
fi
exit 0
