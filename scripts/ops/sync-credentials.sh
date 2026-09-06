#!/usr/bin/env bash
# sync-credentials.sh — 从 1Password CS Vault 同步所有凭据到本地 ~/.credentials/
# 用法: bash ~/.credentials/sync-credentials.sh
#
# 仓库 SSOT：scripts/ops/sync-credentials.sh。宿主部署副本：
#   ~/.credentials/sync-credentials.sh 与 ~/bin/sync-credentials.sh（改本文件后同步过去）。
#
# ── 2026-09-07 大修 ────────────────────────────────────────────────────
# 现场发现：14 个凭据文件里 9 个是垃圾，内容只有
#     valid from=0
#     expires=0
# 根因是老的字段过滤条件写了 `f.type !== 'CONCEALED'`，而 1Password 里**真凭据
# 恰恰全是 CONCEALED 类型**——于是所有有用的东西被排除，只剩两个 DATE 元数据。
# `valid from=0` 带空格，source 时被当成命令，直接 command not found。
# 而多数条目的凭据其实写在 notesPlain 里，老的 sync_item 根本不读 notes。
#
# 症状极难查：文件在、权限对、看着正常，只有真 source 才炸；而多数调用点写的是
# `source ... 2>/dev/null || true`，于是全程静默失效。
#
# 三处改动：
#   ① 提取逻辑抽到 scripts/ops/lib/op-item-to-env.js，配回归守卫
#      （scripts/ops/__tests__/credentials/op-item-to-env.test.sh）。
#      内联在 heredoc 里的逻辑没法测，条件写反了没人发现，就是这么烂掉的。
#   ② sync_item / sync_notes 合并成一个 sync：既读独立字段也读 notes。
#      分成两个的唯一后果就是"忘了用对哪个"，而两者本来没有冲突。
#   ③ 先写临时目录 → 每个文件 bash -n 自检 → 全过了才替换真目录。
#      老版本是"先把 *.env 全删、再一个个同步"，中途任何失败都会让机器彻底没凭据。

set -euo pipefail
CRED_DIR="$HOME/.credentials"
LIB="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/op-item-to-env.js"

if [ ! -f "$LIB" ]; then
  echo "❌ 找不到提取器 $LIB —— 部署副本要和 scripts/ops/lib/ 一起复制过来"
  exit 1
fi

source "$CRED_DIR/1password.env"
export OP_SERVICE_ACCOUNT_TOKEN

echo '🔑 连接 1Password...'
op vault get CS --format json > /dev/null 2>&1 || { echo '❌ token 无效'; exit 1; }

STAGE=$(mktemp -d "${TMPDIR:-/tmp}/credsync.XXXXXX")
trap 'rm -rf "$STAGE"' EXIT

SKIPPED=()

# sync — 一个条目 → 一个 .env。独立字段和 notesPlain 都读。
sync() {
  local item="$1" name="$2"
  if op item get "$item" --vault CS --format json 2>/dev/null | node "$LIB" > "$STAGE/$name" 2>/dev/null; then
    echo "  ✅ $name"
  else
    # 提取器 exit 3 = 一条都没提出来。写个空文件出去等于假装成功，宁可跳过。
    rm -f "$STAGE/$name"
    SKIPPED+=("$name ($item)")
    # ${item} 的花括号不能省：$item 紧贴全角「」时 bash 会把多字节字符当成
    # 变量名的一部分，报 unbound variable（janitor_audiomxd_log_format.test.sh
    # 守的就是这个坑，这里刚又踩了一次）
    echo "  ⚠️  skip ${name} —— 条目「${item}」里没提取到任何 KEY=VALUE"
  fi
}

sync_json() {
  local item="$1" name="$2" keyfield="$3"
  op item get "$item" --vault CS --format json 2>/dev/null | node -e "
    const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    const v=d.fields?.find(f=>f.label==='$keyfield')?.value||'';
    if(!v) process.exit(3);
    process.stdout.write(JSON.stringify({api_key:v},null,2));
  " > "$STAGE/$name" 2>/dev/null && echo "  ✅ $name" || {
    rm -f "$STAGE/$name"; SKIPPED+=("$name ($item)"); echo "  ⚠️  skip $name"
  }
}

echo '📥 同步中...'
sync_json 'Anthropic Claude API'   anthropic.json  credential
# ⚠️ 2026-09-07 实测：CS vault 里已经没有「OpenAI-claudecode2026」这个条目
#    （改名或删了），所以 openai.env 一直生不出来。而
#    packages/engine/runners/codex/playwright-runner.sh 还在 source 它。
#    保留这一行是为了条目一旦被重建就能自动接上；真要修得先确认该用哪个条目
#    （vault 里现有 'OpenAI-JNSY Affine' 和 5 个 'Codex teamN auth'，用途不同，
#    不能瞎指）。
sync 'OpenAI-claudecode2026'       openai.env
sync 'MiniMax API'                 minimax.env
sync 'Cloudflare'                  cloudflare.env
sync 'GitHub Tokens'               github.env
sync 'Feishu (飞书)'               feishu.env
sync 'WeChat 微信公众号'            wechat.env
# 微信小程序（zenithjoy-miniapp 的 CI 和本地 npm run upload 都要它）。
# 2026-09-07 加入：此前没登记，被下面的"全量替换"规则清掉过一次，
# 上传脚本直接找不到文件——凡新增 env 凭据必须登记进本清单。
sync 'WeChat 微信小程序'            wechat-miniapp.env
sync 'Notion'                      notion.env
sync 'Cecelia PostgreSQL'          database.env
sync 'Trading PostgreSQL'          trading-postgres.env
sync 'Tailscale'                   tailscale.env
sync 'Cecelia Deploy Token'        cecelia-deploy.env
sync 'Tencent Cloud (腾讯云)'      tencent-cloud.env
sync 'DigitalOcean'                digitalocean.env
sync 'N8N'                         n8n.env
sync 'ToAPI'                       toapi.env
sync 'ToAPIs'                      toapis.env
sync 'DevGate'                     devgate.env
sync 'Polygon.io API Key'          polygon.env
# Bark 推送（死人开关/紧急告警）：条目字段名是 key，不是大写变量名，
# 通用提取器的"合法变量名"规则会把它丢掉，所以单独处理。
# 2026-07-07 加入：此前 bark.env 手工创建，被全量替换规则清掉，
# 导致死人开关 cron 告警"未配 BARK_TOKEN"静默失败。
op item get 'Bark Push Key' --vault CS --format json 2>/dev/null | node -e "
  const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
  const v=d.fields?.find(f=>f.label==='key')?.value||'';
  if(!v) process.exit(3);
  process.stdout.write('export BARK_TOKEN=\"'+v+'\"\n');
" > "$STAGE/bark.env" 2>/dev/null && echo "  ✅ bark.env" || {
  rm -f "$STAGE/bark.env"; SKIPPED+=("bark.env (Bark Push Key)"); echo "  ⚠️  skip bark.env"
}

# ── 落盘前自检：每个 .env 必须是 source 得动的合法 shell ──────────────
# 这一条是本次事故的直接守卫。老版本写完就算完，`valid from=0` 这种
# 语法错误要等到几周后某个 cron 静默失败才被发现。
echo '🔍 自检...'
BAD=()
for f in "$STAGE"/*.env; do
  [ -e "$f" ] || continue
  bash -n "$f" 2>/dev/null || BAD+=("$(basename "$f")")
done
if [ "${#BAD[@]}" -gt 0 ]; then
  echo "❌ 这些文件不是合法 shell，拒绝落盘（真目录保持原样）："
  printf '   - %s\n' "${BAD[@]}"
  exit 1
fi

COUNT=$(find "$STAGE" -maxdepth 1 -type f | wc -l | tr -d ' ')
if [ "$COUNT" -lt 5 ]; then
  echo "❌ 只同步到 $COUNT 个文件，明显不对（1Password 可能抽风），拒绝落盘"
  exit 1
fi

# ── 原子替换：到这里才动真目录 ────────────────────────────────────────
# 只删本次成功生成的同名文件，不再"先把 *.env 全删"——那样中途失败会让
# 这台机器彻底没有凭据。1password.env 是引导凭据，永远不碰。
for f in "$STAGE"/*; do
  base=$(basename "$f")
  [ "$base" = "1password.env" ] && continue
  cp "$f" "$CRED_DIR/$base"
done
chmod 600 "$CRED_DIR"/*.env "$CRED_DIR"/*.json 2>/dev/null || true

echo ''
echo "✅ 同步完成：$COUNT 个文件已更新"
if [ "${#SKIPPED[@]}" -gt 0 ]; then
  echo ''
  echo "⚠️  以下条目没提取到内容，本地旧文件保持不变（可能是条目改名或字段搬走了）："
  printf '   - %s\n' "${SKIPPED[@]}"
fi
echo '   跨机器部署：复制 1password.env + scripts/ops/lib/ → 运行此脚本'
