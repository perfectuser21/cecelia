# Sprint Contract Draft (Round 1)

**Task ID**: da946af8-44af-4fc2-8991-e801619cb192
**Sprint Dir**: sprints/07151032-relay-da946af8
**Journey**: bb8cc561 Cecelia Harness Pipeline，dev_pipeline，local_api
**日期**: 2026-07-15

---

## Response Schema（推导来源: PRD字面）

### Endpoint: GET /api/brain/relay-smoke

**Success (HTTP 200)**:
```json
{"ok": true, "controller": "2.2.0", "executor": "<string>"}
```
- `ok` (boolean, 必填): 来源——PRD明确，已有 B1 约束，值固定为 true
- `controller` (string, 必填): 来源——PRD明确，已有 B3 约束，值固定为 "2.2.0"
- `executor` (string, 必填): 来源——PRD明确 FR6，值为 `process.env.HARNESS_EXECUTOR || 'unknown'`，非空字符串

**禁用字段名**: [env, environment, agent, runner, host]

**Error (HTTP 4xx)**: N/A — 端点无鉴权/参数，不产生 4xx

---

## 已知约束（来自回归测试）

- [relay-smoke.contract.test.js] → B1: GET /api/brain/relay-smoke 返回 HTTP 200
- [relay-smoke.contract.test.js] → B2: 响应体含 ok:true
- [relay-smoke.contract.test.js] → B3: 响应体含 controller:"2.2.0"
- [relay-smoke.contract.test.js] → B4: 响应 Content-Type 含 application/json
- [relay-smoke.contract.test.js] → B5: 不影响现有端点（/api/brain/context 仍可访问）

[累积FR]: 来自 sprint-prd.md 的累积 FR 段（FR1~FR6 全量），context-manifest: unavailable（本地执行环境无法访问 Brain Journey context 端点）

---

## 八要素需求规范

| 要素 | 说明 | 本次答案（必填，可 N/A） |
|------|------|--------------------------|
| **FR（做什么）** | 功能需求：系统对外承诺做什么 | GET /api/brain/relay-smoke 在原有 `ok:true` 和 `controller:"2.2.0"` 基础上，新增 `executor` 字段，值为 `process.env.HARNESS_EXECUTOR \|\| 'unknown'` |
| **NFR（做得多好）** | 非功能需求：性能/可靠性/并发阈值等 | 响应时间 < 100ms；无 DB 查询；无外部依赖；GET 幂等零副作用 |
| **Invariant（永不违反）** | 任何情况下不得打破的不变量（安全/数据一致性/幂等） | B1~B5 已有断言不可破坏：ok:true、controller:"2.2.0"、HTTP 200、Content-Type JSON、/api/brain/context 不受影响 |
| **判定点（怎么知道）** | 对模糊现实的判断假设（详见"判定点登记表"） | 见下方登记表 |
| **保质期（何时过期）** | 该能力/数据/token 何时失效，谁负责退役 | 该端点为常驻 smoke probe，无过期；若 controller 版本升级则同步更新版本号 |
| **死亡告警（停了谁知道）** | 该功能停止工作后，谁在多久内会知道 | Brain 巡检 tick 每 5 分钟执行探针；探针失败触发告警 |
| **失败语义（挂了怎么办）** | 故障时放行还是拦截？重试幂等？降级策略？ | GET 幂等，失败直接重试；Brain 服务宕机则该端点也不可达，调用方感知 5xx；无降级需求（仅 smoke） |
| **效果确认（已发≠已生效）** | 每个对外动作如何确认真实生效？ | curl 返回 HTTP 200 + JSON body 含 executor 字段（非空）即为生效；无异步副作用需确认 |

### 判定点登记表

（本任务无接缝判定点，N/A）

> 本任务为纯同步 GET 端点，读环境变量，无 RPA/真机/外部状态推断接缝。

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| Brain 服务未启动 | curl 连接拒绝，调用方感知 ECONNREFUSED | 是（GET 幂等） | 无降级（仅 smoke probe，服务本身故障） |
| HARNESS_EXECUTOR 未设置 | executor 字段返回 'unknown'，仍 HTTP 200 | 是 | 返回 'unknown' 作为默认值，非错误 |

### 输入对抗面

N/A — 本端点为只读 smoke probe，无用户输入，无参数，无写操作，不面向外部 agent。

---

## Golden Path

[入口: curl GET /api/brain/relay-smoke] → [Brain 读 process.env.HARNESS_EXECUTOR] → [返回含 executor 字段的 JSON 响应] → [调用方断言 executor 非空]

### Step 1: 触发 relay-smoke 端点
**来源**: `[FROM_PRD]` — PRD Golden Path 第 1 步，curl 调用端点

**可观测行为**: HTTP 200，JSON body 含 `ok:true`、`controller:"2.2.0"`、`executor` 字段（非空字符串）

**验证命令**:
```bash
BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
RESP=$(curl -sf "$BRAIN_URL/api/brain/relay-smoke")
echo "$RESP" | jq -e '.ok == true' || { echo "FAIL: ok != true"; exit 1; }
echo "$RESP" | jq -e '.controller == "2.2.0"' || { echo "FAIL: controller != 2.2.0"; exit 1; }
echo "$RESP"
```

**硬阈值**: HTTP 200，ok=true，controller="2.2.0"

---

### Step 2: 验证 executor 字段存在且非空
**来源**: `[FROM_PRD]` — PRD FR6，读取 `process.env.HARNESS_EXECUTOR || 'unknown'`

**可观测行为**: `executor` 字段为非空字符串（有 HARNESS_EXECUTOR 时为注入值，无时为 'unknown'）

**验证命令**:
```bash
BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
RESP=$(curl -sf "$BRAIN_URL/api/brain/relay-smoke")
echo "$RESP" | jq -e '.executor != null and (.executor | type) == "string" and .executor != ""' \
  || { echo "FAIL: executor 字段缺失或为空"; exit 1; }
echo "executor=$(echo "$RESP" | jq -r '.executor')"
```

**硬阈值**: executor 为非 null 非空字符串

---

### Step 3: 验证注入 HARNESS_EXECUTOR 时 executor 值与环境变量一致
**来源**: `[FROM_PRD]` — PRD Golden Path "headless relay 容器以 HARNESS_EXECUTOR=claude 启动"

**可观测行为**: 注入 `HARNESS_EXECUTOR=claude` 后 executor 字段值为 "claude"

**验证命令**:
```bash
# 此断言通过 vitest 单元测试验证（直接控制 process.env，无需启动真实服务器）
# 逻辑类断言：见 tests/relay-smoke-executor.contract.test.js — "应返回 HARNESS_EXECUTOR 环境变量值"
echo "逻辑断言: 见 vitest 单元测试 B6-env"
```

**硬阈值**: 环境变量值 == executor 字段值（单元测试验证）

---

### Step 4: 验证 B1~B5 回归（不影响现有合同）
**来源**: `[FROM_PRD]` — PRD Invariant 第 1 条，已有合同测试断言不可破坏

**可观测行为**: 新增 executor 字段后，原有 B1~B5 断言全部通过

**验证命令**:
```bash
BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
# B1: ok == true
curl -sf "$BRAIN_URL/api/brain/relay-smoke" | jq -e '.ok == true' || { echo "FAIL B1"; exit 1; }
# B2: HTTP 200
STATUS=$(curl -o /dev/null -w "%{http_code}" -sf "$BRAIN_URL/api/brain/relay-smoke")
[ "$STATUS" = "200" ] || { echo "FAIL B2: HTTP $STATUS"; exit 1; }
# B3: controller == 2.2.0
curl -sf "$BRAIN_URL/api/brain/relay-smoke" | jq -e '.controller == "2.2.0"' || { echo "FAIL B3"; exit 1; }
# B4: Content-Type 含 application/json
curl -sI "$BRAIN_URL/api/brain/relay-smoke" | grep -i "content-type.*application/json" || { echo "FAIL B4"; exit 1; }
echo "B1~B4 回归全部通过"
```

**硬阈值**: 全部命令 exit 0

---

## 运行时守卫

probe: brain-api/relay-smoke-health
```bash
BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
curl -sf "$BRAIN_URL/api/brain/relay-smoke" \
  | jq -e '.ok == true and .controller == "2.2.0" and .executor != null and .executor != ""' \
  || exit 1
```
发现延迟目标: 5 分钟内（Brain tick 巡检周期）
发现者: Brain 巡检 tick 定期执行探针；探针失败写入告警日志

---

## E2E 验收

**journey_type**: dev_pipeline
**target_environment**: local_api

```bash
#!/bin/bash
set -euo pipefail

BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"

echo "=== B1: ok 字段为 true ==="
curl -sf "$BRAIN_URL/api/brain/relay-smoke" | jq -e '.ok == true'

echo "=== B2: HTTP 200 ==="
STATUS=$(curl -o /dev/null -w "%{http_code}" -sf "$BRAIN_URL/api/brain/relay-smoke")
[ "$STATUS" = "200" ] && echo "200 OK"

echo "=== B3: controller 字段为 2.2.0 ==="
curl -sf "$BRAIN_URL/api/brain/relay-smoke" | jq -e '.controller == "2.2.0"'

echo "=== B4: Content-Type 含 application/json ==="
curl -sI "$BRAIN_URL/api/brain/relay-smoke" | grep -i "content-type.*application/json"

echo "=== B6: executor 字段为非空字符串（新增）==="
curl -sf "$BRAIN_URL/api/brain/relay-smoke" | jq -e '.executor != null and (.executor | type) == "string" and .executor != ""'

echo "=== 全部验收通过 ==="
```

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|------------|-----------|--------------|----------|
| WS1 | `../../tests/regression/relay-da946af8/relay-smoke-executor.contract.test.js` | B6/B6-env/B6-default/B6-coexist | Red commit 07b456ff (executor 字段缺失致测试失败) |

---

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A）

> 本特性无第三方 API 调用、无真机 RPA、无外部依赖。executor 字段值直接读 process.env，无需 mock。

---

## 接缝清单

（本任务无接缝断言，N/A）

> 端点为纯同步读取 process.env，无真机/外部环境接缝。逻辑断言在单元测试中覆盖，API-level 断言由 curl 命令验证。

---

## 铁律映射（INV 覆盖）

| 铁律 | 对应 INV 条目 | 说明 |
|------|--------------|------|
| 1. 不改动 B1~B5 已有断言 | INV-1（见 contract-dod.md） | B6 测试新文件不修改原合同测试 |
| 2. 端点路径不变 | INV-2（见 contract-dod.md） | GET /api/brain/relay-smoke 路径不变 |
| 3. 无 DB 查询 | INV-3（见 contract-dod.md） | 仅读 process.env，无 pool.query |
| 4. 不修改其他端点逻辑 | INV-4（见 contract-dod.md） | 只改 relay-smoke handler 单行 |

---

*合同版本: Round 1 | Proposer: harness-contract-proposer v9.12.0*
