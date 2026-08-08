# Sprint Contract Draft (Round 1)

Sprint: kernel 验证 3——repin 后 Codex 全链 playground `/kernel-ping`

## Response Schema（推导来源: PRD字面 + playground 既有 `/health` 契约）

### Endpoint: GET /kernel-ping

**Success (HTTP 200)**:

```json
{"ok": true}
```

- `ok` (boolean, 必填，字面值 `true`): PRD 锁定调用方观察到 `ok`；现有 `GET /health` 以 `{"ok":true}` 表达成功，因此采用相同的 playground 单字段 JSON 契约。
- Schema 完整性：顶层 keys 必须严格等于 `["ok"]`。
- 禁用字段名：`status`、`pong`、`result`，避免把 `/health` 的值语义改成状态字符串、把 `/ping` 的 `pong` 搬入或增加未承诺结果字段。

**Error (非 GET 方法)**：非 `GET` 方法不注册 `/kernel-ping` 路由，返回 Express 默认 HTTP 404；该边界不承诺 JSON body。

## 已知约束（来自回归测试）

- [playground/tests/server.test.js] → `GET /health → 200 {ok: true}`，确定 playground 成功布尔字段的既有风格。
- [playground/tests/ping.test.js] → `GET /ping → 200 + {pong: true}`、keys 完整性与禁用字段反向验证，要求新端点不得回退既有 `/ping`。
- [累积FR] 本 line 暂无历史。
- context-manifest: unavailable（端点返回 404 HTML）。

## 铁律清单加载说明

PRD 注入的 79 条铁律逐条映射在 `contract-dod.md` 的「铁律清单 → INV 映射」段；本 sprint 可执行的范围、真跑、凭据与无回退约束落实为 INV 条目，其余按不触及的模块或下游角色职责显式标记 N/A。

## 八要素需求规范

| 要素 | 说明 | 本次答案（必填，可 N/A） |
|------|------|--------------------------|
| **FR（做什么）** | 功能需求 | playground 的 `GET /kernel-ping` 返回 HTTP 200 与精确 JSON `{"ok":true}`；连续请求均独立成功；非 GET 不进入成功路径 |
| **NFR（做得多好）** | 性能/可靠性 | PRD 未指定延迟阈值；验收只要求服务 10 秒内就绪、单次 curl 在 5 秒内完成，重复两次结果一致 |
| **Invariant（永不违反）** | 安全/一致性 | 不改 Brain、鉴权、持久化、UI、生产部署、其他 playground 端点或依赖；响应仅含 `ok:true` |
| **判定点（怎么知道）** | 模糊现实判断 | 本任务无接缝判定点，见登记表 |
| **保质期（何时过期）** | 能力退役 | playground 沙箱端点随 playground 生命周期存续；无 token、缓存或业务数据保质期 |
| **死亡告警（停了谁知道）** | 失效感知 | playground 非常驻生产服务；永久回归测试与 evaluator E2E 首次执行即以非零退出暴露失效 |
| **失败语义（挂了怎么办）** | 拦截/重试/降级 | 任一启动、HTTP、schema、重复请求或回归断言失败均拦截，不降级为 Brain 健康检查 |
| **效果确认（已发≠已生效）** | 真效果回执 | 调用方直接收到 HTTP 200 和精确响应体；无异步副作用 |

### 判定点登记表（对模糊现实的判断假设）

（本任务无接缝判定点，N/A：本地 Express 同步 HTTP 响应可直接机械判定。）

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| playground 10 秒内未就绪 | E2E exit 非 0 并拦截 | 是，服务无状态 | 无；禁止改验 Brain API |
| GET 返回非 200 或 body 不等于 `{"ok":true}` | 断言 exit 非 0 | 是，GET 无副作用 | 无 |
| 第二次 GET 与第一次不一致 | 断言 exit 非 0 | 是 | 无 |
| POST 命中成功路径 | 断言 exit 非 0 | 是 | 无 |

### 输入对抗面（对外暴露 agent 必填）

N/A——该端点只属于本地 playground 沙箱，不对外暴露 agent，不接收业务数据或 prompt。

## 接缝清单（接缝断言 vs 逻辑断言）

本 sprint 不碰真机、生产环境、第三方 API、DB 或异步系统，接缝清单为空；所有验收均为本地真实 Express 进程上的逻辑断言，绿即可 done。

## 真实调用方请求 shape

调用方请求为无鉴权、无 body、无 query 的 `GET /kernel-ping`，`Accept: application/json`；这是 playground 沙箱调用 shape，不存在设备或 agent 生产调用方分叉。

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A：测试使用真实 Express app，E2E 启动真实 playground 进程并发真实 HTTP 请求。）

## 禁 mock 边清单

- 回归测试/E2E ↔ playground Express app（本单新增路由，禁止 mock `app`、Express 路由或 HTTP 响应；测试用 supertest 真调 app，E2E 真启进程）。

## Golden Path

独立小路（无父路）

[启动 playground] → [调用方 GET /kernel-ping] → [服务返回 HTTP 200] → [调用方观察精确 JSON {"ok":true}] → [重复请求仍得到相同结果]

### Step 1: playground 服务进入可接收请求状态

**来源**: `[FROM_PRD]` — PRD「Golden Path（核心场景）」步骤 1 与边界情况“未启动或端口不可达时验收必须失败”。

**可观测行为**: 本 sprint 独立 playground 进程在 10 秒预算内通过自身 `/health` 就绪检查；检查仅用于等待进程就绪，不作为 `/kernel-ping` 成功证据。

**验证命令**:

```bash
bash -c 'set -euo pipefail; PORT=${PLAYGROUND_PORT:-31983}; NODE_ENV= PLAYGROUND_PORT=$PORT node playground/server.js >/tmp/kernel-ping-server-$$.log 2>&1 & SPID=$!; trap '\''kill $SPID 2>/dev/null; rm -f /tmp/kernel-ping-server-$$.log'\'' EXIT; for i in $(seq 1 10); do curl -sf --max-time 1 "http://127.0.0.1:$PORT/health" | jq -e '\''.ok==true'\'' >/dev/null && exit 0; sleep 1; done; echo "FAIL: playground 10s 内未就绪"; exit 1'
```

**硬阈值**: playground 自身端口 10 秒内就绪；命令 exit 0，超时 exit 非 0。

### Step 2: 调用方执行 GET /kernel-ping

**来源**: `[FROM_PRD]` — PRD「Golden Path（核心场景）」步骤 1。

**可观测行为**: 请求方法、路径和目标服务严格为 playground 的 `GET /kernel-ping`，不得替换成 Brain API。

**验证命令**:

```bash
bash -c 'set -euo pipefail; PORT=${PLAYGROUND_PORT:-31984}; NODE_ENV= PLAYGROUND_PORT=$PORT node playground/server.js >/tmp/kernel-ping-server-$$.log 2>&1 & SPID=$!; trap '\''kill $SPID 2>/dev/null; rm -f /tmp/kernel-ping-server-$$.log'\'' EXIT; for i in $(seq 1 10); do curl -sf --max-time 1 "http://127.0.0.1:$PORT/health" >/dev/null && break; [ "$i" = 10 ] && exit 1; sleep 1; done; CODE=$(curl -sS --max-time 5 -o /tmp/kernel-ping-body-$$.json -w "%{http_code}" -H "Accept: application/json" "http://127.0.0.1:$PORT/kernel-ping"); trap '\''kill $SPID 2>/dev/null; rm -f /tmp/kernel-ping-server-$$.log /tmp/kernel-ping-body-$$.json'\'' EXIT; [ "$CODE" = 200 ]'
```

**硬阈值**: HTTP 状态码严格为 200，单次请求最多 5 秒。

### Step 3: 调用方观察响应内容为 ok

**来源**: `[FROM_PRD]` — thin PRD 与 PRD「Golden Path（核心场景）」步骤 2-3 均锁定“返回/观察到 ok”。

**可观测行为**: 响应 JSON 精确为 `{"ok":true}`。

**验证命令**:

```bash
bash -c 'set -euo pipefail; PORT=${PLAYGROUND_PORT:-31985}; NODE_ENV= PLAYGROUND_PORT=$PORT node playground/server.js >/tmp/kernel-ping-server-$$.log 2>&1 & SPID=$!; trap '\''kill $SPID 2>/dev/null; rm -f /tmp/kernel-ping-server-$$.log'\'' EXIT; for i in $(seq 1 10); do curl -sf --max-time 1 "http://127.0.0.1:$PORT/health" >/dev/null && break; [ "$i" = 10 ] && exit 1; sleep 1; done; RESP=$(curl -sfS --max-time 5 -H "Accept: application/json" "http://127.0.0.1:$PORT/kernel-ping"); echo "$RESP" | jq -e '\''.ok == true and (keys == ["ok"])'\'''
```

**硬阈值**: `.ok == true` 且 `keys == ["ok"]`，jq exit 0。

### Step 4: 重复请求每次独立观察到 ok

**来源**: `[FROM_PRD]` — PRD「边界情况」明确要求重复请求每次独立观察到 `ok`。

**可观测行为**: 同一真实进程上连续两次 GET 均为 200 且各自响应精确等于 `{"ok":true}`。

**验证命令**:

```bash
bash -c 'set -euo pipefail; PORT=${PLAYGROUND_PORT:-31986}; NODE_ENV= PLAYGROUND_PORT=$PORT node playground/server.js >/tmp/kernel-ping-server-$$.log 2>&1 & SPID=$!; trap '\''kill $SPID 2>/dev/null; rm -f /tmp/kernel-ping-server-$$.log'\'' EXIT; for i in $(seq 1 10); do curl -sf --max-time 1 "http://127.0.0.1:$PORT/health" >/dev/null && break; [ "$i" = 10 ] && exit 1; sleep 1; done; for n in 1 2; do RESP=$(curl -sfS --max-time 5 "http://127.0.0.1:$PORT/kernel-ping"); echo "$RESP" | jq -e '\''.ok == true and (keys == ["ok"])'\'' >/dev/null || exit 1; done'
```

**硬阈值**: 两次请求均在 5 秒内返回且两次断言均 exit 0。

### Step 5: 非 GET 方法不进入成功路径

**来源**: `[FROM_PRD]` — PRD「边界情况」明确非 GET 方法不属于成功路径。

**可观测行为**: `POST /kernel-ping` 返回 Express 默认 404，不返回 200 `{"ok":true}`。

**验证命令**:

```bash
bash -c 'set -euo pipefail; PORT=${PLAYGROUND_PORT:-31987}; NODE_ENV= PLAYGROUND_PORT=$PORT node playground/server.js >/tmp/kernel-ping-server-$$.log 2>&1 & SPID=$!; trap '\''kill $SPID 2>/dev/null; rm -f /tmp/kernel-ping-server-$$.log'\'' EXIT; for i in $(seq 1 10); do curl -sf --max-time 1 "http://127.0.0.1:$PORT/health" >/dev/null && break; [ "$i" = 10 ] && exit 1; sleep 1; done; CODE=$(curl -sS --max-time 5 -o /dev/null -w "%{http_code}" -X POST "http://127.0.0.1:$PORT/kernel-ping"); [ "$CODE" = 404 ]'
```

**硬阈值**: POST 状态码严格为 404。

## Generator 执行硬条款（CONTRACT IS LAW）

1. Red commit 将合同测试逐字毕业到 `playground/tests/kernel-ping.test.ts`，只精确 add 该测试路径；测试不得 mock Express app 或响应。
2. Green commit 只在 `playground/server.js` 注册 `GET /kernel-ping`，返回 `res.json({ ok: true })`；不修改既有端点。
3. 禁止修改 `.github/workflows/*`、`packages/*`、`apps/*`、`playground/package.json` 或依赖锁文件；generator 只推分支，不自行 merge。
4. 验证命令只访问 playground 自身端口；不得以 localhost:5221 Brain health 替代。
5. Evaluator 证据必须把一手 exit_code、Red→Green 时序和命令输出排在 behavior_tests 前 8 条内；使用当前 Runner 注入的 HARNESS_* 与 CAPABILITY_SNAPSHOT_ID 记录 provenance，禁止固化 GAN authoring identity。

## TDD Red 采集方式

```bash
bash -c 'set -euo pipefail; TMP_TEST=playground/tests/kernel-ping.contract-red.test.ts; cp sprints/kernel-verify-postrepin3/tests/kernel-ping.test.ts "$TMP_TEST"; trap '\''rm -f "$TMP_TEST"'\'' EXIT; cd playground; npx vitest run tests/kernel-ping.contract-red.test.ts --config vitest.config.js --reporter=verbose'
```

预期：当前基线未注册 `/kernel-ping`，4 个成功路径测试因实际 404 失败；POST 404 边界测试保持通过。命令把合同测试复制到 vitest 的既有 include 范围后实跑并在退出时清理，避免“sprints 路径不在 include 中”造成伪 Red；该测试必须永久逐字毕业为 `playground/tests/kernel-ping.test.ts`。

## E2E 验收（最终 final-e2e 跑）

**journey_type**: autonomous
**target_environment**: playground

```bash
#!/bin/bash
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
PORT="${PLAYGROUND_PORT:-31988}"
SERVER_LOG=$(mktemp "${TMPDIR:-/tmp}/kernel-ping-server.XXXXXX")
NODE_ENV= PLAYGROUND_PORT="$PORT" node playground/server.js >"$SERVER_LOG" 2>&1 &
SPID=$!
cleanup() {
  if kill -0 "$SPID" 2>/dev/null; then kill "$SPID"; fi
  rm -f "$SERVER_LOG"
}
trap cleanup EXIT

for i in $(seq 1 10); do
  curl -sf --max-time 1 "http://127.0.0.1:$PORT/health" | jq -e '.ok == true' >/dev/null && break
  [ "$i" = 10 ] && { echo "FAIL: playground 10s 内未就绪"; exit 1; }
  sleep 1
done

for n in 1 2; do
  RESPONSE_FILE=$(mktemp "${TMPDIR:-/tmp}/kernel-ping-response.${n}.XXXXXX")
  CODE=$(curl -sS --max-time 5 -o "$RESPONSE_FILE" -w '%{http_code}' -H 'Accept: application/json' "http://127.0.0.1:$PORT/kernel-ping")
  [ "$CODE" = 200 ] || { echo "FAIL: 第 $n 次 GET 状态码=$CODE"; rm -f "$RESPONSE_FILE"; exit 1; }
  jq -e '.ok == true and (keys == ["ok"])' "$RESPONSE_FILE" >/dev/null || { echo "FAIL: 第 $n 次 GET schema 不符"; rm -f "$RESPONSE_FILE"; exit 1; }
  for forbidden in status pong result; do
    jq -e --arg key "$forbidden" 'has($key) | not' "$RESPONSE_FILE" >/dev/null || { echo "FAIL: 禁用字段 $forbidden 出现"; rm -f "$RESPONSE_FILE"; exit 1; }
  done
  rm -f "$RESPONSE_FILE"
done

POST_CODE=$(curl -sS --max-time 5 -o /dev/null -w '%{http_code}' -X POST "http://127.0.0.1:$PORT/kernel-ping")
[ "$POST_CODE" = 404 ] || { echo "FAIL: POST 状态码=$POST_CODE"; exit 1; }

(cd playground && npx vitest run tests/kernel-ping.test.ts tests/server.test.js tests/ping.test.js --config vitest.config.js --reporter=verbose)
echo "PASS: playground GET /kernel-ping 返回精确 {ok:true}，重复请求稳定，既有端点无回退"
```

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作

高风险面:
- 错输入: `GET /kernel-ping?ok=false`，确认 query 不改变固定响应。
- 重复提交: 连续快速发送 15 次 GET，确认每次独立返回同一精确 JSON。
- 中途中断: 请求之间重启 playground，确认新进程仍能返回契约响应。
- 边界值: 为 URL 附加超长无关 query，确认不使进程崩溃且响应契约不漂移。
- 发现分级: P0/P1（进程崩溃、响应漂移或影响既有端点）阻塞 merge；P2/P3 记录 findings 不阻塞。

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 成功响应 | `sprints/kernel-verify-postrepin3/tests/kernel-ping.test.ts` | `返回 200 且响应为 {ok:true}` | 路由未实现，实际 404 |
| schema 完整性 | `sprints/kernel-verify-postrepin3/tests/kernel-ping.test.ts` | `GET /kernel-ping 响应 keys 完整性严格等于 ["ok"]` | body 为空导致 keys 不符 |
| 禁用字段 | `sprints/kernel-verify-postrepin3/tests/kernel-ping.test.ts` | `响应不含 status、pong、result 禁用字段` | 与主成功响应一起证明 schema；基线该负向项可先绿 |
| 重复请求 | `sprints/kernel-verify-postrepin3/tests/kernel-ping.test.ts` | `连续两次 GET /kernel-ping 每次均独立返回 {ok:true}` | 两次均实际 404 |
| 非 GET 边界 | `sprints/kernel-verify-postrepin3/tests/kernel-ping.test.ts` | `POST /kernel-ping 不进入 GET 成功路径并返回 404` | 基线天然通过，防实现误注册 POST |

gp-anchor: skipped (product-map.json not found)

## Notes

- contract-gate: enabled (`packages/brain/src/lib/contract-gate.js` exists).
- validation-truth: 本任务为 local playground 无 UI smoke；真相形态是 evaluator 启动本提交的真实 `playground/server.js`，以 curl HTTP 状态、精确 JSON、重复请求及毕业 vitest 的 exit_code 为准，不要求截图。
