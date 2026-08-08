---
skeleton: false
journey_type: autonomous
target_environment: playground
---
# Contract DoD — Sprint: playground GET /kernel-ping 返回ok

**范围**: 仅新增 playground `GET /kernel-ping` 的无状态纯文本响应及永久回归测试。
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] `playground/server.js` 含 `/kernel-ping` GET 路由，且不修改 Brain/Dashboard/Harness 文件
  Test: node -e "const fs=require('fs');const c=fs.readFileSync('playground/server.js','utf8');if(!c.includes(\"app.get('/kernel-ping'\"))process.exit(1)"

- [ ] [ARTIFACT] 永久回归测试位于 `playground/tests/kernel-ping.test.js` 且 Test Contract 四个覆盖名均为测试名子串
  Test: node -e "const fs=require('fs');const c=fs.readFileSync('playground/tests/kernel-ping.test.js','utf8');for(const s of ['GET /kernel-ping 返回 200','响应体严格等于 ok','连续两次调用稳定返回 ok','POST 保持 404 且既有 /ping 不回退'])if(!c.includes(s))process.exit(1)"

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L2] B-01: GET `/kernel-ping` 请求成功结束 [接缝×2]
  动作: 启动真实 playground Node 服务并向 `/kernel-ping` 发起 GET
  预期观察: HTTP status 严格等于 200
  等待预算: 5s
  留证: curl 的 status code 与 `/tmp/kernel-ping-b01.log`
  Test: manual:bash -c 'set -euo pipefail; P=31991; PLAYGROUND_PORT=$P node playground/server.js >/tmp/kernel-ping-b01.log 2>&1 & PID=$!; cleanup(){ STATUS=$?; trap - EXIT; kill "$PID" 2>/dev/null || :; wait "$PID" 2>/dev/null || :; exit "$STATUS"; }; trap cleanup EXIT; D=$((SECONDS+5)); until curl -sf "http://127.0.0.1:$P/health" >/dev/null; do [ "$SECONDS" -lt "$D" ] || exit 1; sleep 1; done; CODE=$(curl -sS -o /tmp/kernel-ping-b01.body -w "%{http_code}" "http://127.0.0.1:$P/kernel-ping"); [ "$CODE" = 200 ]'

- [ ] [BEHAVIOR] [L2] B-02: 调用方观察到精确 `ok` body [接缝×2]
  动作: 启动真实 playground 并下载 `/kernel-ping` 响应体
  预期观察: body 仅有 `ok` 两个字节，无 JSON 包装、空白或换行
  等待预算: 5s
  留证: `/tmp/kernel-ping-b02.body` 的 `od -An -tx1` 输出
  Test: manual:bash -c 'set -euo pipefail; P=31992; PLAYGROUND_PORT=$P node playground/server.js >/tmp/kernel-ping-b02.log 2>&1 & PID=$!; cleanup(){ STATUS=$?; trap - EXIT; kill "$PID" 2>/dev/null || :; wait "$PID" 2>/dev/null || :; exit "$STATUS"; }; trap cleanup EXIT; D=$((SECONDS+5)); until curl -sf "http://127.0.0.1:$P/health" >/dev/null; do [ "$SECONDS" -lt "$D" ] || exit 1; sleep 1; done; printf ok >/tmp/kernel-ping-b02.expected; curl -sf "http://127.0.0.1:$P/kernel-ping" -o /tmp/kernel-ping-b02.body; cmp -s /tmp/kernel-ping-b02.expected /tmp/kernel-ping-b02.body'

- [ ] [BEHAVIOR] [L2] B-03: 连续两次调用稳定返回 `ok` [接缝×2]
  动作: 在同一真实服务进程上连续执行两次 GET `/kernel-ping`
  预期观察: 两次请求均成功，两个 body 都严格为 `ok` 且彼此一致
  等待预算: 5s
  留证: 两次 curl 响应与 cmp exit code
  Test: manual:bash -c 'set -euo pipefail; P=31993; PLAYGROUND_PORT=$P node playground/server.js >/tmp/kernel-ping-b03.log 2>&1 & PID=$!; cleanup(){ STATUS=$?; trap - EXIT; kill "$PID" 2>/dev/null || :; wait "$PID" 2>/dev/null || :; exit "$STATUS"; }; trap cleanup EXIT; D=$((SECONDS+5)); until curl -sf "http://127.0.0.1:$P/health" >/dev/null; do [ "$SECONDS" -lt "$D" ] || exit 1; sleep 1; done; A=$(curl -sf "http://127.0.0.1:$P/kernel-ping"); B=$(curl -sf "http://127.0.0.1:$P/kernel-ping"); [ "$A" = ok ] && [ "$B" = ok ] && [ "$A" = "$B" ]'

- [ ] [BEHAVIOR] [L2] B-04: 非 GET 边界与既有 `/ping` 保持不变 [接缝×2]
  动作: 对真实服务执行 POST `/kernel-ping`，随后 GET `/ping`
  预期观察: POST 仍为 404，既有 `/ping` 仍严格返回 `{"pong":true}`
  等待预算: 5s
  留证: POST status 与 `/ping` 的 jq 输出
  Test: manual:bash -c 'set -euo pipefail; P=31994; PLAYGROUND_PORT=$P node playground/server.js >/tmp/kernel-ping-b04.log 2>&1 & PID=$!; cleanup(){ STATUS=$?; trap - EXIT; kill "$PID" 2>/dev/null || :; wait "$PID" 2>/dev/null || :; exit "$STATUS"; }; trap cleanup EXIT; D=$((SECONDS+5)); until curl -sf "http://127.0.0.1:$P/health" >/dev/null; do [ "$SECONDS" -lt "$D" ] || exit 1; sleep 1; done; CODE=$(curl -sS -o /dev/null -w "%{http_code}" -X POST "http://127.0.0.1:$P/kernel-ping"); [ "$CODE" = 404 ]; curl -sf "http://127.0.0.1:$P/ping" | jq -e '\''keys == ["pong"] and .pong == true'\'''

## Invariant 映射

- INV-1 合同验证命令实跑并记录真实 exit code；Red 命令不使用会排除 sprint 路径的 playground Vitest include 配置。
- INV-2 Judge 一手证据必须把 Red→Green、manual oracle exit_code 与 log_tail 排在 behavior evidence 前列；这是 evaluator/judge 证据要求，不改产品代码。
- INV-3 manual oracle 真正启动 `node playground/server.js` 并 curl listener；不以 `bash -n` 或源码 grep 冒充行为。
- INV-4 不追改 Brain、调度、DB、部署、真机、租户、凭据、通知、第三方或 UI 铁律所覆盖模块；这些 controller 铁律逐项对本 playground 无状态纯文本路由均为 N/A。
- INV-5 既有 `/health` 与 `/ping` 回归必须保绿；B-04 明确机检 `/ping`，完整 playground suite 负责其余既有路由。
- INV-6 不追踪 `.harness/progress.md`，不创建生产资源，不输出 secret/PII，不写 DB，不调用外部服务。
- INV-7 新端点无 404-acceptable 成功旁路：B-01/B-02/B-03 对未注册路由必定失败；仅 B-04 对 PRD 明确的非 GET 边界要求 404。
- INV-8 该 playground 训练端点按 PRD 范围不接生产身份/租户；“每个 API 端点必须 auth”对隔离 playground 既有开发冒烟面显式 N/A，不得据此扩张为生产认证功能。
