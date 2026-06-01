#!/usr/bin/env bash
# backup-claude-creds.sh — 把每个 Claude 账号的 .credentials.json 备份到 1Password (CS vault)
#
# 背景：refresh-claude-tokens.sh 只能"续"已存在的文件，不能"无中生有"。
# 一旦 ~/.claude-accountN/.credentials.json 丢失（机器迁移 / 误删 / 从未在本机创建），
# Brain（Docker/Linux 只读文件，读不到 macOS 钥匙串）就永久判该账号 MISSING，
# harness 单账号被踢出轮换 → pipeline 卡死。
#
# 本脚本把文件内容存进 1Password，配合 restore-claude-creds.sh 实现"丢了自动补回"。
# 建议 cron：refresh-claude-tokens.sh 之后跑（token 刷新后内容是最新的）。
#
# 用法：bash backup-claude-creds.sh
# 退出码：0 = 全部成功/跳过，1 = 1Password 不可用

set -uo pipefail

LOG="/tmp/claude-creds-backup.log"
ACCOUNTS=("account1" "account2" "account3")
VAULT="CS"

ts() { date '+%Y-%m-%d %H:%M:%S'; }

# 加载 1Password service account token
if [ -f "$HOME/.credentials/1password.env" ]; then
  # shellcheck disable=SC1091
  source "$HOME/.credentials/1password.env"
  export OP_SERVICE_ACCOUNT_TOKEN
else
  echo "$(ts) [ERROR] 1password.env 不存在，无法备份" | tee -a "$LOG"
  exit 1
fi

if ! command -v op >/dev/null 2>&1; then
  echo "$(ts) [ERROR] op CLI 不存在" | tee -a "$LOG"
  exit 1
fi

backed=0
for acc in "${ACCOUNTS[@]}"; do
  CREDS="$HOME/.claude-${acc}/.credentials.json"
  ITEM="claude-creds-${acc}"

  if [ ! -f "$CREDS" ]; then
    echo "$(ts) ${acc}: 文件不存在，跳过备份（不覆盖 1Password 已有备份）" | tee -a "$LOG"
    continue
  fi

  CONTENT=$(cat "$CREDS")
  # 校验是合法 JSON 且含 refreshToken 才备份（避免备份坏文件）
  if ! echo "$CONTENT" | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8'));if(!d.claudeAiOauth?.refreshToken)process.exit(1)" 2>/dev/null; then
    echo "$(ts) ${acc}: 文件无 refreshToken / 非法 JSON，跳过" | tee -a "$LOG"
    continue
  fi

  # upsert：item 存在则 edit，不存在则 create。credential 字段存 JSON 全文。
  if op item get "$ITEM" --vault "$VAULT" >/dev/null 2>&1; then
    op item edit "$ITEM" --vault "$VAULT" "credential=$CONTENT" >/dev/null 2>&1 \
      && { echo "$(ts) ${acc}: ✅ 已更新 1Password 备份"; backed=$((backed+1)); } \
      || echo "$(ts) ${acc}: ⚠️ 更新失败"
  else
    op item create --category "API Credential" --title "$ITEM" --vault "$VAULT" \
      "credential=$CONTENT" >/dev/null 2>&1 \
      && { echo "$(ts) ${acc}: ✅ 已创建 1Password 备份"; backed=$((backed+1)); } \
      || echo "$(ts) ${acc}: ⚠️ 创建失败"
  fi
done

echo "$(ts) 备份完成：${backed} 个账号" | tee -a "$LOG"
exit 0
