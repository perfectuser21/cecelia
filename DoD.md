contract_branch: cp-harness-propose-r4-0e15fa0d-r8374ab73-a25
sprint_dir: sprints/kernel-final-codex2

---
skeleton: true
journey_type: autonomous
target_environment: playground
---
# Contract DoD — Sprint: kernel-ping2

**范围**: 仅 playground GET `/kernel-ping2` 与永久回归测试
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] `playground/server.js` 注册 GET `/kernel-ping2`，且 `playground/tests/server.test.js` 永久包含对应回归用例。
  Test: node -e "const fs=require('fs');const s=fs.readFileSync('playground/server.js','utf8');const t=fs.readFileSync('playground/tests/server.test.js','utf8');if(!s.includes(\"app.get('/kernel-ping2'\")||!t.includes('GET /kernel-ping2'))process.exit(1)"

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L2] B-01: GET `/kernel-ping2` 返回严格 200 与 `ok2`
  动作: 启动真实 playground 后请求 GET `/kernel-ping2`
  预期观察: HTTP 200 且 JSON `result` 字面等于 `ok2`
  等待预算: 10s
  留证: curl 响应正文与 jq exit code
  Test: manual:bash -c 'PORT=43128; PLAYGROUND_PORT=$PORT NODE_ENV=production node playground/server.js >/tmp/kernel-ping2-b01.log 2>&1 & PID=$!; trap "kill $PID 2>/dev/null || true; rm -f /tmp/kernel-ping2-b01.log" EXIT; for i in $(seq 1 20); do curl -sf http://127.0.0.1:$PORT/health >/dev/null && break; [ "$i" = 20 ] && exit 1; sleep 0.5; done; curl -sf http://127.0.0.1:$PORT/kernel-ping2 | jq -e ".result == \"ok2\""'

- [ ] [BEHAVIOR] [L2] B-02: 成功响应仅含 `result` 字段
  动作: 请求真实 GET `/kernel-ping2` 并枚举响应顶层 keys
  预期观察: 顶层 keys 严格等于 `["result"]`
  等待预算: 10s
  留证: jq keys 输出与 exit code
  Test: manual:bash -c 'PORT=43129; PLAYGROUND_PORT=$PORT NODE_ENV=production node playground/server.js >/tmp/kernel-ping2-b02.log 2>&1 & PID=$!; trap "kill $PID 2>/dev/null || true; rm -f /tmp/kernel-ping2-b02.log" EXIT; for i in $(seq 1 20); do curl -sf http://127.0.0.1:$PORT/health >/dev/null && break; [ "$i" = 20 ] && exit 1; sleep 0.5; done; curl -sf http://127.0.0.1:$PORT/kernel-ping2 | jq -e "keys == [\"result\"] and (has(\"ok\")|not) and (has(\"pong\")|not) and (has(\"message\")|not) and (has(\"data\")|not)"'

- [ ] [BEHAVIOR] [L2] B-03: 非 GET 方法不冒充成功
  动作: 对真实 `/kernel-ping2` 发 POST 请求
  预期观察: HTTP 状态码不在 200-299
  等待预算: 10s
  留证: curl 输出的 HTTP 状态码
  Test: manual:bash -c 'PORT=43130; PLAYGROUND_PORT=$PORT NODE_ENV=production node playground/server.js >/tmp/kernel-ping2-b03.log 2>&1 & PID=$!; trap "kill $PID 2>/dev/null || true; rm -f /tmp/kernel-ping2-b03.log" EXIT; for i in $(seq 1 20); do curl -sf http://127.0.0.1:$PORT/health >/dev/null && break; [ "$i" = 20 ] && exit 1; sleep 0.5; done; CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST http://127.0.0.1:$PORT/kernel-ping2); case "$CODE" in 2*) exit 1;; *) echo "$CODE";; esac'

- [ ] [BEHAVIOR] [L2] B-04: 既有 health 端点不回退
  动作: 同一真实进程中请求既有 GET `/health`
  预期观察: HTTP 200 且响应严格为 `{"ok":true}`
  等待预算: 10s
  留证: health 响应正文与 jq exit code
  Test: manual:bash -c 'PORT=43131; PLAYGROUND_PORT=$PORT NODE_ENV=production node playground/server.js >/tmp/kernel-ping2-b04.log 2>&1 & PID=$!; trap "kill $PID 2>/dev/null || true; rm -f /tmp/kernel-ping2-b04.log" EXIT; for i in $(seq 1 20); do RESP=$(curl -sf http://127.0.0.1:$PORT/health 2>/dev/null) && break; [ "$i" = 20 ] && exit 1; sleep 0.5; done; echo "$RESP" | jq -e ".ok == true and (keys == [\"ok\"])"'

## Invariant 映射

- INV-1（适用）合同 manual oracle 必须真跑并记录 exit code；Red 使用 `NODE_ENV=test node -e "require.extensions['.ts']=require.extensions['.js'];require('./sprints/kernel-final-codex2/tests/kernel-ping2.test.ts')"`。本轮实跑 exit code=1，Node v20.20.2 内置 `node:test` 成功执行 4 条测试，具体在 `kernel-ping2.test.ts:9` 因 HTTP 404≠200、在第 15 行因 keys `[]`≠`[result]` 失败；TAP 终态为 tests=4、pass=2、fail=2。该命令不加载 Vitest/Vite/Rollup，依赖可选包缺失无法遮蔽业务断言 Red。
- INV-2（适用）既有 playground 行为不得回退，由 B-04 与完整 playground test suite 覆盖。
- INV-3（适用）凭据安全、日志脱敏：实现无凭据/PII，测试日志仅含固定 smoke 响应。
- INV-4（显式 N/A）PRD 其余 area 铁律涉及 Judge 证据窗、DB、租户、调度、生产部署、真机、第三方、后台任务或多设备；本纯 playground 无状态 GET 切片不触及这些模块。

