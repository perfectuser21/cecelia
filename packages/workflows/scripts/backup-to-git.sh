#!/bin/bash
# 定期备份 N8N workflows 到 Git（用于版本管理和灾难恢复）

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "=== 备份 N8N Workflows 到 Git ==="
echo ""

# 1. 导出所有 workflows
echo "📤 导出 workflows..."
bash "$SCRIPT_DIR/export-from-n8n.sh"

# 2. 检查是否有变化
cd "$PROJECT_ROOT"
if git diff --quiet n8n/workflows/; then
  echo "✅ 没有变化，无需提交"
  exit 0
fi

# 3. 显示变化
echo ""
echo "📋 发现以下变化："
git status --short n8n/workflows/

# 4. 询问是否提交
echo ""
read -p "是否提交这些变化到 Git? (y/N) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  echo "❌ 取消提交"
  exit 0
fi

# 5. 提交
echo ""
read -p "请输入提交信息 (或直接回车使用默认): " commit_msg
if [ -z "$commit_msg" ]; then
  commit_msg="chore: 备份 N8N workflows $(date +'%Y-%m-%d %H:%M')"
fi

git add n8n/workflows/
git commit -m "$commit_msg"

echo ""
echo "✅ 已提交到 Git"
echo ""
echo "下一步："
echo "  git push  # 推送到远程仓库"
