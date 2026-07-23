# Sprint PRD — Playground 新增 GET /square 路由

## OKR 对齐

- **本次推进目标**：在 playground/server.js 新增 `GET /square` 路由，验证 headless evaluator 端到端运行
- **任务 ID**：61e04eff-1fcd-4da8-b1c1-161f81026a76

## 背景

headless-evaluator-test 系列验证任务，通过给 playground 添加新路由来端到端跑通 harness evaluator 阶段。
同批次 headless-contract-test 添加了 `/negate` 路由（PR #4228）；本任务添加 `/square` 路由。

## Golden Path（核心场景）

用户从 [调用 GET /square?value=N] → 经过 [路由验证与计算] → 到达 [返回 N² 及 operation 字段]

具体：
1. 调用 `GET /square?value=5` → `{"result": 25, "operation": "square"}`
2. 调用 `GET /square?value=-3` → `{"result": 9, "operation": "square"}`
3. 调用 `GET /square?value=0` → `{"result": 0, "operation": "square"}`
4. 非整数 / 缺参 / 越界 → HTTP 400 `{"error": "<非空字符串>"}`

## 功能规范

### 成功响应

- HTTP 200
- body 顶层 keys 严格等于 `["operation", "result"]`（顺序不限）
- `result`: `Number(value) * Number(value)`，整数计算，无浮点近似
- `operation`: 字面字符串 `"square"`，禁止任何变体（`sq` / `squared` / `pow2` / `power` 等）

### 参数规则

- query 参数名锁死为 `value`，禁止别名 `n / x / a / b / num / number / input / v / val / val`
- 值格式白名单 strict-schema：`^-?\d+$`（整数，含负号）
  - 拒绝：小数（`1.5`）、科学计数法（`1e2`）、前导 `+`（`%2B5`）、十六进制、`Infinity`、字母串、空串
- 精度上界：`|Number(value)| > 94906265` → 400（避免 value² 超过 `Number.MAX_SAFE_INTEGER = 9007199254740991`）
  - 边界：`value=94906265` → 200，`value=94906266` → 400
  - 负数同等：`value=-94906265` → 200，`value=-94906266` → 400
- 缺 `value` 参数 → 400

### 错误响应

- HTTP 400
- body 顶层 keys 严格等于 `["error"]`（禁止 `message` / `msg` / `reason` / `detail`）
- `error` 值为非空字符串

## 边界情况

- `value=0` → `{result: 0, operation: "square"}` ✓
- `value=-0`（如 URL 编码传入）→ 同 `value=0` 处理（整数 `-0` 字符串不满足 `^-?\d+$` 因为 `-0` 不合法，实际上 `-0` 满足？不，`-0` 匹配 `^-?\d+$`，但 Number("-0") = -0，(-0)*(-0) = 0 → result=0 即可）

## 受影响文件

- `playground/server.js`：新增 `/square` 路由处理器
- `playground/tests/server.test.js`：新增合同测试（DOD-1~N）

## Invariant 约束

<!-- 来源: playground 现有路由约定 -->
- I1: 所有现有路由（/health、/sum、/multiply、/divide、/power、/modulo、/subtract、/increment、/decrement、/factorial、/abs、/echo）行为不变（回归保护）
- I2: strict-schema 是 playground 每个路由的 invariant——不允许 JavaScript 隐式类型转换通过
- I3: 成功响应 body 只含合同规定的 top-level keys，不允许多余字段
- I4: 错误响应 body 只含 `{error: string}`，不允许多余字段

## 累积 FR

<!-- 来源: playground 已有路由提炼 -->
- FR1: 所有路由使用 strict-schema 整数/数字白名单正则，拒绝模糊输入
- FR2: 每个路由锁定唯一 query 参数名，拒绝别名变体
- FR3: 成功响应含 `operation` 字段（字面路由动作名）
- FR4: 精度上下界保护，防止结果超出 `Number.MAX_SAFE_INTEGER`
- FR5: 错误响应格式统一为 `{error: string}`

## NFR

- 延迟：无特殊要求（playground 本地测试环境）
- 无需认证
- vitest 单元测试全绿（含回归）
- E2E：bash curl 脚本验证核心场景

## E2E 验收

target_environment: server_local（playground Node.js 服务，端口 PLAYGROUND_PORT=3001）

```bash
# 启动 playground
cd /workspace && PLAYGROUND_PORT=3001 node playground/server.js &
sleep 1

# 成功场景
curl -s 'http://127.0.0.1:3001/square?value=5' | grep '"result":25'
curl -s 'http://127.0.0.1:3001/square?value=-3' | grep '"result":9'
curl -s 'http://127.0.0.1:3001/square?value=0' | grep '"result":0'
curl -s 'http://127.0.0.1:3001/square?value=94906265' | grep '"result"'

# 越界拒绝
curl -s -o /dev/null -w '%{http_code}' 'http://127.0.0.1:3001/square?value=94906266' | grep 400

# 非整数拒绝
curl -s -o /dev/null -w '%{http_code}' 'http://127.0.0.1:3001/square?value=1.5' | grep 400

# 缺参拒绝
curl -s -o /dev/null -w '%{http_code}' 'http://127.0.0.1:3001/square' | grep 400
```

## journey_type: api_only
## journey_type_reason: playground 是纯 Node.js HTTP 服务，无浏览器 UI，测试全走 curl/vitest
## target_environment: server_local
## target_environment_reason: playground 本地 node 服务，vitest 单测 + bash curl E2E，无需 mac_web/windows_cloud
## journey_id: 61e04eff-1fcd-4da8-b1c1-161f81026a76
## step_id: square-route-impl
