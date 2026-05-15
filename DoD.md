contract_branch: cp-harness-propose-r4-02d04eb5
workstream_index: 1
sprint_dir: sprints/w43-walking-skeleton-real-autonomous

---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Workstream 1: /ping 路由 + 生产单元测试

**范围**:
- `packages/brain/src/routes/status.js` 新增 `GET /ping`（返 `{pong:true,ts:<unix>}`）+ `ALL /ping`（405，error: "Method Not Allowed"）
- `packages/brain/src/__tests__/ping.test.js` 新建生产单元测试（Generator 产出物，实现后创建）

**大小**: S（路由 ~25 行 + 测试 ~80 行，合计 ~105 行）
**依赖**: 无

---

## ARTIFACT 条目

- [x] [ARTIFACT] `packages/brain/src/routes/status.js` 含 `router.get('/ping'` 路由
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/status.js','utf8');if(!c.includes(\"router.get('/ping'\"))process.exit(1)"

- [x] [ARTIFACT] `packages/brain/src/routes/status.js` 含 `router.all('/ping'` 路由（405 处理）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/status.js','utf8');if(!c.includes(\"router.all('/ping'\"))process.exit(1)"

- [x] [ARTIFACT] `packages/brain/src/__tests__/ping.test.js` 生产单元测试文件存在（Generator 产出物）
  Test: node -e "require('fs').accessSync('packages/brain/src/__tests__/ping.test.js')"

---

## BEHAVIOR 条目（内嵌可执行 manual:bash 命令，每步显式 || exit 1，Evaluator 直接执行）

- [x] [BEHAVIOR] GET /api/brain/ping 返 HTTP 200 且 pong 字段值严格等于 true（boolean，非字符串 "true"）
  Test: manual:bash -c 'curl -fs localhost:5221/api/brain/ping -o /tmp/pingr.json || exit 1; jq -e ".pong == true" /tmp/pingr.json || exit 1'
  期望: exit 0

- [x] [BEHAVIOR] GET /api/brain/ping ts 字段是 number 类型且在 Unix seconds 合法范围（1e9 < ts < 1e10，非毫秒非字符串）
  Test: manual:bash -c 'curl -fs localhost:5221/api/brain/ping -o /tmp/pingr.json || exit 1; jq -e "(.ts | type) == \"number\" and .ts > 1000000000 and .ts < 10000000000" /tmp/pingr.json || exit 1'
  期望: exit 0

- [x] [BEHAVIOR] GET /api/brain/ping response 顶层 keys 严格等于 ["pong","ts"]（schema 完整性，禁止多 key 禁止少 key）
  Test: manual:bash -c 'curl -fs localhost:5221/api/brain/ping -o /tmp/pingr.json || exit 1; jq -e "keys == [\"pong\",\"ts\"]" /tmp/pingr.json || exit 1'
  期望: exit 0

- [x] [BEHAVIOR] GET /api/brain/ping 禁用字段 ok/alive/status/timestamp/result/data 全部不存在（generator 漂移检查）
  Test: manual:bash -c 'curl -fs localhost:5221/api/brain/ping -o /tmp/pingr.json || exit 1; jq -e "(has(\"ok\") | not) and (has(\"alive\") | not) and (has(\"status\") | not) and (has(\"timestamp\") | not) and (has(\"result\") | not) and (has(\"data\") | not)" /tmp/pingr.json || exit 1'
  期望: exit 0

- [x] [BEHAVIOR] POST /api/brain/ping → HTTP 405 且 error 字段字面值严格等于 "Method Not Allowed"
  Test: manual:bash -c 'CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST localhost:5221/api/brain/ping); [ "$CODE" = "405" ] || exit 1; curl -s -X POST localhost:5221/api/brain/ping | jq -e ".error == \"Method Not Allowed\"" || exit 1'
  期望: exit 0

- [x] [BEHAVIOR] GET /api/brain/ping-extended 不受 /ping 路由影响，仍返 HTTP 200（路由独立性）
  Test: manual:bash -c 'CODE=$(curl -s -o /dev/null -w "%{http_code}" localhost:5221/api/brain/ping-extended); [ "$CODE" = "200" ] || exit 1'
  期望: exit 0
