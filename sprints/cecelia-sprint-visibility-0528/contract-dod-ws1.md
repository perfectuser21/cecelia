---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Workstream 1: Brain Notion API 端点

**范围**: 新建 packages/brain/src/routes/notes.js 实现 3 个端点（POST /notes、POST /notion/project、POST /notion/task）；在 packages/brain/server.js 注册 notesRoutes 和 notionRoutes
**大小**: M（~150 行净增，2 文件）
**依赖**: 无

## ARTIFACT 条目

- [ ] [ARTIFACT] packages/brain/src/routes/notes.js 文件存在
  Test: node -e "require('fs').accessSync('packages/brain/src/routes/notes.js')" || exit 1

- [ ] [ARTIFACT] notes.js 含 POST /notes 路由注册（router.post）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/notes.js','utf8');if(!c.includes('router.post'))process.exit(1)"

- [ ] [ARTIFACT] notes.js 含 /notion/project 路由注册
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/notes.js','utf8');if(!c.includes('notion/project')&&!c.includes('\"/project\"'))process.exit(1)"

- [ ] [ARTIFACT] notes.js 含 /notion/task 路由注册
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/notes.js','utf8');if(!c.includes('notion/task')&&!c.includes('\"/task\"'))process.exit(1)"

- [ ] [ARTIFACT] notes.js 含 [Sprint] 前缀字面量
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/notes.js','utf8');if(!c.includes('[Sprint]'))process.exit(1)"

- [ ] [ARTIFACT] notes.js 含 Notion API 502 错误处理
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/notes.js','utf8');if(!c.includes('502'))process.exit(1)"

- [ ] [ARTIFACT] server.js 已注册 notes 相关路由
  Test: node -e "const c=require('fs').readFileSync('packages/brain/server.js','utf8');if(!c.includes('notes'))process.exit(1)"

## BEHAVIOR 条目（内嵌可执行 manual: 命令）

- [ ] [BEHAVIOR] POST /api/brain/notes 端点已注册（非 404），接受合法请求返回 201 或 502
  Test: manual:bash -c 'CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST localhost:5221/api/brain/notes -H "Content-Type: application/json" -d "{\"title\":\"dod-test\",\"content\":\"c\",\"type\":\"Note\"}"); [ "$CODE" = "201" ] || [ "$CODE" = "502" ] || { echo "FAIL: 端点未注册 code=$CODE"; exit 1; }; echo OK code=$CODE'
  期望: OK（201 或 502，绝不能是 404）

- [ ] [BEHAVIOR] POST /api/brain/notes 返回 schema 含 id/url/title，keys 完全等于 ["id","title","url"]，禁用字段不出现（仅 201 时验证）
  Test: manual:bash -c 'RESP=$(curl -sf -X POST localhost:5221/api/brain/notes -H "Content-Type: application/json" -d "{\"title\":\"schema-check\",\"content\":\"c\",\"type\":\"Note\"}") 2>/dev/null; if [ $? -eq 0 ]; then echo "$RESP" | jq -e ".id | type == \"string\"" || { echo "FAIL: id 缺失"; exit 1; }; echo "$RESP" | jq -e ".url | type == \"string\"" || { echo "FAIL: url 缺失"; exit 1; }; echo "$RESP" | jq -e ".title | type == \"string\"" || { echo "FAIL: title 缺失"; exit 1; }; echo "$RESP" | jq -e "has(\"page_id\") | not" || { echo "FAIL: 禁用字段 page_id 出现"; exit 1; }; echo "$RESP" | jq -e "has(\"notion_id\") | not" || { echo "FAIL: 禁用字段 notion_id 出现"; exit 1; }; echo "$RESP" | jq -e "has(\"result\") | not" || { echo "FAIL: 禁用字段 result 出现"; exit 1; }; echo "$RESP" | jq -e "has(\"data\") | not" || { echo "FAIL: 禁用字段 data 出现"; exit 1; }; echo "$RESP" | jq -e "keys == [\"id\",\"title\",\"url\"]" || { echo "FAIL: /notes response keys 不完全匹配"; exit 1; }; echo OK schema valid; fi; echo OK'
  期望: OK schema valid（Notion 可用时）；keys 完全等于 ["id","title","url"]

- [ ] [BEHAVIOR] POST /api/brain/notion/project 已注册 + title 精确等于 "[Sprint] MyRun"（原始 title 保留）+ keys == ["id","title","url"]（201 时）
  Test: manual:bash -c 'CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST localhost:5221/api/brain/notion/project -H "Content-Type: application/json" -d "{\"title\":\"MyRun\"}"); [ "$CODE" = "201" ] || [ "$CODE" = "502" ] || { echo "FAIL: /notion/project 未注册 code=$CODE"; exit 1; }; if [ "$CODE" = "201" ]; then RESP=$(curl -sf -X POST localhost:5221/api/brain/notion/project -H "Content-Type: application/json" -d "{\"title\":\"MyRun\"}"); echo "$RESP" | jq -e ".title | startswith(\"[Sprint]\")" || { echo "FAIL: [Sprint] 前缀缺失"; exit 1; }; echo "$RESP" | jq -e ".title == \"[Sprint] MyRun\"" || { echo "FAIL: title 未精确匹配 [Sprint] MyRun（generator 不能只返回 [Sprint]）"; exit 1; }; echo "$RESP" | jq -e "keys == [\"id\",\"title\",\"url\"]" || { echo "FAIL: /notion/project response keys 不匹配（多余字段）"; exit 1; }; fi; echo OK'
  期望: OK；201 时 title 精确等于 "[Sprint] MyRun"；keys 完全等于 ["id","title","url"]

- [ ] [BEHAVIOR] POST /api/brain/notion/task 已注册 + title 精确等于 "[WS2] 实现功能X"（ws_number=2 精确匹配）+ keys == ["id","title","url"]（201 时）
  Test: manual:bash -c 'CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST localhost:5221/api/brain/notion/task -H "Content-Type: application/json" -d "{\"title\":\"实现功能X\",\"ws_number\":2}"); [ "$CODE" = "201" ] || [ "$CODE" = "502" ] || { echo "FAIL: /notion/task 未注册 code=$CODE"; exit 1; }; if [ "$CODE" = "201" ]; then RESP=$(curl -sf -X POST localhost:5221/api/brain/notion/task -H "Content-Type: application/json" -d "{\"title\":\"实现功能X\",\"ws_number\":2}"); echo "$RESP" | jq -e ".id | type == \"string\"" || { echo "FAIL: id 缺失"; exit 1; }; echo "$RESP" | jq -e ".url | type == \"string\"" || { echo "FAIL: url 缺失"; exit 1; }; echo "$RESP" | jq -e ".title | startswith(\"[WS2]\")" || { echo "FAIL: title 未以 [WS2] 开头（ws_number=2 → 必须精确 [WS2]，[WSnone]/[WS] 不合规）"; exit 1; }; echo "$RESP" | jq -e ".title == \"[WS2] 实现功能X\"" || { echo "FAIL: title 未精确匹配 [WS2] 实现功能X（原始 title 未保留）"; exit 1; }; echo "$RESP" | jq -e "has(\"page_id\") | not" || { echo "FAIL: 禁用字段 page_id"; exit 1; }; echo "$RESP" | jq -e "keys == [\"id\",\"title\",\"url\"]" || { echo "FAIL: /notion/task response keys 不匹配（多余字段）"; exit 1; }; fi; echo OK'
  期望: OK；201 时 title 精确等于 "[WS2] 实现功能X"；keys 完全等于 ["id","title","url"]；无禁用字段

- [ ] [BEHAVIOR] POST /api/brain/notes 缺 title → HTTP 400 + {error: string}（error path）
  Test: manual:bash -c 'CODE=$(curl -s -o /tmp/err-resp.json -w "%{http_code}" -X POST localhost:5221/api/brain/notes -H "Content-Type: application/json" -d "{\"content\":\"c\",\"type\":\"Note\"}"); [ "$CODE" = "400" ] || { echo "FAIL: 缺 title 应返 400，实际 $CODE"; exit 1; }; jq -e ".error | type == \"string\"" /tmp/err-resp.json || { echo "FAIL: error 字段缺失或非 string"; exit 1; }; echo OK'
  期望: OK；HTTP 400 + {error: string}

- [ ] [BEHAVIOR] POST /api/brain/notes 缺 content → HTTP 400 + {error: string}（error path）
  Test: manual:bash -c 'CODE=$(curl -s -o /tmp/err-resp2.json -w "%{http_code}" -X POST localhost:5221/api/brain/notes -H "Content-Type: application/json" -d "{\"title\":\"t\",\"type\":\"Note\"}"); [ "$CODE" = "400" ] || { echo "FAIL: 缺 content 应返 400，实际 $CODE"; exit 1; }; jq -e ".error | type == \"string\"" /tmp/err-resp2.json || { echo "FAIL: error 字段缺失"; exit 1; }; echo OK'
  期望: OK；HTTP 400 + {error: string}
