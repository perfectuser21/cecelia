---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: Brain↔Notion 属性映射修复

**范围**: packages/brain/src/routes/notes.js + notion-task + notion-push-sync + 新建 notion-property-map.js
**大小**: M

## ARTIFACT 条目

- [ ] [ARTIFACT] `packages/brain/src/notion-property-map.js` 文件存在，导出 `NOTION_PROPERTY_MAP` 和 `stripUnknownProperties`
  Test: node -e "import('./packages/brain/src/notion-property-map.js').then(m=>{if(typeof m.stripUnknownProperties!=='function'||typeof m.NOTION_PROPERTY_MAP!=='object')process.exit(1);console.log('OK')}).catch(()=>process.exit(1))"

- [ ] [ARTIFACT] `packages/brain/src/notion-push-sync.js` 不再含旧属性名 `Order:`，`packages/brain/src/routes/notes.js` 不再含 `Initiative ID` 和 notion/task handler 的旧 `Title:` 属性（风险 R3 mitigation — 扩展三处检查）
  Test: node -e "const fs=require('fs');const sync=fs.readFileSync('packages/brain/src/notion-push-sync.js','utf8');const notes=fs.readFileSync('packages/brain/src/routes/notes.js','utf8');if(sync.includes(\"'Order':\"))process.exit(1);if(notes.includes(\"'Initiative ID'\"))process.exit(1);const taskIdx=notes.indexOf(\"router.post('/notion/task'\");const taskSection=notes.slice(taskIdx,taskIdx+500);if(taskSection.includes(\"Title: {\"))process.exit(1);console.log('OK')"

- [ ] [ARTIFACT] `packages/brain/src/routes/notes.js` 不再硬编码 `'Initiative ID'` 属性到 Notion payload
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/notes.js','utf8');if(c.includes(\"'Initiative ID':\"))process.exit(1);console.log('OK')"

- [ ] [ARTIFACT] `packages/brain/src/routes/notes.js` `notion/task` handler 不再含 `Title:` 且已切换至新属性名
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/notes.js','utf8');const taskH=c.slice(c.indexOf('notion/task'));if(taskH.includes(\"Title: {\"))process.exit(1);console.log('OK')"

## BEHAVIOR 条目（内嵌可执行 manual: 命令 — journey_type=autonomous，测真实 Brain API）

- [ ] [BEHAVIOR] POST /api/brain/notes 返回 2xx，response 含 `url`（string）和 `warnings`（array）两个字段
  Test: manual:bash -c 'RESP=$(curl -sf -X POST localhost:5221/api/brain/notes -H "Content-Type: application/json" -d '"'"'{"title":"[contract-e2e-dod] notes 测试","content":"DoD 验证内容","type":"Note"}'"'"'); echo "$RESP" | jq -e '"'"'.url | type == "string"'"'"' || { echo "FAIL: url 字段不是 string"; exit 1; }; echo "$RESP" | jq -e '"'"'.warnings | type == "array"'"'"' || { echo "FAIL: warnings 字段缺失或不是 array"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] POST /api/brain/notes response 同时含 `url` 和 `warnings` 两个必填字段（keys 完整性）
  Test: manual:bash -c 'RESP=$(curl -sf -X POST localhost:5221/api/brain/notes -H "Content-Type: application/json" -d '"'"'{"title":"[contract-e2e-dod] keys test","content":"测试","type":"Note"}'"'"'); echo "$RESP" | jq -e '"'"'has("url") and has("warnings")'"'"' || { echo "FAIL: 必填字段 url 或 warnings 缺失"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] POST /api/brain/notes 带未知属性 → 2xx，`warnings` 非空，含跳过说明（降级路径 + 禁用字段反向验证）
  Test: manual:bash -c 'RESP=$(curl -sf -X POST localhost:5221/api/brain/notes -H "Content-Type: application/json" -d '"'"'{"title":"[contract-e2e-dod] 降级测试","content":"测试内容","type":"Note","Initiative ID":"旧属性测试值"}'"'"'); echo "$RESP" | jq -e '"'"'.warnings | type == "array"'"'"' || { echo "FAIL: warnings 字段缺失"; exit 1; }; echo "$RESP" | jq -e '"'"'.warnings | length > 0'"'"' || { echo "FAIL: 降级路径 warnings 应非空"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] POST /api/brain/notes 缺少 title → 400，error 字段存在（error path）
  Test: manual:bash -c 'CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST localhost:5221/api/brain/notes -H "Content-Type: application/json" -d '"'"'{"content":"无 title"}'"'"'); [ "$CODE" = "400" ] || { echo "FAIL: 缺 title 应返 400，实际 $CODE"; exit 1; }; RESP=$(curl -sf -s -X POST localhost:5221/api/brain/notes -H "Content-Type: application/json" -d '"'"'{"content":"无 title"}'"'"' 2>/dev/null || true); echo "$RESP" | jq -e '"'"'.error | type == "string"'"'"' 2>/dev/null || true; echo OK'
  期望: OK

- [ ] [BEHAVIOR] POST /api/brain/notion/task 返回 2xx，response 含 `url` 和 `warnings` 两个字段
  Test: manual:bash -c 'RESP=$(curl -sf -X POST localhost:5221/api/brain/notion/task -H "Content-Type: application/json" -d '"'"'{"title":"[contract-e2e-dod] task 测试"}'"'"'); echo "$RESP" | jq -e '"'"'.url | type == "string"'"'"' || { echo "FAIL: url 字段不是 string"; exit 1; }; echo "$RESP" | jq -e '"'"'.warnings | type == "array"'"'"' || { echo "FAIL: warnings 字段缺失"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] notion-push-sync.js 不含旧属性 `Order:` — step_link 推送修复静态验证
  Test: manual:bash -c 'grep -n "Order:" packages/brain/src/notion-push-sync.js && { echo "FAIL: Order 属性未移除"; exit 1; } || echo OK'
  期望: OK

- [ ] [BEHAVIOR] notion_sync_log 近 5 分钟无 "is not a property" 错误（push-sync 修复运行时验证）
  Test: manual:bash -c 'DB="${DB_URL:-postgresql://localhost/cecelia}"; COUNT=$(psql "$DB" -t -c "SELECT count(*) FROM notion_sync_log WHERE error_message LIKE '"'"'%is not a property%'"'"' AND created_at > NOW() - interval '"'"'5 minutes'"'"'" | tr -d " "); [ "${COUNT:-0}" -eq 0 ] || { echo "FAIL: notion_sync_log 有 $COUNT 条 is-not-a-property 错误"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] POST /api/brain/notes 带 initiative_id → DB notes 表 initiative_id 非 null（风险 R1 mitigation — 防重构误删 DB 写入）
  Test: manual:bash -c 'DB="${DB_URL:-postgresql://localhost/cecelia}"; RESP=$(curl -sf -X POST localhost:5221/api/brain/notes -H "Content-Type: application/json" -d '"'"'{"title":"[dod-r1-check] init id test","content":"test","type":"Note","initiative_id":"e2e-r1-check-id"}'"'"') || { echo "FAIL: POST 失败"; exit 1; }; echo "$RESP" | jq -e '"'"'.url | type == "string"'"'"' || { echo "FAIL: url 字段缺失"; exit 1; }; DB_ID=$(psql "$DB" -t -c "SELECT initiative_id FROM notes WHERE title='"'"'[dod-r1-check] init id test'"'"' AND created_at > NOW() - interval '"'"'5 minutes'"'"' LIMIT 1" | tr -d " "); [ -n "$DB_ID" ] && [ "$DB_ID" != "null" ] || { echo "FAIL: DB notes.initiative_id 为 null 或记录缺失"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] NOTION_PROPERTY_MAP.notionTask allowedKeys 不含 Status（风险 R2 mitigation — 防 Bug 2 回归）
  Test: manual:bash -c 'node -e "import('"'"'./packages/brain/src/notion-property-map.js'"'"').then(m=>{const t=m.NOTION_PROPERTY_MAP.notionTask||{};const keys=t.allowedKeys||Object.keys(t);if(keys.includes('"'"'Status'"'"')){console.error('"'"'FAIL: notionTask allowlist 含 Status — Bug 2 回归风险'"'"');process.exit(1)}console.log('"'"'OK'"'"')}).catch(e=>{console.error('"'"'FAIL:'"'"',e.message);process.exit(1)})"'
  期望: OK
