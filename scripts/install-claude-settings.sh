#!/usr/bin/env bash
# install-claude-settings.sh — 把 repo 级 .claude/settings.json 的 hook 配置
# merge 到用户级 ~/.claude/settings.json（CC 不识别 repo settings 时的 fallback）
#
# 用法：bash scripts/install-claude-settings.sh
#
# 行为：
#   - 用户没 ~/.claude/settings.json → 直接复制 repo settings 过去
#   - 用户已有 → jq merge（repo settings 优先），备份原文件
#   - jq 缺失 → 报错引导手动编辑

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REPO_SETTINGS="$REPO_ROOT/.claude/settings.json"
USER_SETTINGS="${HOME}/.claude/settings.json"

if [[ ! -f "$REPO_SETTINGS" ]]; then
    echo "❌ $REPO_SETTINGS 不存在 — 当前 repo 无 .claude/settings.json"
    exit 1
fi

mkdir -p "$(dirname "$USER_SETTINGS")"

if [[ ! -f "$USER_SETTINGS" ]]; then
    cp "$REPO_SETTINGS" "$USER_SETTINGS"
    echo "✅ 已安装 ${USER_SETTINGS}（首次创建）"
    exit 0
fi

# merge：用户已有 settings.json 时 jq merge
if ! command -v jq &>/dev/null; then
    echo "❌ jq 不可用，无法 merge。"
    echo "   手动编辑 $USER_SETTINGS 把 $REPO_SETTINGS 的 hooks 段拷过去"
    exit 1
fi

backup="${USER_SETTINGS}.backup.$(date +%s)"
cp "$USER_SETTINGS" "$backup"
echo "ℹ️  备份 $backup"

# repo settings 优先（覆盖 hooks），用户 settings 保留其他字段
merged=$(jq -s '.[0] * .[1]' "$USER_SETTINGS" "$REPO_SETTINGS")
echo "$merged" > "$USER_SETTINGS"
echo "✅ 已 merge $REPO_SETTINGS → $USER_SETTINGS"
echo "   验证：jq '.hooks.PreToolUse | length' $USER_SETTINGS 应 ≥ 1"
