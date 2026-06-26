# Sprint Contract Draft (Round 1)

**Sprint**: Brain 只读自检端点 `GET /api/brain/harness-selftest`
**journey_type**: autonomous
**target_environment**: local_api

---

## 已知约束（来自回归测试）

- [`packages/brain/src/__tests__/integration/critical-routes.integration.test.js`] → `GET /api/brain/health` 返回 200 且含 status 字段；`/context` 含 SQL JOIN 曾有 bug，回归覆盖在案
- [`packages/brain/src/__tests__/smoke.test.js`] → `GET /api/brain/health returns 200 with status field`
- 路由聚合约定：`packages/brain/src/routes.js` 中第一批 router 通过 `router.stack.push(...subRouter.stack)` 平铺到 `/api/brain/` 根前缀；新增顶层只读路由（路径 `/api/brain/harness-selftest`，非 `/harness/*` 子树）应走同一批平铺挂载或在该前缀下注册。

> 约束含义：本次新增**绝不能**影响 `/api/brain/health`、`/api/brain/context` 等既有端点行为（PRD「不在范围内」+ E2E 验收点）。

---

## Response Schema（推导来源: PRD字面 — registry 不可达，按 PRD 明确定义 + status.js 只读端点惯例）

### Endpoint: GET /api/brain/harness-selftest

**Success (HTTP 200)**:
```json
{"ok": true, "service": "harness"}
```
- `ok` (boolean, 必填): 来源——PRD「可观测结果」明确 `ok === true`。固定真值，不依赖运行时状态。
- `service` (string, 必填): 来源——PRD「可观测结果」明确 `service === "harness"`。固定字面量 `"harness"`。

**顶层 keys 完整集合**: 必须**恰好等于** `["ok", "service"]`（jq `keys` 字典序）。
PRD「不在范围内」明确：**不得在响应中暴露动态运行时状态（版本、时间戳等）**。

**禁用字段名**（响应中绝不允许出现，来自 PRD「不在范围内」+ 同类只读探针的动态字段同义词）:
`version`, `timestamp`, `time`, `ts`, `status`, `uptime`, `db`, `database`, `now`, `pid`

**Error**: `N/A — 端点无参数、无鉴权、无 DB 依赖，不存在 4xx/5xx 业务错误路径`。
负向验证改以「路由必须真注册（非 catch-all 404）」+「幂等」+「DB 无关仍 200」承担（见 Golden Path Step 边界）。

**Content-Type**: `application/json`（PRD [ASSUMPTION]）。

---

## Golden Path

[调用方发起 GET 请求] → [Brain 命中只读自检路由，零 DB、零副作用] → [返回固定 JSON `{ok:true, service:"harness"}`，HTTP 200]

---

### Step 1: 调用方对 Brain 发起 `GET /api/brain/harness-selftest`
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 1 条 + 「范围内」第 1 条直接定义。

**可观测行为**: 对运行中的 Brain（localhost:5221）发起 GET，路由命中并返回 HTTP 200（不是通用 404 catch-all）。

**验证命令**:
```bash
# 路由必须真注册：404 = 路由未实现 = FAIL（不接受 "404-acceptable" 旁路）
CODE=$(curl -s -o /dev/null -w "%{http_code}" localhost:5221/api/brain/harness-selftest)
[ "$CODE" = "200" ] || { echo "FAIL: 期望 200，实际 $CODE（404=路由未注册）"; exit 1; }
echo OK
```

**硬阈值**: HTTP 状态码 = 200。
**对应可执行命令**: 见上 `CODE=$(... -w "%{http_code}")` + `[ "$CODE" = "200" ]`。

---

### Step 2: Brain 命中只读路由，组装固定响应（零 DB、零副作用、幂等）
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 2 条「不查数据库、不触发任何副作用，组装固定响应」+「边界情况」幂等。

**可观测行为**: 连续多次调用返回**完全相同**的响应体（无状态、幂等）；端点不依赖数据库，即使 Brain 数据库异常也照常返回固定 JSON。

**验证命令**:
```bash
# 幂等：两次连续调用响应体逐字节一致
A=$(curl -sf localhost:5221/api/brain/harness-selftest) || { echo "FAIL: 第1次请求失败"; exit 1; }
B=$(curl -sf localhost:5221/api/brain/harness-selftest) || { echo "FAIL: 第2次请求失败"; exit 1; }
[ "$A" = "$B" ] || { echo "FAIL: 非幂等 A=$A B=$B"; exit 1; }
echo "$A" | jq -e 'has("ok") and has("service")' || { echo "FAIL: 响应缺固定字段"; exit 1; }
echo OK
```

**硬阈值**: 两次响应体逐字节一致，且含固定字段 `ok`/`service`。
**对应可执行命令**: 见上 `[ "$A" = "$B" ]`。

---

### Step 3: 拿到固定自检 JSON —— `ok === true` 且 `service === "harness"`，无动态状态泄漏
**来源**: `[FROM_PRD]` — PRD「可观测结果」`ok === true`、`service === "harness"` + 「不在范围内」不暴露动态运行时状态。

**可观测行为**: 响应体 JSON `ok` 为布尔真、`service` 为字符串 `"harness"`，顶层 keys 恰好 `["ok","service"]`，不含 version/timestamp 等动态字段。

**验证命令**:
```bash
RESP=$(curl -sf localhost:5221/api/brain/harness-selftest) || { echo "FAIL: 请求失败"; exit 1; }
echo "$RESP" | jq -e '.ok == true' || { echo "FAIL: ok != true → $RESP"; exit 1; }
echo "$RESP" | jq -e '.service == "harness"' || { echo "FAIL: service != harness → $RESP"; exit 1; }
echo "$RESP" | jq -e 'keys == ["ok","service"]' || { echo "FAIL: keys 非恰好 [ok,service]（疑似泄漏动态状态）→ $RESP"; exit 1; }
echo "$RESP" | jq -e '(has("version") or has("timestamp") or has("status")) | not' || { echo "FAIL: 含禁用动态字段 → $RESP"; exit 1; }
echo OK
```

**硬阈值**: `ok === true`；`service === "harness"`；`keys == ["ok","service"]`；无 version/timestamp/status。
**对应可执行命令**: 见上四条 `jq -e`。

---

### Step 4 (Regression): 既有端点行为不变
**来源**: `[FROM_PRD]` — PRD「不在范围内」「修改、删除或影响任何现有端点 / 行为」+ E2E 验收点「确认现有任一既有端点（如 /api/brain/context）行为不变」。

**可观测行为**: 新增路由后，`/api/brain/health` 仍返回 200 且含 `status` 字段（既有契约不破）。

**验证命令**:
```bash
HEALTH=$(curl -sf localhost:5221/api/brain/health) || { echo "FAIL: /health 不可达（既有端点被破坏）"; exit 1; }
echo "$HEALTH" | jq -e 'has("status")' || { echo "FAIL: /health 缺 status 字段 → 既有契约被破坏"; exit 1; }
echo OK
```

**硬阈值**: `/api/brain/health` 返回 200 且含 `status` 字段。
**对应可执行命令**: 见上。

---

## 接缝清单（接缝 vs 逻辑断言分型）

本 Sprint **无环境相关接缝**——纯进程内 Express 路由，返回固定常量，不碰真机、不碰生产 env、不碰真实外部调用方。
- **逻辑断言（环境无关，CI/单测绿即真 done）**: Step 1~4 全部 —— 路由注册、固定 JSON 值、keys 完整性、幂等、既有端点回归。均可在本地运行中的 Brain（localhost:5221）用 curl+jq 确定性验证。
- **接缝断言**: 无（清单为空）。故无 `logic-done-pending` 项，所有 DoD 可直接判 done。

---

## E2E 验收（最终 final-e2e 跑 — target_environment = local_api）

**journey_type**: autonomous
**target_environment**: local_api

```bash
#!/bin/bash
# final-e2e — Brain 只读自检端点 Golden Path 全程（evaluator 在本机对运行中的 Brain 执行）
set -e

BASE="${BRAIN_URL:-localhost:5221}"

# ── Step 1: 路由真注册（200，非 catch-all 404）──────────────────────────────
CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/brain/harness-selftest")
[ "$CODE" = "200" ] || { echo "FAIL[Step1]: 期望 200 实际 $CODE（404=路由未注册）"; exit 1; }

# ── Step 3: 固定 JSON 内容断言 ───────────────────────────────────────────────
RESP=$(curl -sf "$BASE/api/brain/harness-selftest")
echo "$RESP" | jq -e '.ok == true'                 || { echo "FAIL[Step3]: ok!=true → $RESP"; exit 1; }
echo "$RESP" | jq -e '.service == "harness"'        || { echo "FAIL[Step3]: service!=harness → $RESP"; exit 1; }
echo "$RESP" | jq -e 'keys == ["ok","service"]'     || { echo "FAIL[Step3]: keys 非恰好 [ok,service] → $RESP"; exit 1; }
echo "$RESP" | jq -e '(has("version") or has("timestamp") or has("status")) | not' || { echo "FAIL[Step3]: 泄漏动态字段 → $RESP"; exit 1; }

# ── Step 2: 幂等（两次逐字节一致）────────────────────────────────────────────
A=$(curl -sf "$BASE/api/brain/harness-selftest")
B=$(curl -sf "$BASE/api/brain/harness-selftest")
[ "$A" = "$B" ] || { echo "FAIL[Step2]: 非幂等 A=$A B=$B"; exit 1; }

# ── Step 1 (Content-Type): application/json ──────────────────────────────────
CT=$(curl -s -o /dev/null -w "%{content_type}" "$BASE/api/brain/harness-selftest")
echo "$CT" | grep -qi "application/json" || { echo "FAIL: Content-Type 非 application/json → $CT"; exit 1; }

# ── Step 4: 既有端点回归（/health 不变）──────────────────────────────────────
HEALTH=$(curl -sf "$BASE/api/brain/health") || { echo "FAIL[Step4]: /health 不可达（既有端点被破坏）"; exit 1; }
echo "$HEALTH" | jq -e 'has("status")' || { echo "FAIL[Step4]: /health 缺 status → 既有契约被破坏"; exit 1; }

echo "✅ Golden Path 验证通过（local_api）"
```

**通过标准**: 脚本 exit 0。

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 只读自检端点 | `tests/harness-selftest.test.ts` | 路由 200 / ok==true / service=="harness" / keys 恰好 [ok,service] / 无动态字段 / 幂等 | 路由文件未实现 → 动态 import 失败或 404 → N failures |
