---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: GET /api/brain/harness/healthz 端点

**范围**: `packages/brain/src/routes/harness.js` 新增 `GET /healthz` 路由，返回 `{"ok":true,"service":"harness","ts":"<ISO>"}`
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] `packages/brain/src/routes/harness.js` 包含 `/healthz` 路由 handler
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/harness.js','utf8');if(!c.includes('/healthz'))process.exit(1);console.log('OK')"

- [ ] [ARTIFACT] 测试文件存在（`packages/brain/src/routes/__tests__/harness.healthz.test.js` 或同级目录）
  Test: node -e "const paths=['packages/brain/src/routes/__tests__/harness.healthz.test.js','packages/brain/tests/routes/harness-healthz.test.js'];let ok=false;for(const p of paths){try{require('fs').accessSync(p);ok=true;break}catch(e){}}if(!ok)process.exit(1);console.log('OK')"

## BEHAVIOR 条目

- [ ] [BEHAVIOR] GET /api/brain/harness/healthz 返回 HTTP 200
  Test: manual:bash -c 'CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:5221/api/brain/harness/healthz); [ "$CODE" = "200" ] || { echo "FAIL: HTTP $CODE"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] 响应体 ok 字段为布尔 true
  Test: manual:bash -c 'RESP=$(curl -sf http://localhost:5221/api/brain/harness/healthz) || { echo "FAIL: curl 失败"; exit 1; }; echo "$RESP" | jq -e ".ok == true" || { echo "FAIL: ok 不为 true"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] 响应体 service 字段为字面量 "harness"
  Test: manual:bash -c 'RESP=$(curl -sf http://localhost:5221/api/brain/harness/healthz) || exit 1; echo "$RESP" | jq -e ".service == \"harness\"" || { echo "FAIL: service 不为 harness"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] 响应体 ts 字段为有效 ISO8601 string
  Test: manual:bash -c 'RESP=$(curl -sf http://localhost:5221/api/brain/harness/healthz) || exit 1; echo "$RESP" | jq -e ".ts | type == \"string\"" || { echo "FAIL: ts 不是 string"; exit 1; }; TS=$(echo "$RESP" | jq -r ".ts"); node -e "const d=new Date(process.argv[1]);if(isNaN(d.getTime()))process.exit(1)" "$TS" || { echo "FAIL: ts 不是有效 ISO8601"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] 响应体 keys 完整性 — 严格等于 ["ok","service","ts"]
  Test: manual:bash -c 'RESP=$(curl -sf http://localhost:5221/api/brain/harness/healthz) || exit 1; echo "$RESP" | jq -e "keys == [\"ok\",\"service\",\"ts\"]" || { echo "FAIL: keys 不等于 [ok,service,ts]"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] 禁用字段 status/healthy/name/timestamp 均不存在
  Test: manual:bash -c 'RESP=$(curl -sf http://localhost:5221/api/brain/harness/healthz) || exit 1; for f in status healthy name timestamp; do echo "$RESP" | jq -e "has(\"$f\") | not" || { echo "FAIL: 禁用字段 $f 存在"; exit 1; }; done; echo OK'
  期望: OK

- [ ] [BEHAVIOR] error path — 路由未注册时 curl -sf 返回非零退出码（防 Brain 通用 404 假绿）
  Test: manual:bash -c 'RESP=$(curl -sf http://localhost:5221/api/brain/harness/healthz) || { echo "FAIL: 端点不可达（路由未注册或 Brain 未运行）"; exit 1; }; echo OK'
  期望: OK（此条在 generator 实现前 FAIL 即 Red 证据；实现后 PASS）

## Risks

| 风险 | Mitigation |
|---|---|
| Brain 未启动时 connection refused，与路由未注册 404 表现不同 | final-e2e 首先验证 /ping 存活；BEHAVIOR curl -sf 失败则报告 Brain 未运行 |
