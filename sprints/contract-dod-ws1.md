---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Workstream 1: GET /initiative/:id/detail 路由实现

**范围**: 在 `packages/brain/src/routes/harness.js` 新增 `router.get('/initiative/:id/detail', ...)` 路由，含 UUID 验证、initiative_contracts 查询、cecelia_events step_timing 重建、宽容 200 降级
**大小**: S（< 100 行净增）
**依赖**: 无

## ARTIFACT 条目

- [ ] [ARTIFACT] `packages/brain/src/routes/harness.js` 包含 `/initiative/:id/detail` 路由定义
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/harness.js','utf8');if(!c.includes(\"/initiative/:id/detail\"))process.exit(1);console.log('OK')"

- [ ] [ARTIFACT] 路由函数包含 UUID 格式校验（正则覆盖 8-4-4-4-12 格式）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/harness.js','utf8');if(!c.includes('invalid id'))process.exit(1);console.log('OK')"

## BEHAVIOR 条目（内嵌可执行 manual:bash 命令）

- [ ] [BEHAVIOR] 合法 UUID（无数据）→ HTTP 200，initiative_id 原样回显
  Test: manual:bash -c 'RESP=$(curl -sf localhost:5221/api/brain/harness/initiative/00000000-0000-0000-0000-000000000001/detail) || { echo "FAIL: 端点未返回 200"; exit 1; }; echo "$RESP" | jq -e ".initiative_id == \"00000000-0000-0000-0000-000000000001\"" || { echo "FAIL: initiative_id 不回显"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] 响应 keys 完全等于 PRD 定义的 6 字段（schema 完整性）
  Test: manual:bash -c 'RESP=$(curl -sf localhost:5221/api/brain/harness/initiative/00000000-0000-0000-0000-000000000001/detail) || exit 1; echo "$RESP" | jq -e '"'"'keys == ["contract_content","gan_rounds","initiative_id","prd_content","screenshot_urls","step_timing"]'"'"' || { echo "FAIL: keys 不匹配"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] step_timing 为 array 类型，screenshot_urls 固定为 []
  Test: manual:bash -c 'RESP=$(curl -sf localhost:5221/api/brain/harness/initiative/00000000-0000-0000-0000-000000000001/detail) || exit 1; echo "$RESP" | jq -e '"'"'.step_timing | type == "array"'"'"' || { echo "FAIL: step_timing 不是数组"; exit 1; }; echo "$RESP" | jq -e '"'"'.screenshot_urls == []'"'"' || { echo "FAIL: screenshot_urls 不是空数组"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] 非法 UUID → HTTP 400 + error 字段为 "invalid id"（error path）
  Test: manual:bash -c 'CODE=$(curl -s -o /dev/null -w "%{http_code}" localhost:5221/api/brain/harness/initiative/not-a-uuid/detail); [ "$CODE" = "400" ] || { echo "FAIL: 期望 400, 得到 $CODE"; exit 1; }; RESP=$(curl -s localhost:5221/api/brain/harness/initiative/not-a-uuid/detail); echo "$RESP" | jq -e '"'"'.error == "invalid id"'"'"' || { echo "FAIL: error 字段不匹配"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] prd_content 和 contract_content 字段类型为 string|null（PRD 字段值类型）
  Test: manual:bash -c 'RESP=$(curl -sf localhost:5221/api/brain/harness/initiative/00000000-0000-0000-0000-000000000001/detail) || exit 1; echo "$RESP" | jq -e '"'"'.prd_content == null or (.prd_content | type == "string")'"'"' || { echo "FAIL: prd_content 类型不符"; exit 1; }; echo "$RESP" | jq -e '"'"'.contract_content == null or (.contract_content | type == "string")'"'"' || { echo "FAIL: contract_content 类型不符"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] gan_rounds 字段类型为 number|null，全部 7 个禁用字段不存在（DoD SSOT — steps/stages/tasks/contract/runs/data/payload）
  Test: manual:bash -c 'RESP=$(curl -sf localhost:5221/api/brain/harness/initiative/00000000-0000-0000-0000-000000000001/detail) || exit 1; echo "$RESP" | jq -e '"'"'.gan_rounds == null or (.gan_rounds | type == "number")'"'"' || { echo "FAIL: gan_rounds 类型不符"; exit 1; }; echo "$RESP" | jq -e '"'"'has("steps") | not'"'"' || { echo "FAIL: 禁用字段 steps"; exit 1; }; echo "$RESP" | jq -e '"'"'has("stages") | not'"'"' || { echo "FAIL: 禁用字段 stages"; exit 1; }; echo "$RESP" | jq -e '"'"'has("tasks") | not'"'"' || { echo "FAIL: 禁用字段 tasks"; exit 1; }; echo "$RESP" | jq -e '"'"'has("contract") | not'"'"' || { echo "FAIL: 禁用字段 contract"; exit 1; }; echo "$RESP" | jq -e '"'"'has("runs") | not'"'"' || { echo "FAIL: 禁用字段 runs"; exit 1; }; echo "$RESP" | jq -e '"'"'has("data") | not'"'"' || { echo "FAIL: 禁用字段 data"; exit 1; }; echo "$RESP" | jq -e '"'"'has("payload") | not'"'"' || { echo "FAIL: 禁用字段 payload"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] HTTP 状态码不为 500（cecelia_events 查询降级，无 500 泄漏）
  Test: manual:bash -c 'CODE=$(curl -s -o /dev/null -w "%{http_code}" localhost:5221/api/brain/harness/initiative/00000000-0000-0000-0000-000000000001/detail); [ "$CODE" != "500" ] || { echo "FAIL: 返回 500"; exit 1; }; [ "$CODE" = "200" ] || { echo "FAIL: 期望 200, 得到 $CODE"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] step_timing 非空时元素结构符合 {node,started_at,ended_at,duration_ms}（Risk 2 缓解 — 防 payload 结构漂移）
  Test: manual:bash -c 'RESP=$(curl -sf localhost:5221/api/brain/harness/initiative/00000000-0000-0000-0000-000000000001/detail) || exit 1; echo "$RESP" | jq -e '"'"'.step_timing | if length > 0 then (.[0] | keys == ["duration_ms","ended_at","node","started_at"]) else true end'"'"' || { echo "FAIL: step_timing 元素 keys 不符 {node,started_at,ended_at,duration_ms}"; exit 1; }; echo "$RESP" | jq -e '"'"'.step_timing | if length > 0 then (.[0].node | type == "string") else true end'"'"' || { echo "FAIL: step_timing[0].node 不是 string"; exit 1; }; echo OK'
  期望: OK
