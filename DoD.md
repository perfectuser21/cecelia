contract_branch: cp-harness-propose-r1-79afa750-a0
sprint_dir: sprints/06261155-harness-e2e-verify-r3
workstream_index: 1

---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: Brain 只读自检端点 GET /api/brain/harness-selftest

**范围**: 新增一个零副作用、零 DB 的只读端点 `GET /api/brain/harness-selftest`，返回固定 JSON `{ok:true, service:"harness"}`，HTTP 200；不影响任何既有端点。
**大小**: S

## ARTIFACT 条目

- [x] [ARTIFACT] 新增只读路由文件，含 `harness-selftest` 路径与固定 service 标识
  Test: node -e "const fs=require('fs');const f='packages/brain/src/routes/harness-selftest.js';if(!fs.existsSync(f))process.exit(1);const c=fs.readFileSync(f,'utf8');if(!c.includes('harness-selftest')||!c.includes('harness'))process.exit(1)"

- [x] [ARTIFACT] 路由已挂载进 Brain 路由聚合（routes.js）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes.js','utf8');if(!c.toLowerCase().includes('harnessselftest')&&!c.includes('harness-selftest'))process.exit(1)"

## BEHAVIOR 条目（autonomous — 测真实 Brain localhost:5221，内嵌可执行 manual:bash）

- [x] [BEHAVIOR] 路由真注册：GET /api/brain/harness-selftest 返回 HTTP 200（404=未实现=FAIL，不接受 404-acceptable 旁路）
  Test: manual:bash -c 'CODE=$(curl -s -o /dev/null -w "%{http_code}" localhost:5221/api/brain/harness-selftest); [ "$CODE" = "200" ] || { echo "FAIL: 期望200实际$CODE"; exit 1; }; echo OK'
  期望: OK

- [x] [BEHAVIOR] 响应字段 ok === true
  Test: manual:bash -c 'curl -sf localhost:5221/api/brain/harness-selftest | jq -e ".ok == true" || { echo FAIL; exit 1; }; echo OK'
  期望: OK

- [x] [BEHAVIOR] 响应字段 service === "harness"
  Test: manual:bash -c 'curl -sf localhost:5221/api/brain/harness-selftest | jq -e ".service == \"harness\"" || { echo FAIL; exit 1; }; echo OK'
  期望: OK

- [x] [BEHAVIOR] schema 完整性：顶层 keys 恰好等于 ["ok","service"]（不暴露动态运行时状态）
  Test: manual:bash -c 'curl -sf localhost:5221/api/brain/harness-selftest | jq -e "keys == [\"ok\",\"service\"]" || { echo FAIL; exit 1; }; echo OK'
  期望: OK

- [x] [BEHAVIOR] 禁用字段反向检查：响应不含 version / timestamp / status 等动态字段
  Test: manual:bash -c 'curl -sf localhost:5221/api/brain/harness-selftest | jq -e "(has(\"version\") or has(\"timestamp\") or has(\"status\")) | not" || { echo FAIL; exit 1; }; echo OK'
  期望: OK

- [x] [BEHAVIOR] 幂等：两次连续调用响应体逐字节一致（无状态、无副作用）
  Test: manual:bash -c 'A=$(curl -sf localhost:5221/api/brain/harness-selftest); B=$(curl -sf localhost:5221/api/brain/harness-selftest); [ "$A" = "$B" ] || { echo "FAIL A=$A B=$B"; exit 1; }; echo "$A" | jq -e "has(\"ok\") and has(\"service\")" || exit 1; echo OK'
  期望: OK

- [x] [BEHAVIOR] 既有端点回归：/api/brain/health 仍返回 200 且含 status 字段（新增不破坏既有契约）
  Test: manual:bash -c 'H=$(curl -sf localhost:5221/api/brain/health) || { echo "FAIL: /health 不可达"; exit 1; }; echo "$H" | jq -e "has(\"status\")" || { echo FAIL; exit 1; }; echo OK'
  期望: OK
