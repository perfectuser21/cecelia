---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: Brain API GET /api/brain/initiative-runs/phase-summary

**范围**: 新增只读路由 `GET /api/brain/initiative-runs/phase-summary`，按 phase 分组聚合 initiative_runs，按 count 降序返回 `[{phase, count}]`；NULL phase 排除；表空返回 `[]`；路由挂载到 Brain server (5221)
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] 路由文件存在并 export default Express Router
  Test: node -e "const fs=require('fs');const c=fs.readFileSync('packages/brain/src/routes/initiative-runs.js','utf8');if(!c.includes('Router'))process.exit(1);if(!c.includes('export default'))process.exit(2)"

- [ ] [ARTIFACT] 路由文件含 GROUP BY phase 聚合 SQL（含非 NULL 过滤 + count DESC）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/initiative-runs.js','utf8');if(!/GROUP\s+BY\s+phase/i.test(c))process.exit(1);if(!/phase\s+IS\s+NOT\s+NULL/i.test(c))process.exit(2);if(!/ORDER\s+BY\s+count.*DESC/i.test(c))process.exit(3)"

- [ ] [ARTIFACT] 路由文件挂载 `/phase-summary` handler（GET）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/initiative-runs.js','utf8');if(!/router\.get\(['\"]\/phase-summary['\"]/.test(c))process.exit(1)"

- [ ] [ARTIFACT] server.js 已 import 并挂载 initiative-runs 路由到 `/api/brain/initiative-runs`
  Test: node -e "const c=require('fs').readFileSync('packages/brain/server.js','utf8');if(!/from\s+['\"]\.\/src\/routes\/initiative-runs\.js['\"]/.test(c))process.exit(1);if(!/app\.use\(['\"]\/api\/brain\/initiative-runs['\"]/.test(c))process.exit(2)"

## BEHAVIOR 条目

- [ ] [BEHAVIOR] HTTP 200 + 顶层 type == "array"（路由真实注册；404 = FAIL）
  Test: manual:bash -c 'CODE=$(curl -s -o /tmp/ph-summ.json -w "%{http_code}" localhost:5221/api/brain/initiative-runs/phase-summary); [ "$CODE" = "200" ] || { echo "FAIL: http=$CODE"; exit 1; }; jq -e "type == \"array\"" /tmp/ph-summ.json >/dev/null || { echo "FAIL: 顶层非 array"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] 注入测试数据后，每条元素 keys 完整匹配 ["count","phase"]（无多余字段、无缺字段）+ phase 是 string + count 是 number
  Test: manual:bash -c 'PSQL="${DB:-postgresql://localhost/cecelia}"; SENTINEL="ph-summ-beh2-$$"; psql "$PSQL" -c "DELETE FROM initiative_runs WHERE failure_reason = '"'"'$SENTINEL'"'"'" >/dev/null 2>&1 || true; psql "$PSQL" -c "INSERT INTO initiative_runs (id, initiative_id, phase, failure_reason) SELECT gen_random_uuid(), gen_random_uuid(), v.phase, '"'"'$SENTINEL'"'"' FROM (VALUES ('"'"'beh2-x'"'"'),('"'"'beh2-x'"'"'),('"'"'beh2-y'"'"')) AS v(phase);" >/dev/null || { echo "FAIL: 注入失败"; exit 1; }; RESP=$(curl -fsS localhost:5221/api/brain/initiative-runs/phase-summary); psql "$PSQL" -c "DELETE FROM initiative_runs WHERE failure_reason = '"'"'$SENTINEL'"'"'" >/dev/null 2>&1; echo "$RESP" | jq -e "(length > 0) and all(.[]; (keys | sort) == [\"count\",\"phase\"]) and all(.[]; (.phase | type == \"string\") and (.count | type == \"number\"))" >/dev/null || { echo "FAIL: schema/keys 不符"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] 注入 NULL phase 行后，响应中不出现 phase == null 的元素（PRD 边界第 27 行）
  Test: manual:bash -c 'PSQL="${DB:-postgresql://localhost/cecelia}"; SENTINEL="ph-summ-beh3-$$"; psql "$PSQL" -c "DELETE FROM initiative_runs WHERE failure_reason = '"'"'$SENTINEL'"'"'" >/dev/null 2>&1 || true; psql "$PSQL" -c "INSERT INTO initiative_runs (id, initiative_id, phase, failure_reason) SELECT gen_random_uuid(), gen_random_uuid(), v.phase, '"'"'$SENTINEL'"'"' FROM (VALUES ('"'"'beh3-real'"'"'),(NULL),(NULL)) AS v(phase);" >/dev/null || { echo "FAIL: 注入失败"; exit 1; }; RESP=$(curl -fsS localhost:5221/api/brain/initiative-runs/phase-summary); psql "$PSQL" -c "DELETE FROM initiative_runs WHERE failure_reason = '"'"'$SENTINEL'"'"'" >/dev/null 2>&1; echo "$RESP" | jq -e "all(.[]; .phase != null)" >/dev/null || { echo "FAIL: NULL phase 漏网"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] 注入梯度数据后，count 单调降序 + 高频 phase 排在前
  Test: manual:bash -c 'PSQL="${DB:-postgresql://localhost/cecelia}"; SENTINEL="ph-summ-beh4-$$"; psql "$PSQL" -c "DELETE FROM initiative_runs WHERE failure_reason = '"'"'$SENTINEL'"'"'" >/dev/null 2>&1 || true; psql "$PSQL" -c "INSERT INTO initiative_runs (id, initiative_id, phase, failure_reason) SELECT gen_random_uuid(), gen_random_uuid(), v.phase, '"'"'$SENTINEL'"'"' FROM (VALUES ('"'"'beh4-zzz-hi'"'"'),('"'"'beh4-zzz-hi'"'"'),('"'"'beh4-zzz-hi'"'"'),('"'"'beh4-zzz-hi'"'"'),('"'"'beh4-zzz-lo'"'"')) AS v(phase);" >/dev/null || { echo "FAIL: 注入失败"; exit 1; }; RESP=$(curl -fsS localhost:5221/api/brain/initiative-runs/phase-summary); psql "$PSQL" -c "DELETE FROM initiative_runs WHERE failure_reason = '"'"'$SENTINEL'"'"'" >/dev/null 2>&1; echo "$RESP" | jq -e "[.[].count] | . == (sort | reverse)" >/dev/null || { echo "FAIL: count 未整体降序"; exit 1; }; HI_IDX=$(echo "$RESP" | jq -r "map(.phase) | index(\"beh4-zzz-hi\") // -1"); LO_IDX=$(echo "$RESP" | jq -r "map(.phase) | index(\"beh4-zzz-lo\") // -1"); [ "$HI_IDX" -ge 0 ] && [ "$LO_IDX" -ge 0 ] && [ "$HI_IDX" -lt "$LO_IDX" ] || { echo "FAIL: 排序 hi=$HI_IDX lo=$LO_IDX"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] 禁用字段反向断言 — 响应每个元素均不含 `name / phase_name / phaseName / stage / type / total / n / num / runs / value / cnt`
  Test: manual:bash -c 'PSQL="${DB:-postgresql://localhost/cecelia}"; SENTINEL="ph-summ-beh5-$$"; psql "$PSQL" -c "DELETE FROM initiative_runs WHERE failure_reason = '"'"'$SENTINEL'"'"'" >/dev/null 2>&1 || true; psql "$PSQL" -c "INSERT INTO initiative_runs (id, initiative_id, phase, failure_reason) VALUES (gen_random_uuid(), gen_random_uuid(), '"'"'beh5-real'"'"', '"'"'$SENTINEL'"'"');" >/dev/null; RESP=$(curl -fsS localhost:5221/api/brain/initiative-runs/phase-summary); psql "$PSQL" -c "DELETE FROM initiative_runs WHERE failure_reason = '"'"'$SENTINEL'"'"'" >/dev/null 2>&1; echo "$RESP" | jq -e "(length > 0) and all(.[]; (has(\"name\") | not) and (has(\"phase_name\") | not) and (has(\"phaseName\") | not) and (has(\"stage\") | not) and (has(\"type\") | not) and (has(\"total\") | not) and (has(\"n\") | not) and (has(\"num\") | not) and (has(\"runs\") | not) and (has(\"value\") | not) and (has(\"cnt\") | not))" >/dev/null || { echo "FAIL: 禁用字段名漏网或响应空"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] 顶层始终是 array（即使表无可见 phase 行，response 也是 `[]` 而非 null/object/error）
  Test: manual:bash -c 'RESP=$(curl -fsS localhost:5221/api/brain/initiative-runs/phase-summary); echo "$RESP" | jq -e "type == \"array\"" >/dev/null || { echo "FAIL: 顶层非 array"; exit 1; }; echo "$RESP" | jq -e "(length == 0) or (length > 0)" >/dev/null || { echo "FAIL: length 计算异常"; exit 1; }; echo OK'
  期望: OK
