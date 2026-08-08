# Sprint Contract Draft (Round 3)

## Response Schema（推导来源: PRD 字面 + api_registry/既有 playground 模式）

### Endpoint: GET /kernel-ping2

**Success (HTTP 200)**:
```json
{"result":"ok2"}
```
- `result` (string，必填): PRD 要求响应中可机械断言字符串 `ok2`；沿用 playground 的 `result` 命名。
- 顶层 keys 必须严格等于 `["result"]`。
- **禁用字段名**: `["ok","pong","message","data"]`。

**Error**: N/A — Express 对非 GET 请求使用既有默认 404；本 Sprint 不新增错误 schema。

## 已知约束（来自回归测试）

- `[playground/tests/server.test.js]` → `GET /health → 200 {ok: true}` 及既有 playground 路由测试不得回退。
- `[累积FR]` → context-manifest: unavailable；PRD 明示本 line 暂无历史能力。

gp-anchor: skipped (product-map.json not found)

## Golden Path

独立小路（无父路）

[启动 playground] → [GET /kernel-ping2] → [观察 `{"result":"ok2"}`]

### Step 1: 启动真实 playground 服务
**来源**: `[FROM_PRD]` — PRD「Golden Path」具体步骤 1。

**可观测行为**: playground 在本 attempt 选择的空闲本机端口监听，`/health` 返回既有成功响应。

**验证命令**: E2E 脚本启动真实 `playground/server.js` 并以带上限轮询确认 `/health`。

**硬阈值**: 最多 10 秒就绪；超时脚本非零退出。

### Step 2: 请求 GET /kernel-ping2 并观察固定出口
**来源**: `[FROM_PRD]` — PRD「Golden Path」具体步骤 2-3 与 thin PRD。

**可观测行为**: 真实 HTTP GET 返回 200，响应严格为 `{"result":"ok2"}`。

**验证命令**: `curl -sf "$BASE_URL/kernel-ping2" | jq -e '.result=="ok2" and keys==["result"]'`

**硬阈值**: HTTP 200；`result` 字面等于 `ok2`；顶层 keys 严格等于 `["result"]`。

### Step 3: 非 GET 不冒充成功且既有端点不回退
**来源**: `[FROM_PRD]` — PRD「边界情况」两项。

**可观测行为**: POST `/kernel-ping2` 不返回 2xx；GET `/health` 仍严格返回 `{"ok":true}`。

**验证命令**: E2E 断言 POST 状态码非 2xx，并断言 `/health` 的值与 schema。

**硬阈值**: POST 状态码不在 200-299；`/health` 为 HTTP 200 且 `ok=true`。

## 接缝清单

- playground 进程 ↔ 本机 HTTP 端口：在真实 Node 进程上执行 curl，不使用替身；10 秒内就绪才算 done。

## 禁 mock 边清单

- `playground/server.js` ↔ Express 路由栈：合同测试必须用真实 supertest 请求 app，禁止 mock Express 或路由处理器。

## 真实调用方请求 shape

- 调用方为普通 HTTP 客户端：`GET /kernel-ping2`，无鉴权 header、无 request body、无 query；`Accept: application/json` 可选。DoD 使用完全相同的 method/path。

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A）

## 八要素需求规范

| 要素 | 本次答案 |
|---|---|
| FR（做什么） | GET `/kernel-ping2` 返回 `{"result":"ok2"}`。 |
| NFR（做得多好） | 响应可机械断言；E2E 最多等待服务就绪 10 秒。 |
| Invariant（永不违反） | 不接 Brain/DB/外部系统；非 GET 不成功；既有 `/health` 不回退；凭据不入库、不入日志。其余 PRD area 铁律不触及对应模块，显式 N/A。 |
| 判定点（怎么知道） | HTTP 状态、JSON 值与严格 keys 三重机器判定。 |
| 保质期（何时过期） | 无 token/缓存；端点随 playground 版本存在。 |
| 死亡告警（停了谁知道） | CI 与 evaluator 的 curl 在 10 秒内非零失败。 |
| 失败语义（挂了怎么办） | 服务未就绪、状态码或 schema 不符均 fail-closed，不降级。 |
| 效果确认（已发≠已生效） | 读取真实 HTTP response body 并用 jq 严格断言。 |

### 判定点登记表

（本任务无接缝模糊判定点，N/A）

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|---|---|---|---|
| 服务 10 秒未就绪 | E2E 非零退出 | 是，GET 无副作用 | 无降级 |
| 响应值/schema 漂移 | oracle 非零退出 | 是 | 无降级 |

### 输入对抗面

N/A — 端点无输入、无 agent、无鉴权或租户数据。

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作
高风险面:
- 错输入: 给 GET `/kernel-ping2` 附加随机 query，确认不会产生额外响应字段。
- 重复提交: 连续请求 15 次，确认结果稳定为 `ok2`。
- 中途中断: 请求间重启 playground，确认新进程就绪后响应不漂移。
- 边界值: 使用 POST/PUT/DELETE，确认均不冒充 GET 成功。
发现分级: P0/P1 → 阻塞 merge；P2/P3 → 记 findings 不阻塞。

## E2E 验收（最终 final-e2e 跑）

**journey_type**: autonomous
**target_environment**: playground

```bash
#!/bin/bash
set -euo pipefail
SPRINT_KEY="${HARNESS_ATTEMPT_ID:-local}-kernel-ping2"
PORT="${PLAYGROUND_PORT:-43127}"
BASE_URL="http://127.0.0.1:${PORT}"
LOG_FILE="$(mktemp -t "${SPRINT_KEY}.XXXXXX.log")"
APP_PID=""
cleanup() { [ -z "$APP_PID" ] || kill "$APP_PID" 2>/dev/null || true; rm -f "$LOG_FILE"; }
trap cleanup EXIT
PLAYGROUND_PORT="$PORT" NODE_ENV=production node playground/server.js >"$LOG_FILE" 2>&1 &
APP_PID=$!
for i in $(seq 1 20); do curl -sf "$BASE_URL/health" >/dev/null && break; [ "$i" = 20 ] && { tail -20 "$LOG_FILE"; exit 1; }; sleep 0.5; done
RESP=$(curl -sf -H 'Accept: application/json' "$BASE_URL/kernel-ping2")
echo "$RESP" | jq -e '.result == "ok2" and (keys == ["result"])'
CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE_URL/kernel-ping2")
case "$CODE" in 2*) echo "FAIL: POST 冒充 GET 成功 status=$CODE"; exit 1;; esac
curl -sf "$BASE_URL/health" | jq -e '.ok == true and (keys == ["ok"])'
echo "OK: playground GET /kernel-ping2 真实响应为 ok2"
```

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| `/kernel-ping2` | `sprints/kernel-final-codex2/tests/kernel-ping2.test.ts` | `返回严格 200`、`仅含 result`、`POST 不成功`、`既有 health 不回退` | 路由未实现时前两条在具体断言行失败 |

### TDD Red 证据（Round 3）

- 单行命令：`./node_modules/.bin/vitest run sprints/kernel-final-codex2/tests/kernel-ping2.test.ts --reporter=verbose`
- 实跑结果：exit code = 1；Vitest 成功收集并执行 4 个测试，其中 2 failed、2 passed。
- 可归因失败：根目录现存 Vitest 入口成功加载 `vitest v1.6.1` 与测试文件；`kernel-ping2.test.ts:8` 的 `expect(res.status).toBe(200)` 实收 404；`kernel-ping2.test.ts:14` 的 `expect(Object.keys(res.body)).toEqual(['result'])` 实收空数组。日志终态为 `Test Files 1 failed (1)`、`Tests 2 failed | 2 passed (4)`，失败发生在未实现路由的行为断言，不是命令不存在、依赖加载、配置或测试收集失败。
- 永久回归命令：实现后仍以同一命令运行；只有 GET 路由返回 HTTP 200、`result=ok2` 且仅含 `result` 时前两条才能转绿。

## Notes

- contract-gate: enabled (`packages/brain/src/lib/contract-gate.js` present)
- validation identity late-bound：E2E 仅从 Runner 的 `HARNESS_ATTEMPT_ID` 派生临时日志名，不固化起草角色 UUID 或 capability snapshot。
- 本任务验证真相形态：真实 Node 解释器 + 真实本机 HTTP response；无 UI/DB/生产接缝，meta verification 以 curl+jq 原始输出为一手证据。
