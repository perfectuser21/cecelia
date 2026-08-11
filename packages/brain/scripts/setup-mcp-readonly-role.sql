-- setup-mcp-readonly-role.sql
-- 只读角色，供美国M4 mcp-readonly 服务（packages/mcp-readonly/）查询 Cecelia 状态用。
-- 不允许 INSERT/UPDATE/DELETE/DDL，仅 SELECT 指定表。
--
-- 这个文件不放在 packages/brain/migrations/：migrations/ 里的 .sql 是被
-- packages/brain/src/migrate.js 用 Node `pg` 库的 client.query(sql) 当纯文本发给
-- Postgres 的——不经过 psql 客户端，不认识 \gexec / \if 等元命令，也不做 :'var' 变量替换，
-- 而且 server.js 里迁移连续失败 3 次会 process.exit(1)。这个文件依赖手工 psql 执行 +
-- 密码变量注入，跟 migrations/ 目录"自动、无交互、被 migrate.js 直接跑"的隐含契约冲突，
-- 放进去会在下次 Brain 启动时把迁移跑挂。改为只能通过 setup-mcp-readonly-role.sh
-- （用真正的 psql 客户端）手动执行一次。
--
-- 用法：不要直接 psql -f 这个文件——用同目录的 setup-mcp-readonly-role.sh（它会先检查
-- MCP_READONLY_PASSWORD 是否已设置，未设置直接报错退出，不会静默用空密码建角色）。

-- 防呆：mcp_readonly_password 变量未传时中止，不静默用空值/字面量继续执行。
-- （权威检查在 setup-mcp-readonly-role.sh 里做 shell 层 exit 1；这里是第二道防线，
-- 给直接拿 psql -f 跑这个文件的人一个看得懂的中文提示，而不是一头雾水的语法错误。）
\if :{?mcp_readonly_password}
\else
  \warn '缺少 mcp_readonly_password 变量，中止执行。请用 setup-mcp-readonly-role.sh 调用本脚本。'
  \quit
\endif

-- 注意：不能用 `DO $$ ... CREATE ROLE ... :'mcp_readonly_password' ... $$` 这种写法——
-- psql 的变量替换不会深入 $$ dollar-quoted 字符串内部，:'var' 在 DO 块里不会被替换，
-- 会原样发给 server 导致 "syntax error at or near ':'"（本机 cecelia_test 库实测复现）。
-- 改用 \gexec：先在顶层（非 dollar-quote 上下文）完成变量替换拼出 SQL 文本，
-- 幂等靠 WHERE NOT EXISTS 过滤——角色已存在时查询返回 0 行，\gexec 不执行任何操作。
SELECT format('CREATE ROLE mcp_readonly WITH LOGIN PASSWORD %L', :'mcp_readonly_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mcp_readonly')
\gexec

GRANT CONNECT ON DATABASE cecelia TO mcp_readonly;
GRANT USAGE ON SCHEMA public TO mcp_readonly;
GRANT SELECT ON schema_version TO mcp_readonly;
GRANT SELECT ON map_manifest_versions TO mcp_readonly;
GRANT SELECT ON map_projection_runs TO mcp_readonly;
GRANT SELECT ON map_projection_nodes TO mcp_readonly;
GRANT SELECT ON map_projection_edges TO mcp_readonly;

-- defense-in-depth，非当下生效逻辑：GRANT 只给了 SELECT，Postgres 权限默认拒绝
-- （default-deny），从未 GRANT 过 INSERT/UPDATE/DELETE/TRUNCATE，所以下面这条 REVOKE
-- 此刻是空操作（无实际效果）。保留是为了防未来有人在这张角色/这些表上加了
-- default privileges 或误 GRANT 写权限时，这条 REVOKE 能顶上；不要误以为它是当前
-- 只读生效的原因。
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON
  schema_version, map_manifest_versions, map_projection_runs,
  map_projection_nodes, map_projection_edges
FROM mcp_readonly;
