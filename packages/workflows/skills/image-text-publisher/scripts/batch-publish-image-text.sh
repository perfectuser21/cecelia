#!/usr/bin/env bash
# 图文五平台 NAS 批量发布统一调度脚本
#
# 从 NAS 日期目录读取内容，一键发布到知乎 + 公众号 + 今日头条 + 抖音 + 快手 + 小红书五平台。
#
# 用法:
#   bash batch-publish-image-text.sh [--date YYYY-MM-DD] [--dry-run]
#
# NAS 内容目录结构:
#   /Users/jinnuoshengyuan/nas-publish/徐啸/creator/output/YYYY-MM-DD/
#   ├── post-1/
#   │   ├── platforms.txt   # 目标平台（逗号分隔: zhihu,wechat,toutiao,douyin,kuaishou,xiaohongshu）
#   │   ├── title.txt       # 标题（必需）
#   │   ├── content.txt     # 正文（必需）
#   │   └── image.jpg       # 封面图（可选，图文平台必需）
#   ├── post-2/
#   │   └── ...
#   └── post-N/
#
# platforms.txt 示例:
#   zhihu,wechat,toutiao                              # 三文章平台
#   douyin,kuaishou,xiaohongshu                       # 三图文平台
#   zhihu,wechat,toutiao,douyin,kuaishou,xiaohongshu  # 全六平台
#
# 已发布的目录会写入 done-<platform>.txt，下次跳过。
#
# 示例:
#   bash batch-publish-image-text.sh --date 2026-03-19 --dry-run
#   bash batch-publish-image-text.sh --date 2026-03-19

set -euo pipefail

# ─── 参数解析 ────────────────────────────────────────────────────────────────

DATE=$(TZ=Asia/Shanghai date +%Y-%m-%d)
DRY_RUN=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --date)
      DATE="$2"
      shift 2
      ;;
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    *)
      echo "未知参数: $1" >&2
      echo "用法: bash batch-publish-image-text.sh [--date YYYY-MM-DD] [--dry-run]" >&2
      exit 1
      ;;
  esac
done

# ─── 路径配置 ────────────────────────────────────────────────────────────────

NAS_BASE="/Users/jinnuoshengyuan/nas-publish/徐啸/creator/output"
NAS_DATE_DIR="${NAS_BASE}/${DATE}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../../.." && pwd)"
NODE_PATH_OVERRIDE="${REPO_ROOT}/node_modules"

ZHIHU_SCRIPT="${REPO_ROOT}/packages/workflows/skills/zhihu-publisher/scripts/publish-zhihu-api.cjs"
WECHAT_SCRIPT="${REPO_ROOT}/packages/workflows/skills/wechat-publisher/scripts/publish-wechat-article.cjs"
TOUTIAO_SCRIPT="${REPO_ROOT}/packages/workflows/skills/toutiao-publisher/scripts/publish-toutiao-article.cjs"
DOUYIN_SCRIPT="${REPO_ROOT}/packages/workflows/skills/douyin-publisher/scripts/publish-douyin-image.cjs"
KUAISHOU_SCRIPT="${REPO_ROOT}/packages/workflows/skills/kuaishou-publisher/scripts/publish-kuaishou-image.cjs"
XIAOHONGSHU_SCRIPT="${REPO_ROOT}/packages/workflows/skills/xiaohongshu-publisher/scripts/publish-xiaohongshu-image.cjs"

# ─── 标题 ────────────────────────────────────────────────────────────────────

echo ""
echo "========================================="
echo " 图文五平台批量发布 - ${DATE}"
if [[ "$DRY_RUN" == "true" ]]; then
  echo " [DRY-RUN 模式 - 不实际发布]"
fi
echo "========================================="
echo ""

# ─── NAS 目录检查 ────────────────────────────────────────────────────────────

if [[ ! -d "$NAS_DATE_DIR" ]]; then
  echo "[INFO] NAS 日期目录不存在: ${NAS_DATE_DIR}"
  if [[ "$DRY_RUN" == "true" ]]; then
    echo "[DRY-RUN] 跳过（目录不存在时 dry-run 正常退出）"
    echo ""
    echo "========================================="
    echo " 统计报告"
    echo "========================================="
    echo " total:   0"
    echo " success: { zhihu: 0, wechat: 0, toutiao: 0, douyin: 0, kuaishou: 0, xiaohongshu: 0 }"
    echo " failed:  []"
    echo "========================================="
    exit 0
  fi
  echo "❌ 请先准备内容目录后再运行" >&2
  exit 1
fi

# ─── 统计变量 ────────────────────────────────────────────────────────────────

total=0
success_zhihu=0
success_wechat=0
success_toutiao=0
success_douyin=0
success_kuaishou=0
success_xiaohongshu=0
failed=()

# ─── 遍历 post-* 目录 ────────────────────────────────────────────────────────

for post_dir in "${NAS_DATE_DIR}"/post-*/; do
  [[ -d "$post_dir" ]] || continue

  post_name=$(basename "$post_dir")
  platforms_file="${post_dir}platforms.txt"

  # 读取目标平台列表
  if [[ ! -f "$platforms_file" ]]; then
    echo "[SKIP] ${post_name}: 缺少 platforms.txt，跳过"
    continue
  fi

  platforms=$(cat "$platforms_file" | tr -d '[:space:]')
  if [[ -z "$platforms" ]]; then
    echo "[SKIP] ${post_name}: platforms.txt 为空，跳过"
    continue
  fi

  total=$((total + 1))
  echo ""
  echo "─────────────────────────────────"
  echo "处理 [${total}]: ${post_name}"
  echo "平台: ${platforms}"

  if [[ "$DRY_RUN" == "true" ]]; then
    # dry-run：读取元信息并打印
    title=""
    [[ -f "${post_dir}title.txt" ]] && title=$(cat "${post_dir}title.txt" | head -1)
    echo "[DRY-RUN] 标题: ${title:-（无标题）}"
    echo "[DRY-RUN] 平台: ${platforms}"
    continue
  fi

  # ─── 知乎发布 ────────────────────────────────────────────────────────────

  if echo "$platforms" | grep -q "zhihu"; then
    done_file="${post_dir}done-zhihu.txt"
    if [[ -f "$done_file" ]]; then
      echo "[SKIP] 知乎: 已发布"
    else
      echo ""
      echo "▶ 发布到知乎..."
      if NODE_PATH="$NODE_PATH_OVERRIDE" node "$ZHIHU_SCRIPT" \
          --content "$post_dir" 2>&1; then
        success_zhihu=$((success_zhihu + 1))
        touch "$done_file"
        echo "✅ 知乎: 发布成功"
      else
        failed+=("${post_name}:zhihu")
        echo "❌ 知乎: 发布失败"
      fi
      sleep 5
    fi
  fi

  # ─── 公众号发布 ──────────────────────────────────────────────────────────

  if echo "$platforms" | grep -q "wechat"; then
    done_file="${post_dir}done-wechat.txt"
    if [[ -f "$done_file" ]]; then
      echo "[SKIP] 公众号: 已发布"
    else
      echo ""
      echo "▶ 发布到微信公众号..."
      if NODE_PATH="$NODE_PATH_OVERRIDE" node "$WECHAT_SCRIPT" \
          --content-dir "$post_dir" 2>&1; then
        success_wechat=$((success_wechat + 1))
        touch "$done_file"
        echo "✅ 公众号: 发布成功"
      else
        failed+=("${post_name}:wechat")
        echo "❌ 公众号: 发布失败"
      fi
      sleep 5
    fi
  fi

  # ─── 头条发布 ────────────────────────────────────────────────────────────

  if echo "$platforms" | grep -q "toutiao"; then
    done_file="${post_dir}done-toutiao.txt"
    if [[ -f "$done_file" ]]; then
      echo "[SKIP] 头条: 已发布"
    else
      echo ""
      echo "▶ 发布到今日头条..."
      if NODE_PATH="$NODE_PATH_OVERRIDE" node "$TOUTIAO_SCRIPT" \
          --content "$post_dir" 2>&1; then
        success_toutiao=$((success_toutiao + 1))
        touch "$done_file"
        echo "✅ 头条: 发布成功"
      else
        failed+=("${post_name}:toutiao")
        echo "❌ 头条: 发布失败"
      fi
      sleep 5
    fi
  fi

  # ─── 抖音发布 ────────────────────────────────────────────────────────────

  if echo "$platforms" | grep -q "douyin"; then
    done_file="${post_dir}done-douyin.txt"
    if [[ -f "$done_file" ]]; then
      echo "[SKIP] 抖音: 已发布"
    else
      echo ""
      echo "▶ 发布到抖音..."
      if NODE_PATH="$NODE_PATH_OVERRIDE" node "$DOUYIN_SCRIPT" \
          --content "$post_dir" 2>&1; then
        success_douyin=$((success_douyin + 1))
        touch "$done_file"
        echo "✅ 抖音: 发布成功"
      else
        failed+=("${post_name}:douyin")
        echo "❌ 抖音: 发布失败"
      fi
      sleep 5
    fi
  fi

  # ─── 快手发布 ────────────────────────────────────────────────────────────

  if echo "$platforms" | grep -q "kuaishou"; then
    done_file="${post_dir}done-kuaishou.txt"
    if [[ -f "$done_file" ]]; then
      echo "[SKIP] 快手: 已发布"
    else
      echo ""
      echo "▶ 发布到快手..."
      if NODE_PATH="$NODE_PATH_OVERRIDE" node "$KUAISHOU_SCRIPT" \
          --content "$post_dir" 2>&1; then
        success_kuaishou=$((success_kuaishou + 1))
        touch "$done_file"
        echo "✅ 快手: 发布成功"
      else
        failed+=("${post_name}:kuaishou")
        echo "❌ 快手: 发布失败"
      fi
      sleep 5
    fi
  fi

  # ─── 小红书发布 ──────────────────────────────────────────────────────────

  if echo "$platforms" | grep -q "xiaohongshu"; then
    done_file="${post_dir}done-xiaohongshu.txt"
    if [[ -f "$done_file" ]]; then
      echo "[SKIP] 小红书: 已发布"
    else
      echo ""
      echo "▶ 发布到小红书..."
      if NODE_PATH="$NODE_PATH_OVERRIDE" node "$XIAOHONGSHU_SCRIPT" \
          --content "$post_dir" 2>&1; then
        success_xiaohongshu=$((success_xiaohongshu + 1))
        touch "$done_file"
        echo "✅ 小红书: 发布成功"
      else
        failed+=("${post_name}:xiaohongshu")
        echo "❌ 小红书: 发布失败"
      fi
      sleep 5
    fi
  fi

done

# ─── 统计报告 ────────────────────────────────────────────────────────────────

echo ""
echo "========================================="
echo " 统计报告"
echo "========================================="
echo " total:   ${total}"
echo " success: { zhihu: ${success_zhihu}, wechat: ${success_wechat}, toutiao: ${success_toutiao}, douyin: ${success_douyin}, kuaishou: ${success_kuaishou}, xiaohongshu: ${success_xiaohongshu} }"

if [[ "${#failed[@]}" -gt 0 ]]; then
  echo " failed:  [$(IFS=','; echo "${failed[*]}")]"
else
  echo " failed:  []"
fi
echo "========================================="

# 有失败项则以非零退出
if [[ "${#failed[@]}" -gt 0 ]]; then
  exit 1
fi
exit 0
