#!/usr/bin/env bash
# restore-claude-creds.sh — 缺失的 Claude 账号 .credentials.json 从 1Password 自动恢复
#
# 配合 backup-claude-creds.sh。在 Brain 部署前 / 开机时跑，把丢失的凭据文件补回，
# 这样 Brain（Docker 只读文件）永远能读到，harness 不会因单账号文件丢失卡死。
#
# 只恢复"缺失"的文件——已存在的不动（避免覆盖 refresh cron 刚续好的新 token）。
#
# 用法：bash restore-claude-creds.sh
# 退出码：始终 0（恢复失败 non-fatal，不阻塞部署）

set -uo pipefail

LOG="/tmp/claude-creds-restore.log"
ACCOUNTS=("account1" "account2" "account3")
VAULT="CS"

ts() { date '+%Y-%m-%d %H:%M:%S'; }

if [ -f "$HOME/.credentials/1password.env" ]; then
  # shellcheck disable=SC1091
  source "$HOME/.credentials/1password.env"
  export OP_SERVICE_ACCOUNT_TOKEN
else
  echo "$(ts) [WARN] 1password.env 不存在，跳过恢复" | tee -a "$LOG"
  exit 0
fi

if ! command -v op >/dev/null 2>&1; then
  echo "$(ts) [WARN] op CLI 不存在，跳过恢复" | tee -a "$LOG"
  exit 0
fi

restored=0
for acc in "${ACCOUNTS[@]}"; do
  CREDS="$HOME/.claude-${acc}/.credentials.json"
  ITEM="claude-creds-${acc}"

  if [ -f "$CREDS" ]; then
    continue  # 已存在，不动
  fi

  # 从 1Password 取 credential 字段
  CONTENT=$(op item get "$ITEM" --vault "$VAULT" --fields credential --reveal 2>/dev/null)
  if [ -z "$CONTENT" ]; then
    echo "$(ts) ${acc}: 缺文件且 1Password 无备份 → 需人工登录" | tee -a "$LOG"
    continue
  fi

  # 校验合法 JSON + 有 refreshToken
  if ! echo "$CONTENT" | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8'));if(!d.claudeAiOauth?.refreshToken)process.exit(1)" 2>/dev/null; then
    echo "$(ts) ${acc}: 1Password 备份非法，跳过" | tee -a "$LOG"
    continue
  fi

  mkdir -p "$HOME/.claude-${acc}"
  # 原子写：先 .tmp 再 mv，chmod 600
  printf '%s' "$CONTENT" > "${CREDS}.tmp" && chmod 600 "${CREDS}.tmp" && mv "${CREDS}.tmp" "$CREDS" \
    && { echo "$(ts) ${acc}: ✅ 已从 1Password 恢复 .credentials.json"; restored=$((restored+1)); } \
    || echo "$(ts) ${acc}: ⚠️ 写入失败"
done

echo "$(ts) 恢复完成：${restored} 个账号" | tee -a "$LOG"
exit 0
