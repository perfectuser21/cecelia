#!/usr/bin/env bash
# audit-content-pipeline.sh
# Content Pipeline 健康检查脚本
# 用途：快速检测内容 pipeline 各层连通状态
# 使用：bash scripts/audit-content-pipeline.sh

set -euo pipefail

PGUSER="${PGUSER:-cecelia}"
PGPASSWORD="${PGPASSWORD:-CeceliaUS2026}"
PGHOST="${PGHOST:-localhost}"

PASS=0
FAIL=0

_check() {
  local name="$1"
  local cmd="$2"
  if eval "$cmd" &>/dev/null; then
    echo "  ✅ $name"
    PASS=$((PASS+1))
  else
    echo "  ❌ $name"
    FAIL=$((FAIL+1))
  fi
}

echo "======================================"
echo " Content Pipeline 健康检查"
echo "======================================"
echo ""

# ── 1. 数据库层 ──
echo "【1/4】数据库层"
_check "cecelia DB 可连接" \
  "PGPASSWORD=$PGPASSWORD psql -U $PGUSER -h $PGHOST -d cecelia -c '\q'"
_check "zenithjoy.works 表存在" \
  "PGPASSWORD=$PGPASSWORD psql -U $PGUSER -h $PGHOST -d cecelia -c 'SELECT 1 FROM zenithjoy.works LIMIT 1'"
_check "zenithjoy.publish_logs 表存在" \
  "PGPASSWORD=$PGPASSWORD psql -U $PGUSER -h $PGHOST -d cecelia -c 'SELECT 1 FROM zenithjoy.publish_logs LIMIT 1'"
_check "cecelia.content_publish_jobs 表存在" \
  "PGPASSWORD=$PGPASSWORD psql -U $PGUSER -h $PGHOST -d cecelia -c 'SELECT 1 FROM content_publish_jobs LIMIT 1'"
_check "cecelia.publish_results 表存在" \
  "PGPASSWORD=$PGPASSWORD psql -U $PGUSER -h $PGHOST -d cecelia -c 'SELECT 1 FROM publish_results LIMIT 1'"
_check "social_media_raw DB 存在" \
  "PGPASSWORD=$PGPASSWORD psql -U $PGUSER -h $PGHOST -d social_media_raw -c '\q'"
echo ""

# ── 2. Brain API 层 ──
echo "【2/4】Brain API 层"
BRAIN="${BRAIN_URL:-http://localhost:5221}"
_check "Brain 服务响应" \
  "curl -sf '$BRAIN/api/brain/tasks?limit=1' -o /dev/null"
_check "/api/brain/content-types 可访问" \
  "curl -sf '$BRAIN/api/brain/content-types' -o /dev/null"
_check "/api/brain/pipelines 可访问" \
  "curl -sf '$BRAIN/api/brain/pipelines' -o /dev/null"
_check "/api/brain/publish-jobs 可访问" \
  "curl -sf '$BRAIN/api/brain/publish-jobs' -o /dev/null"
echo ""

# ── 3. Scraper 文件层 ──
# 获取 cecelia 主仓库根目录（worktree 时 --show-toplevel 返回 worktree 路径，需走 git-dir 找主仓库）
GIT_DIR_RAW="$(git rev-parse --absolute-git-dir 2>/dev/null || echo "")"
if [[ "$GIT_DIR_RAW" == *"worktrees"* ]]; then
  # 在 worktree 中：git-dir = /repo/.git/worktrees/<name>，主仓库 = /repo/.git/..
  CECELIA_ROOT="$(dirname "$(dirname "$(dirname "$GIT_DIR_RAW")")")"
else
  CECELIA_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || echo ".")"
fi
PERFECT21_ROOT="$(dirname "$CECELIA_ROOT")"
SCRAPER_DIR="$PERFECT21_ROOT/zenithjoy/workflows/platform-data/workflows/scraper/scripts"
echo "【3/4】Scraper 文件层"
for platform in douyin kuaishou weibo xiaohongshu wechat toutiao channels; do
  _check "scraper-${platform}-v3.js 存在" \
    "test -f '$SCRAPER_DIR/scraper-${platform}-v3.js'"
done
_check "scraper-zhihu-v8-api.js 存在" \
  "test -f '$SCRAPER_DIR/scraper-zhihu-v8-api.js'"
echo ""

# ── 4. Publisher 文件层 ──
PUB_DIR="$PERFECT21_ROOT/zenithjoy/services/creator/scripts/publishers"
echo "【4/4】Publisher 文件层"
for pub in douyin-publisher kuaishou-publisher toutiao-publisher weibo-publisher xiaohongshu-publisher zhihu-publisher wechat-publisher shipinhao-publisher; do
  _check "$pub 目录存在" "test -d '$PUB_DIR/$pub'"
done
echo ""

# ── 汇总 ──
TOTAL=$((PASS+FAIL))
echo "======================================"
echo " 结果: $PASS/$TOTAL 通过"
if [ "$FAIL" -gt 0 ]; then
  echo " ⚠️  $FAIL 个检查失败，请查看审计报告："
  echo "    docs/audits/content-pipeline-audit-20260326.md"
  echo "======================================"
  exit 1
else
  echo " ✅ 全部通过"
  echo "======================================"
  exit 0
fi
