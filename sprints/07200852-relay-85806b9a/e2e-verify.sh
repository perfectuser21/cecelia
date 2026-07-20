# 前置：确认 migration 351 已在 cecelia DB 存在
psql $DATABASE_URL -c "SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 3;"

# 执行扫描（使用真实路径环境变量）
node /workspace/scripts/scan/scan-graph.mjs

# 验收断言 A：三仓均有边
psql $DATABASE_URL -c "SELECT repo, count(*) FROM graph_edges GROUP BY repo ORDER BY repo;"
# 期望：返回 ≥3 行，各行 count > 0
# 扫描刚完成，每仓 stale 应为 false
# 检查扫描器输出日志中包含各 repo 的 stale=false
node /workspace/scripts/scan/scan-graph.mjs 2>&1 | grep -E 'stale='
# 期望：cecelia stale=false, zenithjoy-workspace stale=false, zenithjoy-skills stale=false

# psql 时间戳断言：确认底层确实做了 per-repo 独立 SQL，cecelia 扫描时间在 5 分钟内
psql $DATABASE_URL -c "SELECT max(scanned_at) FROM graph_edges WHERE repo='cecelia';"
# 期望：返回时间戳距 now() 不超过 5 分钟（即 now() - max(scanned_at) < interval '5 minutes'）
psql $DATABASE_URL -c "SELECT (now() - max(scanned_at)) < interval '5 minutes' AS fresh FROM graph_edges WHERE repo='cecelia';"
# 期望：fresh = t
# 故意配错 zenithjoy-skills 路径
REPO_ROOT_ZJ_SKILLS=/nonexistent node /workspace/scripts/scan/scan-graph.mjs 2>&1
# 期望输出：包含 "WARN: repo=zenithjoy-skills 路径不存在，跳过"
# 期望输出：cecelia 和 zenithjoy-workspace 正常入库摘要行

# 强制断言退出码为 1（有跳过仓库时必须 exit 1，与 FR-2 一致）
REPO_ROOT_ZJ_SKILLS=/nonexistent node /workspace/scripts/scan/scan-graph.mjs; echo "exit=$?"
# 期望：exit=1

# DB 验证：cecelia 和 zenithjoy-workspace 仍有边
psql $DATABASE_URL -c "SELECT repo, count(*) FROM graph_edges WHERE repo IN ('cecelia','zenithjoy-workspace') GROUP BY repo;"
# 期望：两行均 count > 0
# GET 端点：默认行为（不传 repo，默认 cecelia）
curl -s "localhost:5221/api/brain/graph/locate?q=brain" | jq '.freshness.stale'
# 期望：false

# GET 端点：指定 repo 参数（各仓库均应返回正确数据）
curl -s "localhost:5221/api/brain/graph/locate?q=brain&repo=cecelia" | jq '.freshness'
# 期望：含 stale: false
curl -s "localhost:5221/api/brain/graph/locate?q=brain&repo=zenithjoy-workspace" | jq '.freshness'
# 期望：含 stale: false

# POST 端点：/radius 带 repo body 参数
curl -s -X POST "localhost:5221/api/brain/graph/radius" \
  -H "Content-Type: application/json" \
  -d '{"file":"packages/brain/src/server.js","depth":1,"repo":"cecelia"}' | jq '.repo // .freshness.stale'
# 期望：返回正常结果（不报 repo 参数错误，freshness.stale = false 或含 repo 字段）

# POST 端点：/radius 不传 repo，验证默认 cecelia 向后兼容
curl -s -X POST "localhost:5221/api/brain/graph/radius" \
  -H "Content-Type: application/json" \
  -d '{"file":"packages/brain/src/server.js","depth":1}' | jq '.freshness.stale // empty'
# 期望：false 或不报错
