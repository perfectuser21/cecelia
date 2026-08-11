#!/bin/bash
# packages/mcp-readonly/deploy/deploy.sh
#
# 部署 cecelia-mcp-readonly 为 LaunchDaemon 常驻服务。
#
# REPO_ROOT 指向生产 checkout（/Users/administrator/perfect21/cecelia，与
# packages/brain/deploy/com.cecelia.brain.plist 用的是同一个生产仓库路径），
# 不是开发用的 per-session worktree（worktree 会话结束会被清理，plist 里
# 写死 worktree 路径服务会随 worktree 删除而炸）。
set -euo pipefail

REPO_ROOT="/Users/administrator/perfect21/cecelia"
PLIST_SRC="$REPO_ROOT/packages/mcp-readonly/deploy/com.cecelia.mcp-readonly.plist"
PLIST_DST="/Library/LaunchDaemons/com.cecelia.mcp-readonly.plist"
ENV_DST="$REPO_ROOT/packages/mcp-readonly/.env"

# 凭据来源（PrepPRD 约定）：
#   ~/.credentials/mcp-bearer.env   → 必须定义 MCP_BEARER_TOKEN=<token>
#   ~/.credentials/mcp-readonly.env → 必须定义 MCP_READONLY_DATABASE_URL=<完整 postgres 连接串>
#     （1Password CS Vault 条目 mcp-readonly-db 双写到这里时直接写成可用的
#     连接串，不是裸密码——避免 deploy.sh 还要拼 host/port/dbname/user，
#     那样任何一处硬编码假设变了（换机器/换库名）都要连带改脚本。）
#   ~/.credentials/bark.env         → 已是仓库既有共享约定（scripts/deploy-local.sh、
#     scripts/lib/bluegreen.sh、scripts/sentinel/dead-man-switch.sh 均如此读取），
#     BARK_TOKEN 不是 mcp-readonly 专属密钥，复用同一份，不新开一份重复副本。
# dotenv 默认只读进程 cwd 下单一 .env 文件，三份凭据分散在不同文件——这里在
# 部署期把三者拼成 mcp-readonly 自己的 .env（WorkingDirectory 下），而不是让
# server.js 自己尝试同时 load 三个路径，保持 server.js 的 dotenv 用法与
# packages/brain 完全一致（一行 `import 'dotenv/config'`），复杂度收在部署脚本。
MCP_BEARER_ENV="$HOME/.credentials/mcp-bearer.env"
MCP_READONLY_DB_ENV="$HOME/.credentials/mcp-readonly.env"
BARK_ENV="$HOME/.credentials/bark.env"

echo "1. 安装依赖"
cd "$REPO_ROOT/packages/mcp-readonly" && npm install --production

echo "2. 确保日志目录存在"
mkdir -p "$REPO_ROOT/logs"

echo "3. 生成/校验 .env（拼装三份凭据文件）"
for f in "$MCP_BEARER_ENV" "$MCP_READONLY_DB_ENV"; do
  if [ ! -f "$f" ]; then
    echo "❌ 缺少凭据文件：$f" >&2
    echo "   请先按 PrepPRD 把对应密钥双写到这个文件（源=1Password CS Vault），再重跑部署。" >&2
    exit 1
  fi
done
{
  cat "$MCP_BEARER_ENV"
  echo
  cat "$MCP_READONLY_DB_ENV"
  echo
  # bark.env 可选：未配置 BARK_TOKEN 时告警功能静默跳过（alerting.js 既有设计），
  # 不能因为它缺失就拦停整个部署——鉴权和 DB 才是启动必需项。
  [ -f "$BARK_ENV" ] && cat "$BARK_ENV"
} > "$ENV_DST"
chmod 600 "$ENV_DST"

# 校验拼出来的 .env 真的含三个必需变量且非空值，而不是只检查"文件存在"——
# 防止凭据文件存在但内容写错 key 名/空值这种更隐蔽的失败，此时不应该带病部署。
set -a
# shellcheck disable=SC1090
source "$ENV_DST"
set +a
MISSING=()
[ -z "${MCP_BEARER_TOKEN:-}" ] && MISSING+=("MCP_BEARER_TOKEN")
[ -z "${MCP_READONLY_DATABASE_URL:-}" ] && MISSING+=("MCP_READONLY_DATABASE_URL")
if [ ${#MISSING[@]} -gt 0 ]; then
  echo "❌ .env 拼装完成，但以下必需变量缺失或为空：${MISSING[*]}" >&2
  echo "   检查 $MCP_BEARER_ENV / $MCP_READONLY_DB_ENV 里的变量名是否正确。" >&2
  exit 1
fi
if [ -z "${BARK_TOKEN:-}" ]; then
  echo "⚠️  未配置 BARK_TOKEN（$BARK_ENV 不存在或未定义），告警功能将静默跳过，不阻塞部署"
fi
echo "✅ .env 就绪：MCP_BEARER_TOKEN / MCP_READONLY_DATABASE_URL 均非空"

echo "4. 部署前 smoke：现有 5211/5221 响应时间基线"
curl -s -o /dev/null -w "5211 baseline: %{time_total}s\n" http://localhost:5211/ || true
curl -s -o /dev/null -w "5221 baseline: %{time_total}s\n" http://localhost:5221/health || true

echo "5. 安装 LaunchDaemon"
sudo cp "$PLIST_SRC" "$PLIST_DST"
sudo launchctl bootstrap system "$PLIST_DST" || (sudo launchctl bootout system "$PLIST_DST" && sudo launchctl bootstrap system "$PLIST_DST")

echo "6. 部署后 smoke：确认新服务健康 + 现有服务无劣化"
sleep 2
curl -sf http://localhost:8787/health
curl -s -o /dev/null -w "5211 after: %{time_total}s\n" http://localhost:5211/ || true
curl -s -o /dev/null -w "5221 after: %{time_total}s\n" http://localhost:5221/health || true

echo "7. 部署后 smoke：真实 MCP 鉴权+DB 探测（tools/call get_schema_version）"
# 只测 /health 测不出 MCP_BEARER_TOKEN / MCP_READONLY_DATABASE_URL 没接线——
# /health 端点本身不碰鉴权中间件也不碰数据库。这里带真实 token 走一次完整
# MCP JSON-RPC 调用，同时验证鉴权链路和 DB 连接链路都真的用上了刚注入的环境变量。
MCP_PROBE_RESPONSE=$(curl -s -X POST http://localhost:8787/mcp \
  -H "Authorization: Bearer ${MCP_BEARER_TOKEN}" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_schema_version","arguments":{}}}')

MCP_PROBE_DATA_LINE=$(printf '%s\n' "$MCP_PROBE_RESPONSE" | grep '^data: ' | head -1 || true)
if [ -z "$MCP_PROBE_DATA_LINE" ]; then
  echo "❌ MCP 探测失败：响应中没有 SSE data 行（鉴权中间件或 DB 连接可能没真正生效）" >&2
  echo "原始响应：$MCP_PROBE_RESPONSE" >&2
  exit 1
fi
node -e "
const rpc = JSON.parse(process.argv[1]);
if (rpc.error) {
  console.error('❌ MCP JSON-RPC 顶层错误:', JSON.stringify(rpc.error));
  process.exit(1);
}
if (!rpc.result || rpc.result.isError) {
  console.error('❌ MCP 工具调用返回错误（isError）:', JSON.stringify(rpc.result));
  process.exit(1);
}
const payload = JSON.parse(rpc.result.content[0].text);
if (typeof payload.current_version !== 'number') {
  console.error('❌ get_schema_version 未返回合法版本号:', JSON.stringify(payload));
  process.exit(1);
}
console.log('✅ MCP 鉴权+DB 探测通过，current_version=' + payload.current_version);
" "${MCP_PROBE_DATA_LINE#data: }"

echo "部署完成。下一步：在 Cloudflare Zero Trust 后台给现有 Tunnel 加一条 public hostname ingress 规则，指向 localhost:8787"
