---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: harness initiative_runs 列表查询 API（B48 诊断）

**范围**: `packages/brain/src/routes/harness.js` 新增 `GET /initiative-runs` 列表端点，支持 phase/journey_id/limit 过滤，返回 `{runs[], total}` 结构
**大小**: S

---

## ARTIFACT 条目

- [ ] [ARTIFACT] `packages/brain/src/routes/harness.js` 包含 `router.get('/initiative-runs',` 路由注册（无路径参数，位于 `:id` 路由之前）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/harness.js','utf8');const idx=c.indexOf(\"router.get('/initiative-runs',\");const idxId=c.indexOf(\"router.get('/initiative-runs/:id'\");if(idx<0)process.exit(1);if(idxId>=0&&idx>idxId)process.exit(1);console.log('OK')"

- [ ] [ARTIFACT] SQL SELECT 包含 `cost_usd::float` 强制转换（防止 NUMERIC 类型序列化为字符串）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/harness.js','utf8');if(!c.includes('cost_usd::float'))process.exit(1);console.log('OK')"

- [ ] [ARTIFACT] SQL SELECT 包含 `ORDER BY created_at DESC`（结果按时间倒序）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/harness.js','utf8');if(!c.includes('ORDER BY created_at DESC'))process.exit(1);console.log('OK')"

- [ ] [ARTIFACT] SQL SELECT 不含 `contract_id`、`current_task_id`、`merged_task_ids`（禁用字段不出现在 initiative-runs 列表查询）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/harness.js','utf8');const listRoute=c.slice(c.indexOf(\"router.get('/initiative-runs',\"),c.indexOf(\"router.get('/initiative-runs/:id'\"));if(listRoute.includes('contract_id')||listRoute.includes('current_task_id')||listRoute.includes('merged_task_ids'))process.exit(1);console.log('OK')"

---

## BEHAVIOR 条目（内嵌可执行 manual:bash 命令，autonomous → curl Brain 5221）

- [ ] [BEHAVIOR] GET /api/brain/harness/initiative-runs 返回 HTTP 200，顶层 keys 精确等于 `["runs","total"]`
  Test: manual:bash -c 'RESP=$(curl -sf localhost:5221/api/brain/harness/initiative-runs 2>/dev/null) || { echo "FAIL: 端点未返回 200（路由未实现或 Brain 未启动）"; exit 1; }; echo "$RESP" | jq -e '"'"'keys == ["runs","total"]'"'"' || { echo "FAIL: 顶层 keys 不符"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] total 等于 runs 数组实际长度（schema 完整性）
  Test: manual:bash -c 'RESP=$(curl -sf localhost:5221/api/brain/harness/initiative-runs 2>/dev/null) || { echo "FAIL: 端点未返回 200"; exit 1; }; echo "$RESP" | jq -e '"'"'.total == (.runs | length)'"'"' || { echo "FAIL: total != runs 长度"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] runs 每条含全部 10 个必须字段（字段完整性正向检查）
  Test: manual:bash -c 'RESP=$(curl -sf "localhost:5221/api/brain/harness/initiative-runs?limit=1" 2>/dev/null) || { echo "FAIL: 端点未返回 200"; exit 1; }; CNT=$(echo "$RESP" | jq '"'"'.runs | length'"'"'); if [ "$CNT" -gt 0 ]; then for FIELD in id initiative_id phase journey_type journey_id created_at completed_at deadline_at failure_reason cost_usd; do echo "$RESP" | jq -e --arg f "$FIELD" '"'"'.runs[0] | has($f)'"'"' || { echo "FAIL: 缺少字段 $FIELD"; exit 1; }; done; fi; echo OK'
  期望: OK

- [ ] [BEHAVIOR] cost_usd 序列化为 number 或 null（非字符串，NUMERIC → float 类型安全）
  Test: manual:bash -c 'RESP=$(curl -sf "localhost:5221/api/brain/harness/initiative-runs?limit=1" 2>/dev/null) || { echo "FAIL: 端点未返回 200"; exit 1; }; CNT=$(echo "$RESP" | jq '"'"'.runs | length'"'"'); if [ "$CNT" -gt 0 ]; then TYPE=$(echo "$RESP" | jq '"'"'.runs[0].cost_usd | type'"'"'); [ "$TYPE" = '"'"'"number"'"'"' ] || [ "$TYPE" = '"'"'"null"'"'"' ] || { echo "FAIL: cost_usd type=$TYPE 期望 number 或 null"; exit 1; }; fi; echo OK'
  期望: OK

- [ ] [BEHAVIOR] runs 每条不含禁用字段 contract_id/current_task_id/merged_task_ids（禁用字段反向检查）
  Test: manual:bash -c 'RESP=$(curl -sf "localhost:5221/api/brain/harness/initiative-runs?limit=1" 2>/dev/null) || { echo "FAIL: 端点未返回 200"; exit 1; }; CNT=$(echo "$RESP" | jq '"'"'.runs | length'"'"'); if [ "$CNT" -gt 0 ]; then echo "$RESP" | jq -e '"'"'.runs[0] | has("contract_id") | not'"'"' || { echo "FAIL: 禁用字段 contract_id 存在"; exit 1; }; echo "$RESP" | jq -e '"'"'.runs[0] | has("current_task_id") | not'"'"' || { echo "FAIL: 禁用字段 current_task_id 存在"; exit 1; }; echo "$RESP" | jq -e '"'"'.runs[0] | has("merged_task_ids") | not'"'"' || { echo "FAIL: 禁用字段 merged_task_ids 存在"; exit 1; }; fi; echo OK'
  期望: OK

- [ ] [BEHAVIOR] limit=abc 返回 HTTP 400，error 含 "invalid limit"（非整数 limit 校验）
  Test: manual:bash -c 'CODE=$(curl -s -o /dev/null -w "%{http_code}" "localhost:5221/api/brain/harness/initiative-runs?limit=abc"); [ "$CODE" = "400" ] || { echo "FAIL: 期望 400，实际 $CODE"; exit 1; }; ERR=$(curl -s "localhost:5221/api/brain/harness/initiative-runs?limit=abc"); echo "$ERR" | jq -e '"'"'.error | test("invalid limit")'"'"' || { echo "FAIL: error 字段不含 invalid limit: $ERR"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] limit=0 和 limit=101 返回 HTTP 400（range 校验两端）
  Test: manual:bash -c 'for BAD in 0 101; do CODE=$(curl -s -o /dev/null -w "%{http_code}" "localhost:5221/api/brain/harness/initiative-runs?limit=$BAD"); [ "$CODE" = "400" ] || { echo "FAIL: limit=$BAD 期望 400，实际 $CODE"; exit 1; }; done; echo OK'
  期望: OK

- [ ] [BEHAVIOR] limit=100 返回 HTTP 200（边界合法值不被误拒）
  Test: manual:bash -c 'CODE=$(curl -s -o /dev/null -w "%{http_code}" "localhost:5221/api/brain/harness/initiative-runs?limit=100"); [ "$CODE" = "200" ] || { echo "FAIL: limit=100 期望 200，实际 $CODE"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] journey_id=not-a-uuid 返回 HTTP 400，error 精确等于 "invalid journey_id: must be a UUID"（UUID 校验 + 精确错误消息）
  Test: manual:bash -c 'CODE=$(curl -s -o /dev/null -w "%{http_code}" "localhost:5221/api/brain/harness/initiative-runs?journey_id=not-a-uuid"); [ "$CODE" = "400" ] || { echo "FAIL: 期望 400，实际 $CODE"; exit 1; }; ERR=$(curl -s "localhost:5221/api/brain/harness/initiative-runs?journey_id=not-a-uuid"); echo "$ERR" | jq -e '"'"'.error == "invalid journey_id: must be a UUID"'"'"' || { echo "FAIL: error 字段不符: $ERR"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] phase 为空字符串时返回 HTTP 200（空 phase 忽略过滤，不报错）
  Test: manual:bash -c 'CODE=$(curl -s -o /dev/null -w "%{http_code}" "localhost:5221/api/brain/harness/initiative-runs?phase="); [ "$CODE" = "200" ] || { echo "FAIL: phase= 期望 200，实际 $CODE"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] 无匹配结果时返回 HTTP 200 + runs=[] + total=0（不返回 404）
  Test: manual:bash -c 'RESP=$(curl -sf "localhost:5221/api/brain/harness/initiative-runs?phase=nonexistent_phase_xyz_99999" 2>/dev/null) || { echo "FAIL: 端点未返回 200"; exit 1; }; echo "$RESP" | jq -e '"'"'.runs == [] and .total == 0'"'"' || { echo "FAIL: 空结果不符: '"'"'$RESP'"'"'"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] phase=done 过滤时 runs 中每条记录的 phase 字段均为 "done"（精确过滤）
  Test: manual:bash -c 'RESP=$(curl -sf "localhost:5221/api/brain/harness/initiative-runs?phase=done" 2>/dev/null) || { echo "FAIL: 端点未返回 200"; exit 1; }; echo "$RESP" | jq -e '"'"'[.runs[].phase == "done"] | all'"'"' || { echo "FAIL: runs 中存在 phase != done 的记录"; exit 1; }; echo OK'
  期望: OK

---

## E2E 验收（final-e2e — target_environment = brain，curl + jq 全程链路）

**journey_type**: autonomous
**target_environment**: brain

```bash
#!/usr/bin/env bash
# final-e2e: GET /api/brain/harness/initiative-runs 端点完整验收
set -e

BASE="localhost:5221/api/brain/harness/initiative-runs"

echo "=== E2E 1: 默认请求返回 200 + keys=["runs","total"] + total==length ==="
RESP=$(curl -sf "$BASE") || { echo "FAIL E2E 1: 端点未返回 200"; exit 1; }
echo "$RESP" | jq -e 'keys == ["runs","total"]' || { echo "FAIL E2E 1a: 顶层 keys 不符"; exit 1; }
echo "$RESP" | jq -e '.runs | type == "array"' || { echo "FAIL E2E 1b: runs 不是数组"; exit 1; }
echo "$RESP" | jq -e '.total | type == "number"' || { echo "FAIL E2E 1c: total 不是 number"; exit 1; }
echo "$RESP" | jq -e '.total == (.runs | length)' || { echo "FAIL E2E 1d: total != runs 长度"; exit 1; }
echo "✅ E2E 1 通过"

echo "=== E2E 2: phase=done 过滤 — runs 每条 phase == done ==="
RESP=$(curl -sf "$BASE?phase=done") || { echo "FAIL E2E 2: 端点未返回 200"; exit 1; }
echo "$RESP" | jq -e '[.runs[].phase == "done"] | all' || { echo "FAIL E2E 2: 存在非 done phase"; exit 1; }
echo "✅ E2E 2 通过"

echo "=== E2E 3: limit=abc 返回 400 ==="
CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE?limit=abc")
[ "$CODE" = "400" ] || { echo "FAIL E2E 3: 期望 400，实际 $CODE"; exit 1; }
echo "✅ E2E 3 通过"

echo "=== E2E 4: journey_id=not-a-uuid 返回 400 + 精确错误消息 ==="
CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE?journey_id=not-a-uuid")
[ "$CODE" = "400" ] || { echo "FAIL E2E 4a: 期望 400，实际 $CODE"; exit 1; }
ERR=$(curl -s "$BASE?journey_id=not-a-uuid")
echo "$ERR" | jq -e '.error == "invalid journey_id: must be a UUID"' || { echo "FAIL E2E 4b: error 字段不符"; exit 1; }
echo "✅ E2E 4 通过"

echo "=== E2E 5: 空结果时 runs=[] total=0（不是 404）==="
RESP=$(curl -sf "$BASE?phase=nonexistent_phase_xyz") || { echo "FAIL E2E 5: 端点未返回 200"; exit 1; }
echo "$RESP" | jq -e '.runs == [] and .total == 0' || { echo "FAIL E2E 5: 空结果不符"; exit 1; }
echo "✅ E2E 5 通过"

echo "=== E2E 6: runs 字段 schema + cost_usd 类型验证 ==="
RESP=$(curl -sf "$BASE?limit=1") || { echo "FAIL E2E 6: 端点未返回 200"; exit 1; }
CNT=$(echo "$RESP" | jq '.runs | length')
if [ "$CNT" -gt 0 ]; then
  for FIELD in id initiative_id phase journey_type journey_id created_at completed_at deadline_at failure_reason cost_usd; do
    echo "$RESP" | jq -e --arg f "$FIELD" '.runs[0] | has($f)' || { echo "FAIL E2E 6: 缺少字段 $FIELD"; exit 1; }
  done
  TYPE=$(echo "$RESP" | jq '.runs[0].cost_usd | type')
  [ "$TYPE" = '"number"' ] || [ "$TYPE" = '"null"' ] || { echo "FAIL E2E 6: cost_usd type=$TYPE 非 number/null"; exit 1; }
fi
echo "✅ E2E 6 通过"

echo "✅ 所有 E2E 验收通过"
```

**通过标准**: 脚本 exit 0；所有 6 条 E2E 断言均输出 "通过"
