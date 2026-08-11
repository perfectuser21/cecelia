-- Migration 406: 只读角色，供美国M4 mcp-readonly 服务查询 Cecelia 状态用。
-- 不允许 INSERT/UPDATE/DELETE/DDL，仅 SELECT 指定表。

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

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON
  schema_version, map_manifest_versions, map_projection_runs,
  map_projection_nodes, map_projection_edges
FROM mcp_readonly;
