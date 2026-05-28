# Sprint Contract Draft (Round 2)

## Golden Path
[调用方 GET /health] → [Brain 探活 bridge/accounts（2s 超时）] → [响应含 codex_bridge_status] → [判断 bridge online/offline]

---

### Step 1: 调用方发送 GET /api/brain/health
**来源**: `[FROM_PRD]` — PRD "Golden Path（核心场景）"第 1 步

**可观测行为**: HTTP 200 响应，JSON body 包含 `codex_bridge_status` 字段，值为字面量 `"online"` 或 `"offline"`

**验证命令**:
```bash
# 字段存在且类型为 string
curl -sf localhost:5221/api/brain/health | jq -e '.codex_bridge_status | type == "string"' || { echo "FAIL: codex_bridge_status 字段缺失或类型错误"; exit 1; }
echo OK
```

**硬阈值**: HTTP 200，`codex_bridge_status` 存在且为 string，< 5s

---

### Step 2: Brain 对 XIAN_CODEX_BRIDGE_URL/accounts 发起 2s 超时探活
**来源**: `[FROM_PRD]` — PRD "Golden Path（核心场景）"第 2 步；PRD "假设"第 1 条（探活目标 URL 为 /accounts）

**可观测行为**: Brain 内部发起探活请求，超时 2s，不阻塞整体 health 响应；结果体现在 `codex_bridge_status` 字段

**验证命令**:
```bash
# 值只能是两个字面量之一（不能是 up/down/ok 等禁用变体）
curl -sf localhost:5221/api/brain/health | \
  jq -e '(.codex_bridge_status == "online") or (.codex_bridge_status == "offline")' \
  || { echo "FAIL: codex_bridge_status 值不是合法枚举值"; exit 1; }
echo OK
```

**硬阈值**: `codex_bridge_status` ∈ {"online", "offline"}，无其他值

---

### Step 3: 探活成功 → codex_bridge_status = "online"
**来源**: `[FROM_PRD]` — PRD "Golden Path（核心场景）"第 3 步

**可观测行为**: bridge `/accounts` 返回 2xx → 字段值为字面量 `"online"`

**验证命令**:
```bash
# 禁用变体不存在（null 防护 + IN 检查）
curl -sf localhost:5221/api/brain/health | \
  jq -e '.codex_bridge_status != null and
         (.codex_bridge_status | IN("up","down","ok","reachable","active","unavailable") | not)' \
  || { echo "FAIL: codex_bridge_status 使用了禁用变体"; exit 1; }
echo OK
```

**硬阈值**: `codex_bridge_status` ∉ {"up","down","ok","reachable","active","unavailable"}

---

### Step 4: 探活失败/超时/异常 → codex_bridge_status = "offline"，整体 health 不降级
**来源**: `[FROM_PRD]` — PRD "Golden Path"第 3 步（offline 分支）+ PRD "边界情况"全部 4 条
`[AI_ADDED]` — GAN Round 1 加入：强制验证 catch-all 逻辑覆盖，防止 generator 遗漏 try-catch 导致 bridge 超时 throw 穿透到整体 health 500 响应

**可观测行为**: bridge 探活 timeout/非2xx/throw 时，health 仍返 HTTP 200，`codex_bridge_status` = `"offline"`

**验证命令**:
```bash
# schema 完整性：新增字段与现有必要字段同时存在
curl -sf localhost:5221/api/brain/health | \
  jq -e 'has("codex_bridge_status") and has("status") and has("uptime_seconds")' \
  || { echo "FAIL: schema 不完整，关键字段缺失"; exit 1; }
echo OK
```

**硬阈值**: 响应 keys 包含 `codex_bridge_status`、`status`、`uptime_seconds`

---

### Step 5: 无论 HARNESS_XIAN_ENABLED 取值，字段始终出现
**来源**: `[FROM_PRD]` — PRD "Golden Path（核心场景）"第 4 步
`[AI_ADDED]` — GAN Round 1 加入：防止 generator 用 `if(HARNESS_XIAN_ENABLED)` 条件写入字段，导致 feature flag 关闭时字段缺失

**可观测行为**: 任何情况下 health 端点都返回 `codex_bridge_status`，不依赖环境变量

**验证命令**:
```bash
# 完整链路 E2E 验证（合并 Step 1-5 断言）
RESP=$(curl -sf localhost:5221/api/brain/health) || { echo "FAIL: health 端点不可达"; exit 1; }
echo "$RESP" | jq -e '.codex_bridge_status | type == "string"' || { echo "FAIL: 字段缺失或类型错误"; exit 1; }
echo "$RESP" | jq -e '(.codex_bridge_status == "online") or (.codex_bridge_status == "offline")' || { echo "FAIL: 非法枚举值"; exit 1; }
echo "$RESP" | jq -e '.codex_bridge_status != null and (.codex_bridge_status | IN("up","down","ok","reachable","active","unavailable") | not)' || { echo "FAIL: 使用禁用变体"; exit 1; }
echo "$RESP" | jq -e 'has("codex_bridge_status") and has("status") and has("uptime_seconds")' || { echo "FAIL: schema 不完整"; exit 1; }
echo "✅ Step 1-5 全部验证通过"
```

**硬阈值**: 所有 jq -e 断言通过，exit 0

---

## E2E 验收（final-e2e — target_environment: local_api）

**journey_type**: autonomous
**target_environment**: local_api

```bash
#!/bin/bash
set -e

DB="${DB_URL:-postgresql://localhost/cecelia}"

# 1. 验证 Brain 服务可达
curl -sf localhost:5221/api/brain/health > /dev/null || { echo "FAIL: Brain 不可达 localhost:5221"; exit 1; }

# 2. 获取响应（注入时间戳防止利用缓存造假）
START_TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)
RESP=$(curl -sf localhost:5221/api/brain/health)

# 3. 验证 codex_bridge_status 字段存在且类型正确
echo "$RESP" | jq -e '.codex_bridge_status | type == "string"' \
  || { echo "FAIL: codex_bridge_status 字段缺失或类型错误"; exit 1; }

# 4. 验证值为合法枚举（仅允许 online/offline）
echo "$RESP" | jq -e '(.codex_bridge_status == "online") or (.codex_bridge_status == "offline")' \
  || { echo "FAIL: codex_bridge_status 值非法 — $(echo "$RESP" | jq -r '.codex_bridge_status')"; exit 1; }

# 5. 验证禁用变体不存在（null 防护）
echo "$RESP" | jq -e '.codex_bridge_status != null and
  (.codex_bridge_status | IN("up","down","ok","reachable","active","unavailable") | not)' \
  || { echo "FAIL: codex_bridge_status 使用了禁用变体"; exit 1; }

# 6. 验证 schema 完整性（新字段与现有字段共存）
echo "$RESP" | jq -e 'has("codex_bridge_status") and has("status") and has("uptime_seconds") and has("organs")' \
  || { echo "FAIL: schema 不完整，关键字段缺失"; exit 1; }

# 7. 验证现有 status 字段未被 codex_bridge_status 引入损坏
echo "$RESP" | jq -e '.status | IN("healthy","degraded")' \
  || { echo "FAIL: 现有 status 字段损坏"; exit 1; }

BRIDGE_STATUS=$(echo "$RESP" | jq -r '.codex_bridge_status')
echo "✅ Golden Path 验证通过 — codex_bridge_status=${BRIDGE_STATUS}"
```

---

## Risks

| 风险 | 概率 | 影响 | 缓解方案 |
|---|---|---|---|
| R1: `XIAN_CODEX_BRIDGE_URL` 未设置（本地/CI 无此 env）→ `${undefined}/accounts` URL 解析失败 throw → bridge catch-all 不完整时整体 health 500 | 中 | health 端点 500，运维无法读取任何字段 | goals.js 使用 `??` 默认值：`const bridgeUrl = process.env.XIAN_CODEX_BRIDGE_URL ?? 'http://100.86.57.69:3458'`；Generator 必须在 catch-all 内确保任何 URL 解析异常均写 `"offline"` 不 rethrow |
| R2: bridge 探活 fetch 抛异常穿透（如 Node.js fetch 未初始化、或 AbortController timeout 实现差异）→ unhandled promise rejection → `/health` 路由返回 500 | 低 | health 端点 500，影响整个运维可观测性链路 | `try { ... } catch { codex_bridge_status = 'offline' }` 包裹整个探活逻辑，不能只 catch fetch 返回非 2xx；WS2 集成测试专门验证 throw 分支 catch 有效性 |

---

## Workstreams

workstream_count: 2

### Workstream 1: goals.js /health 路由新增 codex_bridge_status 探活字段

**范围**: `packages/brain/src/routes/goals.js` — `/health` handler 内新增 bridge 探活逻辑：对 `${XIAN_CODEX_BRIDGE_URL}/accounts`（默认 `http://100.86.57.69:3458`）发起 `AbortSignal.timeout(2000)` 超时 fetch，2xx → `"online"`，任何失败/超时/throw catch 后写 `"offline"`；探活与其他 Promise.all 并行执行，不改变现有字段
**大小**: S (<100 行净增，1 文件)
**依赖**: 无

**Contract DoD**: `sprints/codex-xian-verify/contract-dod-ws1.md`

---

### Workstream 2: 新建 health-codex-bridge-status 集成测试

**范围**: 新建 `packages/brain/src/__tests__/integration/health-codex-bridge-status.integration.test.js` — mock `global.fetch`，覆盖 online/offline/timeout/throw 四个分支，验证 `codex_bridge_status` 字段值和 schema 完整性
**大小**: M (100-200 行净增，1 文件)
**依赖**: Workstream 1 完成后

**Contract DoD**: `sprints/codex-xian-verify/contract-dod-ws2.md`

---

## Workstreams 切分说明

总净增 ≈ 20 LoC（ws1）+ 130 LoC（ws2）= 150 LoC < 200 行，允许合并为 ws1，但为清晰分离实现与测试，保留 2 个 ws：
- ws1: 1 文件，~20 行净增，S 级
- ws2: 1 文件，~130 行净增，M 级
- ws2 depends_on ws1（测试需要实现存在）

---

## Test Contract

| Workstream | 产物路径 | BEHAVIOR 覆盖 | 红证据（实测） |
|---|---|---|---|
| WS1 | `packages/brain/src/routes/goals.js` | codex_bridge_status 字段 + 探活 URL + offline fallback | 3 failures（见下方）|
| WS2 | `packages/brain/src/__tests__/integration/health-codex-bridge-status.integration.test.js` | online/offline/timeout/throw 四分支覆盖 + schema 完整性 | 3 failures（见下方）|

### WS1 红证据（实测 vitest 输出）

```
 × [WS1 Red] goals.js /health codex_bridge_status 字段 > goals.js /health handler 包含 codex_bridge_status 字段写入
   AssertionError: expected 'import { Router } from 'express';\n…' to contain 'codex_bridge_status'

 × [WS1 Red] goals.js /health codex_bridge_status 字段 > goals.js /health handler 包含 bridge 探活 URL（XIAN_CODEX_BRIDGE_URL 或默认值）
   AssertionError: expected 'import { Router } from 'express';\n…' to match /XIAN_CODEX_BRIDGE_URL|100\.86\.57\.69/

 × [WS1 Red] goals.js /health codex_bridge_status 字段 > goals.js /health handler 包含 offline fallback（catch 分支写 "offline"）
   AssertionError: expected 'import { Router } from 'express';\n…' to contain '\'offline\''

 Test Files  1 failed (1)  Tests  3 failed (3)
```

**红测试路径**: `sprints/codex-xian-verify/tests/ws1/health-codex-bridge-ws1.test.ts`

### WS2 红证据（实测 vitest 输出）

```
 × [WS2 Red] health-codex-bridge-status 集成测试文件 > 测试文件存在
   AssertionError: expected false to be true

 × [WS2 Red] health-codex-bridge-status 集成测试文件 > 测试文件包含 online 分支测试
   AssertionError: expected '' to contain '"online"'

 × [WS2 Red] health-codex-bridge-status 集成测试文件 > 测试文件包含 offline 分支测试
   AssertionError: expected '' to contain '"offline"'

 Test Files  1 failed (1)  Tests  3 failed (3)
```

**红测试路径**: `sprints/codex-xian-verify/tests/ws2/health-codex-bridge-ws2.test.ts`
