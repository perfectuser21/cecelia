---
skeleton: true
journey_type: autonomous
---
# Contract DoD — Sprint: kernel 验证 3 playground `/kernel-ping`

**范围**: 仅 `playground/server.js` 新增 `GET /kernel-ping` 与 `playground/tests/kernel-ping.test.ts` 永久回归测试。
**大小**: S

## ARTIFACT 条目

- [x] [ARTIFACT] 合同测试毕业到 playground 测试目录且保留五个同名行为
  Test: node -e "const fs=require('fs');const c=fs.readFileSync('playground/tests/kernel-ping.test.ts','utf8');for(const s of ['返回 200 且响应为 {ok:true}','响应 keys 完整性严格等于 [\"ok\"]','响应不含 status、pong、result 禁用字段','连续两次 GET /kernel-ping 每次均独立返回 {ok:true}','POST /kernel-ping 不进入 GET 成功路径并返回 404'])if(!c.includes(s))process.exit(1)"

- [x] [ARTIFACT] 变更范围不越过 playground 路由、毕业测试与本 sprint 合同
  Test: bash -c 'BAD=$(git diff --name-only "$(git merge-base HEAD origin/main)"..HEAD | awk '\''! /^(playground\/server\.js|playground\/tests\/kernel-ping\.test\.ts|sprints\/kernel-verify-postrepin3\/)/'\''); [ -z "$BAD" ] || { echo "$BAD"; exit 1; }'

## BEHAVIOR 条目

- [x] [BEHAVIOR] [L2] B-01: GET /kernel-ping 返回 200 且响应为精确 `{ok:true}`
  动作: 启动真实 playground server 后，请求其自身端口的 `GET /kernel-ping`
  预期观察: 调用方收到 HTTP 200，响应 JSON 的 `ok` 为布尔值 true
  等待预算: 10s
  留证: curl 状态码与响应 JSON 输出进入 behavior_tests 前列
  Test: manual:bash -c 'set -euo pipefail; PORT=31991; NODE_ENV= PLAYGROUND_PORT=$PORT node playground/server.js >/tmp/kernel-ping-b01-$$.log 2>&1 & SPID=$!; trap '\''kill $SPID 2>/dev/null; rm -f /tmp/kernel-ping-b01-$$.log'\'' EXIT; for i in $(seq 1 10); do curl -sf --max-time 1 "http://127.0.0.1:$PORT/health" >/dev/null && break; [ "$i" = 10 ] && exit 1; sleep 1; done; RESP=$(curl -sfS --max-time 5 "http://127.0.0.1:$PORT/kernel-ping"); echo "$RESP" | jq -e '\''.ok == true'\'''

- [x] [BEHAVIOR] [L2] B-02: GET /kernel-ping 响应 keys 完整性严格等于 `["ok"]`
  动作: 对真实 playground 的 `/kernel-ping` 发起 GET 并读取完整响应体
  预期观察: 顶层只有 `ok` 一个字段，没有额外字段
  等待预算: 10s
  留证: jq keys 断言输出与 exit_code
  Test: manual:bash -c 'set -euo pipefail; PORT=31992; NODE_ENV= PLAYGROUND_PORT=$PORT node playground/server.js >/tmp/kernel-ping-b02-$$.log 2>&1 & SPID=$!; trap '\''kill $SPID 2>/dev/null; rm -f /tmp/kernel-ping-b02-$$.log'\'' EXIT; for i in $(seq 1 10); do curl -sf --max-time 1 "http://127.0.0.1:$PORT/health" >/dev/null && break; [ "$i" = 10 ] && exit 1; sleep 1; done; curl -sfS --max-time 5 "http://127.0.0.1:$PORT/kernel-ping" | jq -e '\''keys == ["ok"]'\'''

- [x] [BEHAVIOR] [L2] B-03: GET /kernel-ping 响应不含 status、pong、result 禁用字段
  动作: 请求真实 `/kernel-ping` 并逐一检查三个禁用字段
  预期观察: `status`、`pong`、`result` 均不存在，响应仍由实际服务产生
  等待预算: 10s
  留证: 每个禁用字段的 jq 反向断言与总 exit_code
  Test: manual:bash -c 'set -euo pipefail; PORT=31993; NODE_ENV= PLAYGROUND_PORT=$PORT node playground/server.js >/tmp/kernel-ping-b03-$$.log 2>&1 & SPID=$!; trap '\''kill $SPID 2>/dev/null; rm -f /tmp/kernel-ping-b03-$$.log'\'' EXIT; for i in $(seq 1 10); do curl -sf --max-time 1 "http://127.0.0.1:$PORT/health" >/dev/null && break; [ "$i" = 10 ] && exit 1; sleep 1; done; RESP=$(curl -sfS --max-time 5 "http://127.0.0.1:$PORT/kernel-ping"); echo "$RESP" | jq -e '\''.ok == true and (has("status")|not) and (has("pong")|not) and (has("result")|not)'\'''

- [x] [BEHAVIOR] [L2] B-04: 连续两次 GET /kernel-ping 每次均独立返回 `{ok:true}`
  动作: 在同一真实 playground 进程上连续发起两次 GET
  预期观察: 两次请求各自返回 HTTP 200 与精确单字段 JSON，不复用伪造结果
  等待预算: 15s
  留证: 两次 curl 的响应与 jq exit_code
  Test: manual:bash -c 'set -euo pipefail; PORT=31994; NODE_ENV= PLAYGROUND_PORT=$PORT node playground/server.js >/tmp/kernel-ping-b04-$$.log 2>&1 & SPID=$!; trap '\''kill $SPID 2>/dev/null; rm -f /tmp/kernel-ping-b04-$$.log'\'' EXIT; for i in $(seq 1 10); do curl -sf --max-time 1 "http://127.0.0.1:$PORT/health" >/dev/null && break; [ "$i" = 10 ] && exit 1; sleep 1; done; for n in 1 2; do RESP=$(curl -sfS --max-time 5 "http://127.0.0.1:$PORT/kernel-ping"); echo "$RESP" | jq -e '\''.ok == true and (keys == ["ok"])'\'' >/dev/null || exit 1; done'

- [x] [BEHAVIOR] [L2] B-05: POST /kernel-ping 不进入 GET 成功路径并返回 404
  动作: 对真实 playground 的同一路径发送 POST
  预期观察: 服务返回 HTTP 404，不把非 GET 当成功请求
  等待预算: 10s
  留证: curl 输出的 HTTP 状态码与比较 exit_code
  Test: manual:bash -c 'set -euo pipefail; PORT=31995; NODE_ENV= PLAYGROUND_PORT=$PORT node playground/server.js >/tmp/kernel-ping-b05-$$.log 2>&1 & SPID=$!; trap '\''kill $SPID 2>/dev/null; rm -f /tmp/kernel-ping-b05-$$.log'\'' EXIT; for i in $(seq 1 10); do curl -sf --max-time 1 "http://127.0.0.1:$PORT/health" >/dev/null && break; [ "$i" = 10 ] && exit 1; sleep 1; done; CODE=$(curl -sS --max-time 5 -o /dev/null -w "%{http_code}" -X POST "http://127.0.0.1:$PORT/kernel-ping"); [ "$CODE" = 404 ]'

- [x] [BEHAVIOR] [L2] INV-01: 既有 playground `/health` 与 `/ping` 回归不受影响
  动作: 运行既有 server.test.js 与 ping.test.js 的真实 Express 回归测试
  预期观察: 两个既有测试文件全部通过，新增端点不改变其响应
  等待预算: 60s
  留证: vitest verbose 输出与 exit_code
  Test: manual:bash -c 'cd playground && npx vitest run tests/server.test.js tests/ping.test.js --config vitest.config.js --reporter=verbose'

## 铁律清单 → INV 映射

| # | 映射 |
|---|---|
| 1 | N/A：judge 证据不足分流属于 Judge；本合同要求 evaluator 保存一手 exit_code。 |
| 2 | INV-02：下方 Red 命令真跑并记录非零 exit code。 |
| 3 | 已落实：Generator 硬条款要求一手证据排在前 8 条。 |
| 4 | N/A：无指标口径。 |
| 5 | N/A：不触 canonical 文件。 |
| 6 | ARTIFACT 范围守卫排除 `.harness/progress.md`。 |
| 7 | 已落实：合同 Notes 声明 local playground 的验证真相形态。 |
| 8 | N/A：不改部署预览设施。 |
| 9 | N/A：合并竞态由 controller 处理。 |
| 10 | N/A：非 headed 前台点火任务。 |
| 11 | N/A：不改 watchdog。 |
| 12 | N/A：phase-event 属 controller/relay 运行职责。 |
| 13 | N/A：PR 冲突处理属 controller。 |
| 14 | N/A：不改 capture_atoms。 |
| 15 | N/A：不改守卫/探针数据。 |
| 16 | N/A：无时间窗口探针。 |
| 17 | 已落实：E2E 用 mktemp；行为脚本临时文件含进程 ID。 |
| 18 | N/A：不触 cortex。 |
| 19 | N/A：无数据库。 |
| 20 | N/A：不触 agents 表。 |
| 21 | N/A：无 status 枚举。 |
| 22 | N/A：orphan 恢复属于 Brain。 |
| 23 | N/A：无通知/写库接口；HTTP 成功按 `.ok==true` 语义判断。 |
| 24 | N/A：不改依赖。 |
| 25 | N/A：无长 CI 等待循环。 |
| 26 | 已落实：Generator 硬条款要求毕业测试并过本地质量闸。 |
| 27 | INV-02：manual oracle 记录真实 exit code。 |
| 28 | N/A：manual node 命令无 `${}` JavaScript 模板表达式。 |
| 29 | 已落实：本 sprint 本身是 smoke，真实启动解释器。 |
| 30 | 已落实：同 29。 |
| 31 | N/A：无跨扫描状态。 |
| 32 | N/A：无付费调用。 |
| 33 | N/A：无跨模块时间常数。 |
| 34 | N/A：合同不涉及移动真机或 agent-offline。 |
| 35 | 已落实：PRD task payload 已声明 target_environment=playground。 |
| 36 | N/A：Judge 结果格式由 Evaluator/Judge 角色生成。 |
| 37 | N/A：无 DB 字段。 |
| 38 | N/A：不是复活退役功能。 |
| 39 | N/A：无返回 null/false 的函数调用。 |
| 40 | 已落实：同 29。 |
| 41 | N/A：journey_features report 巡检属 report 阶段。 |
| 42 | N/A：controller report 收账属于 Brain。 |
| 43 | N/A：无 host 或环境白名单断言。 |
| 44 | N/A：headed relay payload 由 controller 管理。 |
| 45 | N/A：无退役判断。 |
| 46 | N/A：无后台 job。 |
| 47 | N/A：无数据表。 |
| 48 | N/A：无后台 job。 |
| 49 | N/A：无重叠业务字段或多端 UI。 |
| 50 | 已落实：Generator 与终验都以精确 `{"ok":true}` 为同一语义。 |
| 51 | ARTIFACT 范围命令使用 merge-base，不用裸 rev-parse 判 ref。 |
| 52 | 已落实：真实 worktree E2E 只启 playground 子进程，不触生产资源。 |
| 53 | 已落实：所有 E2E 失败路径非零退出，无 warning 放行。 |
| 54 | N/A：无部署判变。 |
| 55 | 已落实：回归测试包含 await supertest 调用。 |
| 56 | 已落实：Test Contract 固定四列且测试路径用反引号。 |
| 57 | 已落实：Generator 硬条款要求 Red commit 精确 add 测试路径。 |
| 58 | N/A：无调度接线。 |
| 59 | N/A：无 cron。 |
| 60 | 已落实：Generator 禁自行 merge。 |
| 61 | N/A：无 tmux innerCmd 环境变量。 |
| 62 | 已落实：合同依据本次 PRD 与当前 playground 源码，不假设历史派发路径。 |
| 63 | ARTIFACT 范围守卫禁止共享 CI 文件。 |
| 64 | N/A：提前合并 SHA 核对属 controller。 |
| 65 | 已落实：同 29。 |
| 66 | N/A：不改 brain/src。 |
| 67 | N/A：无新 task_type。 |
| 68 | N/A：playground 非常驻宿主服务。 |
| 69 | N/A：不新增 LaunchAgent。 |
| 70 | N/A：不新增常驻服务。 |
| 71 | 已落实：同 29。 |
| 72 | N/A：单 slot 串行是执行纪律，本合同单 task。 |
| 73 | 已落实：无屏幕坐标、UIA 阈值或未注入 env 假设。 |
| 74 | 已落实：接缝清单为空，所有逻辑断言真启本地目标。 |
| 75 | N/A：playground 无租户。 |
| 76 | 已落实：合同无 secrets。 |
| 77 | 已落实：请求与日志无 PII。 |
| 78 | N/A（明确沙箱豁免）：playground 是非生产本地训练服务，既有端点均无鉴权；PRD 排除鉴权变更。 |
| 79 | N/A：无租户数据。 |

- [x] [BEHAVIOR] [L2] INV-02: 合同 Red oracle 在未实现基线上真实失败且目标解释器启动
  动作: 从 playground 的 vitest 配置运行 sprint 合同测试
  预期观察: 当前基线中四条 GET 成功路径因 404 失败，vitest 进程返回非零；POST 边界通过
  等待预算: 60s
  留证: `/tmp/kernel-ping-red.log` 的 Test Files/Tests 摘要与 shell exit_code
  Test: manual:bash -c 'set -uo pipefail; TMP_TEST=playground/tests/kernel-ping.contract-red.test.ts; LOG=$(mktemp "${TMPDIR:-/tmp}/kernel-ping-red.XXXXXX"); cp sprints/kernel-verify-postrepin3/tests/kernel-ping.test.ts "$TMP_TEST"; trap '\''rm -f "$TMP_TEST" "$LOG"'\'' EXIT; set +e; (cd playground && npx vitest run tests/kernel-ping.contract-red.test.ts --config vitest.config.js --reporter=verbose) >"$LOG" 2>&1; RC=$?; set -e; grep -E "4 failed.*1 passed|Tests +4 failed.*1 passed" "$LOG" >/dev/null; [ "$RC" -ne 0 ]'
