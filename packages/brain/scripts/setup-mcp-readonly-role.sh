#!/usr/bin/env bash
# setup-mcp-readonly-role.sh — 一次性手动创建 mcp_readonly 只读角色
#
# 供美国M4 mcp-readonly 服务（packages/mcp-readonly/）查询 Cecelia 状态用。
# 只能 SELECT 五张表（schema_version / map_manifest_versions / map_projection_runs /
# map_projection_nodes / map_projection_edges），不能写。
#
# 不走 packages/brain/migrations/：那个目录是 migrate.js 在每次 Brain 启动时自动、
# 无交互执行的，不认识这个脚本用到的 \gexec / \if 等 psql 元命令，也不做变量替换。
# 这个脚本必须手动跑一次，且必须用真正的 psql 客户端（不是 migrate.js）。
#
# 用法：
#   MCP_READONLY_PASSWORD='<真实密码，来自1Password>' \
#     DB_HOST=host.docker.internal DB_USER=cecelia \
#     bash packages/brain/scripts/setup-mcp-readonly-role.sh
#   # 或直接给 DATABASE_URL：
#   MCP_READONLY_PASSWORD='...' DATABASE_URL=postgresql://cecelia:cecelia@host.docker.internal:5432/cecelia \
#     bash packages/brain/scripts/setup-mcp-readonly-role.sh
#
# 幂等：CREATE ROLE 用 WHERE NOT EXISTS + \gexec 判重，GRANT/REVOKE 本身幂等，重复执行安全。
#
# 本脚本不生成密码、不碰 1Password、不连生产库执行——真实密码生成 + 1Password 写入 +
# 生产库执行是部署阶段的事，本脚本只是那一步会调用的工具。

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# 防呆：密码变量必须显式传入，不允许空值/未设置时静默用空密码建角色。
if [ -z "${MCP_READONLY_PASSWORD:-}" ]; then
  echo "[setup-mcp-readonly-role] 错误：未设置 MCP_READONLY_PASSWORD，中止执行。" >&2
  echo "[setup-mcp-readonly-role] 用法：MCP_READONLY_PASSWORD='<密码>' bash $0" >&2
  exit 1
fi

DB_URL="${DATABASE_URL:-postgresql://${DB_USER:-cecelia}:${DB_PASSWORD:-cecelia}@${DB_HOST:-host.docker.internal}:${DB_PORT:-5432}/${DB_NAME:-cecelia}}"

echo "[setup-mcp-readonly-role] 目标: ${DB_URL%%:*}://***@$(echo "$DB_URL" | sed -E 's#.*@##')"
echo "[setup-mcp-readonly-role] 创建/校准 mcp_readonly 只读角色"

psql -v mcp_readonly_password="$MCP_READONLY_PASSWORD" \
  -v ON_ERROR_STOP=1 \
  "$DB_URL" \
  -f "$SCRIPT_DIR/setup-mcp-readonly-role.sql"

echo "[setup-mcp-readonly-role] ✅ 完成"
