# Sprint Contract Draft（Round 1）

## Notes

- contract-gate: enabled (`packages/brain/src/lib/contract-gate.js` exists)
- gp-anchor: skipped (product-map.json not found)
- PRD 正文以 `thin_prd`“playground GET /kernel-ping 返回ok”为最高优先级，`sprint-prd.md` 提供边界与验收上下文。

## Response Schema（推导来源: PRD字面 + playground 现有路由风格）

### Endpoint: GET /kernel-ping

**Success (HTTP 200)**：响应体为 UTF-8 文本，字节内容严格等于 `ok`；不定义 JSON 对象或额外字段。

- body (`text`, 必填)：字面值 `ok`，来源——thin PRD 与 PRD“收到表示成功的 `ok` 响应”。
- HTTP status (`number`, 必填)：`200`，来源——PRD“请求成功结束”。
- 禁用响应：JSON 包装（如 `{"ok":true}`）、额外前后缀、换行或动态时间戳。
- Error：N/A——PRD 明确不为非 GET 方法或其他路径新增行为；它们保持 Express 既有 404。

Registry 中未发现 `/kernel-ping` 既有定义；精确 body 依 PRD 字面锁定为 `[NEW_PATTERN]` 的纯文本 `ok`，不改写为近义 JSON schema。

## 已知约束（来自回归测试与累积 FR）

- [`playground/tests/server.test.js`] → `GET /health → 200 {ok: true}`；新增路由不得回退该既有端点。
- [`playground/tests/ping.test.js`] → `GET /ping → 200 + {pong: true}`；新增路由不得改写 `/ping`。
- [累积FR] `sprint-prd.md` 明示“本 line 暂无历史”。
- context-manifest: unavailable
- [铁律] sprint 目录测试必须用能真正收集该路径的 Vitest 调用执行，记录真实非零 exit code；不得把 include 范围外的 exit 1 误报为业务 Red。
- [铁律] manual oracle 必须真实启动目标 Node 服务并记录 exit code；仅 `bash -n` 不足以验业务响应。

## 八要素需求规范

| 要素 | 本次答案 |
|---|---|
| FR（做什么） | playground 对 `GET /kernel-ping` 返回 HTTP 200，body 严格等于 `ok`；重复调用稳定。 |
| NFR（做得多好） | 单次请求等待预算 5s；连续两次响应必须完全一致且无历史状态依赖。 |
| Invariant（永不违反） | 不修改 Brain、Dashboard、Harness 编排或既有 playground 路由；不新增非 GET 行为。 |
| 判定点（怎么知道） | 以 curl 的 HTTP code 与落盘 body 逐字节比较共同判定，不凭日志文本。 |
| 保质期（何时过期） | 无 token/缓存/外部数据；能力随该路由存在而持续有效。 |
| 死亡告警（停了谁知道） | CI 回归测试及 Harness E2E 在 5s 内非零退出，并保留 curl/测试输出。 |
| 失败语义（挂了怎么办） | 启动失败、超时、非 200 或 body 非 `ok` 均阻塞验收；不降级放行。 |
| 效果确认（已发≠已生效） | 真实监听端口上连续两次 HTTP 请求都收到 200 且 body 字节等于 `ok`。 |

### 判定点登记表

（本任务无真机/RPA/外部状态接缝判定点，N/A）

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|---|---|---|---|
| playground 5s 内未就绪 | E2E 非零退出并输出服务日志 | 是；启动无业务状态 | 无降级 |
| `/kernel-ping` 非 200 或 body 漂移 | 当前断言立即非零退出 | 是；GET 无副作用 | 无降级 |
| 重复请求结果不一致 | 当前断言立即非零退出 | 是；GET 无副作用 | 无降级 |

### 输入对抗面

N/A——这是隔离 playground 冒烟端点，不是对外暴露 agent，也不处理用户输入。

## 真实调用方请求 shape

调用方为标准 HTTP 客户端：`GET /kernel-ping HTTP/1.1`，无 query、无 body、无认证 header。该 playground 端点不接触租户或生产数据；DoD 使用完全相同的 method/path，并不另造 body 认证路径。

## 禁 mock 边清单

- `playground/server.js` Express 路由 ↔ 真实 HTTP listener：Final E2E 必须启动仓库真实 `node playground/server.js` 并由 curl 访问，禁止 mock app、router 或响应。
- `playground/server.js` ↔ `supertest` 回归测试：TDD 测试导入真实 app，禁止 `vi.mock`/stub 被改路由。

## 未覆盖真实链路清单

（本合同无第三方 API、force 参数、stub、假数据或 mock 豁免，N/A）

## 接缝清单

- 本机进程监听与 HTTP socket 是唯一接缝；Final E2E 真实启动 Node、轮询就绪并 curl 两次。该步骤可重复，标 `[接缝×2]`。

## Golden Path

独立小路（无父路）

[启动真实 playground] → [GET /kernel-ping 命中路由] → [调用方收到 200 与 `ok`] → [重复调用仍一致且边界不扩张]

### Step 1: 启动真实 playground 服务

**来源**: `[FROM_PRD]` — PRD“playground 服务运行时”及 E2E 占位说明要求启动 `node playground/server.js`。

**可观测行为**: 真实 Node 进程在本轮指定端口监听，既有 `/health` 在 5s 内返回 200。

**验证命令**:

```bash
PLAYGROUND_PORT=31990 node playground/server.js >/tmp/kernel-ping-step1.log 2>&1 & PID=$!; cleanup(){ STATUS=$?; trap - EXIT; kill "$PID" 2>/dev/null || :; wait "$PID" 2>/dev/null || :; exit "$STATUS"; }; trap cleanup EXIT; DEADLINE=$((SECONDS+5)); until curl -sf "http://127.0.0.1:31990/health" >/dev/null; do [ "$SECONDS" -lt "$DEADLINE" ] || { sed -n '1,80p' /tmp/kernel-ping-step1.log; exit 1; }; sleep 1; done
```

**硬阈值**: 5s 内就绪；验证命令的 deadline 与 curl `-f` 使超时/HTTP 错误非零退出。

### Step 2: GET 请求命中 `/kernel-ping`

**来源**: `[FROM_PRD]` — PRD Golden Path 第 1-2 步明确 method 与 path。

**可观测行为**: 真实 HTTP 请求完成且 status 为 200。

**验证命令**:

```bash
CODE=$(curl -sS -o /tmp/kernel-ping-step2.body -w '%{http_code}' http://127.0.0.1:${PLAYGROUND_PORT:?}/kernel-ping); [ "$CODE" = "200" ] || { echo "FAIL: status=$CODE"; exit 1; }
```

**硬阈值**: HTTP status 必须严格等于 200；验证命令直接比较状态码。

### Step 3: 调用方观察到精确 `ok` 响应

**来源**: `[FROM_PRD]` — thin PRD 与 Golden Path 第 3 步字面要求响应为 `ok`。

**可观测行为**: HTTP body 的全部字节严格等于 `ok`，没有 JSON 包装、空白或动态字段。

**验证命令**:

```bash
printf ok >/tmp/kernel-ping.expected; curl -sf http://127.0.0.1:${PLAYGROUND_PORT:?}/kernel-ping -o /tmp/kernel-ping.actual; cmp -s /tmp/kernel-ping.expected /tmp/kernel-ping.actual || { od -An -tx1 /tmp/kernel-ping.actual; exit 1; }
```

**硬阈值**: body = 两字节 `6f 6b`；`cmp -s` 不相等即非零退出。

### Step 4: 重复调用稳定且边界不扩张

**来源**: `[FROM_PRD]` — PRD“重复调用…每次均稳定返回 `ok`”及“对非 GET 方法或其他路径不新增行为”。

**可观测行为**: 连续两次 GET 均为 `ok`；POST `/kernel-ping` 仍为既有 404；既有 GET `/ping` 仍返回 `{"pong":true}`。

**验证命令**:

```bash
A=$(curl -sf http://127.0.0.1:${PLAYGROUND_PORT:?}/kernel-ping); B=$(curl -sf http://127.0.0.1:${PLAYGROUND_PORT:?}/kernel-ping); [ "$A" = "ok" ] && [ "$B" = "ok" ] && [ "$A" = "$B" ]; POST_CODE=$(curl -sS -o /dev/null -w '%{http_code}' -X POST http://127.0.0.1:${PLAYGROUND_PORT:?}/kernel-ping); [ "$POST_CODE" = "404" ]; curl -sf http://127.0.0.1:${PLAYGROUND_PORT:?}/ping | jq -e 'keys == ["pong"] and .pong == true'
```

**硬阈值**: 两次 body 都严格等于 `ok`，POST status=404，既有 `/ping` schema/value 不变；三组可执行断言缺一即失败。

## E2E 验收（最终 final-e2e 跑）

**journey_type**: autonomous
**target_environment**: playground

```bash
#!/bin/bash
set -euo pipefail
E2E_PORT="${PLAYGROUND_PORT:-31989}"
SERVER_LOG=$(mktemp)
BODY_ONE=$(mktemp)
BODY_TWO=$(mktemp)
EXPECTED=$(mktemp)
PLAYGROUND_PORT="$E2E_PORT" node playground/server.js >"$SERVER_LOG" 2>&1 &
SERVER_PID=$!
cleanup() {
  STATUS=$?
  trap - EXIT
  kill "$SERVER_PID" 2>/dev/null || :
  wait "$SERVER_PID" 2>/dev/null || :
  rm -f "$SERVER_LOG" "$BODY_ONE" "$BODY_TWO" "$EXPECTED"
  exit "$STATUS"
}
trap cleanup EXIT

DEADLINE=$((SECONDS+5))
until curl -sf "http://127.0.0.1:$E2E_PORT/health" >/dev/null; do
  [ "$SECONDS" -lt "$DEADLINE" ] || { sed -n '1,80p' "$SERVER_LOG"; exit 1; }
  sleep 1
done

CODE_ONE=$(curl -sS -o "$BODY_ONE" -w '%{http_code}' "http://127.0.0.1:$E2E_PORT/kernel-ping")
[ "$CODE_ONE" = "200" ] || { echo "FAIL: first status=$CODE_ONE"; exit 1; }
CODE_TWO=$(curl -sS -o "$BODY_TWO" -w '%{http_code}' "http://127.0.0.1:$E2E_PORT/kernel-ping")
[ "$CODE_TWO" = "200" ] || { echo "FAIL: second status=$CODE_TWO"; exit 1; }
printf ok >"$EXPECTED"
cmp -s "$EXPECTED" "$BODY_ONE" || { echo "FAIL: first body is not exact ok"; od -An -tx1 "$BODY_ONE"; exit 1; }
cmp -s "$EXPECTED" "$BODY_TWO" || { echo "FAIL: second body is not exact ok"; od -An -tx1 "$BODY_TWO"; exit 1; }
cmp -s "$BODY_ONE" "$BODY_TWO" || { echo "FAIL: repeated responses differ"; exit 1; }
POST_CODE=$(curl -sS -o /dev/null -w '%{http_code}' -X POST "http://127.0.0.1:$E2E_PORT/kernel-ping")
[ "$POST_CODE" = "404" ] || { echo "FAIL: POST boundary status=$POST_CODE"; exit 1; }
curl -sf "http://127.0.0.1:$E2E_PORT/ping" | jq -e 'keys == ["pong"] and .pong == true'
echo "Golden Path PASS: status=200 body=ok repeat=stable boundaries=preserved"
```

通过标准：脚本 exit 0；stdout 末行包含 `Golden Path PASS`，且一手证据包括两个 status、两个 body 的字节比较、POST 404 与既有 `/ping` oracle。该 local_api/无 UI smoke 的验证真相形态就是“真实 Node listener + curl exit code/body bytes”，无需截图。

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作

高风险面:
- 错输入: 给 `/kernel-ping` 加任意 query，确认响应仍由无状态 GET 处理且不出现反射内容。
- 重复提交: 快速连续请求 15 次，确认每次 status/body 一致。
- 中途中断: 请求后停止并重启 playground，再次请求确认无历史状态依赖。
- 边界值: 尝试 POST/PUT 及相邻未知路径，确认没有新增行为；复查 `/ping`、`/health` 未回退。
- 发现分级: P0/P1（路由不可用、body 漂移、既有端点回退）阻塞 merge；P2/P3 记录 findings。

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| `/kernel-ping` 完整路径 | `sprints/kernel-final-codex/tests/kernel-ping.test.js` | `GET /kernel-ping 返回 200`；`响应体严格等于 ok`；`连续两次调用稳定返回 ok`；`POST 保持 404 且既有 /ping 不回退` | 已实跑 Red：exit 1，3 failed / 1 passed；失败根因均为 GET 路由未注册而收到 404/Express error body |

TDD Red 命令：`npx vitest run sprints/kernel-final-codex/tests/kernel-ping.test.js --reporter=verbose`。该命令不使用 `playground/vitest.config.js` 的 include 范围，确保目标解释器实际加载 sprint 测试；本轮实跑 exit code=1，Vitest 明确执行 4 条并报告 3 failed / 1 passed。
