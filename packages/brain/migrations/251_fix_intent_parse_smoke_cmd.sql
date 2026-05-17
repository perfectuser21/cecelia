-- Migration 251: 修正 intent-parse smoke_cmd
-- 路由实际挂载在 /api/brain/intent（非 /intent-match），字段为 query 而非 text
-- 原命令是文件存在检查（非真实端点验证），现改为真实 HTTP 断言

UPDATE features
SET smoke_cmd = 'curl -s -X POST http://localhost:5221/api/brain/intent/match -H "Content-Type: application/json" -d ''{"query":"smoke"}'' | jq -e ''.total != null'''
WHERE id = 'intent-parse';
