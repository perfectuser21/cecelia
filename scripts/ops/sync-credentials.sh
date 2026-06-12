#!/usr/bin/env bash
# sync-credentials.sh — 从 1Password CS Vault 同步所有凭据到本地 ~/.credentials/
# 用法: bash ~/.credentials/sync-credentials.sh
#
# 仓库 SSOT：scripts/ops/sync-credentials.sh。宿主部署副本：
#   ~/.credentials/sync-credentials.sh 与 ~/bin/sync-credentials.sh（改本文件后同步过去）。

set -euo pipefail
CRED_DIR="$HOME/.credentials"
source "$CRED_DIR/1password.env"
export OP_SERVICE_ACCOUNT_TOKEN

echo '🔑 连接 1Password...'
op vault get CS --format json > /dev/null 2>&1 || { echo '❌ token 无效'; exit 1; }

sync_item() {
  local item="$1" outfile="$2"
  op item get "$item" --vault CS --format json 2>/dev/null | node -e "
    const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    const lines=[];
    d.fields?.forEach(f=>{if(f.value&&f.label&&f.purpose!=='NOTES'&&f.type!=='CONCEALED'||f.purpose==='PASSWORD')lines.push(f.label+'='+f.value);});
    if(lines.length) require('fs').writeFileSync('$outfile',lines.join('\n'));
  " 2>/dev/null && echo "  ✅ $outfile" || echo "  ⚠️ skip $item"
}

# sync_notes — 像 sync_item 一样取 fields KV，并额外解析 notesPlain 里的 KEY=VALUE 行（跳过 # 注释）。
# 适用于把凭据写在 Notes（notesPlain）而非独立 field 的条目，如 ToAPIs（TOAPIS_API_KEY / TOAPIS_BASE_URL）。
sync_notes() {
  local item="$1" outfile="$2"
  op item get "$item" --vault CS --format json 2>/dev/null | node -e "
    const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    const lines=[];
    const isVar=(s)=>/^[A-Za-z_][A-Za-z0-9_]*\$/.test(s);  // 只收合法 env 变量名（跳过 'valid from'/'expires' 等）
    d.fields?.forEach(f=>{if(f.value&&f.label&&isVar(f.label)&&(f.purpose!=='NOTES'&&f.type!=='CONCEALED'||f.purpose==='PASSWORD'))lines.push(f.label+'='+f.value);});
    const notes=(d.fields||[]).find(f=>f.purpose==='NOTES')?.value||'';
    notes.split('\n').forEach(l=>{
      const t=l.trim();
      if(!t||t.startsWith('#'))return;
      const m=t.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)\$/);
      if(m) lines.push(m[1]+'='+m[2]);
    });
    if(lines.length) require('fs').writeFileSync('$outfile',lines.join('\n'));
  " 2>/dev/null && echo "  ✅ $outfile" || echo "  ⚠️ skip $item"
}

sync_json() {
  local item="$1" outfile="$2" keyfield="$3"
  op item get "$item" --vault CS --format json 2>/dev/null | node -e "
    const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    const v=d.fields?.find(f=>f.label==='$keyfield')?.value||'';
    if(v) require('fs').writeFileSync('$outfile',JSON.stringify({api_key:v},null,2));
  " 2>/dev/null && echo "  ✅ $outfile" || echo "  ⚠️ skip $item"
}

find "$CRED_DIR" -name '*.env' ! -name '1password.env' -delete 2>/dev/null || true
find "$CRED_DIR" -name '*.json' -delete 2>/dev/null || true

echo '📥 同步中...'
sync_json  'Anthropic Claude API'   "$CRED_DIR/anthropic.json"    credential
sync_item  'OpenAI-claudecode2026'  "$CRED_DIR/openai.env"
sync_item  'MiniMax API'            "$CRED_DIR/minimax.env"
sync_item  'Cloudflare'             "$CRED_DIR/cloudflare.env"
sync_item  'GitHub Tokens'          "$CRED_DIR/github.env"
sync_item  'Feishu (飞书)'          "$CRED_DIR/feishu.env"
sync_item  'WeChat 微信公众号'       "$CRED_DIR/wechat.env"
sync_item  'Notion'                 "$CRED_DIR/notion.env"
sync_item  'Cecelia PostgreSQL'     "$CRED_DIR/database.env"
sync_item  'Trading PostgreSQL'     "$CRED_DIR/trading-postgres.env"
sync_item  'Tailscale'              "$CRED_DIR/tailscale.env"
sync_item  'Cecelia Deploy Token'   "$CRED_DIR/cecelia-deploy.env"
sync_item  'Tencent Cloud (腾讯云)' "$CRED_DIR/tencent-cloud.env"
sync_item  'DigitalOcean'           "$CRED_DIR/digitalocean.env"
sync_item  'N8N'                    "$CRED_DIR/n8n.env"
sync_item  'ToAPI'                  "$CRED_DIR/toapi.env"
# ToAPIs 把 TOAPIS_API_KEY / TOAPIS_BASE_URL 写在 notesPlain（非独立 field）→ 用 sync_notes 解析。
sync_notes 'ToAPIs'                 "$CRED_DIR/toapis.env"
sync_item  'DevGate'                "$CRED_DIR/devgate.env"
sync_item  'Polygon.io API Key'     "$CRED_DIR/polygon.env"

chmod 600 "$CRED_DIR"/*.env "$CRED_DIR"/*.json 2>/dev/null || true
echo ''
echo '✅ 同步完成！从 1Password 更新到 ~/.credentials/'
echo '   跨机器部署：复制 1password.env → 运行此脚本'
