# 合同草案 — 背靠背裁剪 D3（服务端读写隔离 + 三 token 分权 + 5223 休眠）

## 元信息

- **task_id**: 0b7df1ca-da50-4928-9d24-bfbb8ae7cd90
- **gp_id**: 7790f728-f490-4243-b166-03f3250a0938
- **sprint_dir**: sprints/w2-backtoback-d3
- **合同轮次**: R1（首轮提案）
- **生成时间**: 2026-08-07
- **目标环境**: local_api（curl localhost:5221 + psql cecelia）

---

## 背景与范围

D1 已上主干（cecelia 1.270.0）：ai_verdict/ai_evidence/ai_run_at 三列 / 7 值状态机 / POST /ai-results（AI token 专用）/ 收单闸 / scenario_not_triggered 任何格 400。

**本合同只覆盖 D3 新增交付能力**，不重复验收 D1 已定案能力，不触碰 D2/D4。

---

## Invariant 锁定

| # | 铁律 | 来源 |
|---|---|---|
| I-1 | AI 列与人列是同表两组独立列，不得合并写入路径 | decisions fdeb48aa ① |
| I-2 | 员工填表时不可见 AI 判定列（读侧默认不 SELECT AI 三列） | decisions fdeb48aa ② |
| I-3 | scenario_not_triggered 任何格均 400（D1 已实现，D3 不得回退） | decisions 8640ef58 ② |
| I-4 | S13-c4 fail-closed；该格为绿必须经有名有姓裁决，无绿通道 | decisions 8640ef58 ③ |
| I-5 | AI job secrets 白名单只含 ACCEPTANCE_AI_TOKEN；ACCEPTANCE_API_TOKEN 移出 AI 车道 | GP v7-final Gate A ⑤ |
| I-6 | 三钥匙任一缺失只降级对应端点，不拖挂整个 listener | GP v7-final Gate B ③ |
| I-7 | 本版只做读写隔离+三 token 分权+5223 休眠；不改 D2/D4 | GP v7-final D3 |
| I-8 | 端点下线 = 解挂路由不删码，改返 410 | 决策 fc7b5dc0 |

---

## 功能合同

### FC-1：SQL 列白名单（loadChecks / loadRunsWithChecks）

**范围文件**：`packages/brain/src/routes/acceptance.js`

**行为约定**：
- `loadChecks` 从 `SELECT *` 改为显式列白名单，默认不含 ai_verdict / ai_evidence / ai_run_at 三列
- 接收 `{ includeAi: boolean }` 参数，`includeAi=true` 时才追加 AI 三列到 SELECT 列表
- `loadRunsWithChecks` 和 `loadPendingRuns` 透传此参数，默认 `includeAi=false`

**可验证断言**：
- `GET /api/brain/acceptance/pending` 返回的 checks 数组中，每个元素**不含** `ai_verdict`、`ai_evidence`、`ai_run_at` 字段
- `GET /api/brain/acceptance/pending?view=ai`（携带 gate token）返回的 checks 含 AI 三列

---

### FC-2：view 参数 + 服务端 human_complete 校验

**范围文件**：`packages/brain/src/routes/acceptance.js`

**行为约定**：
- 读侧端点支持 `?view=ai` 查询参数；携带有效 gate token 时透出 AI 三列（不携带则忽略 view=ai）
- `POST /api/brain/acceptance/results` 加服务端校验：`run.status` 须在 `('pending','in_review')` 内，否则返回 409
- 此校验在服务端强制执行，不依赖前端隐藏

**可验证断言**：
- 对 `status=adjudicated` 的 run 调用 `POST /results` → HTTP 409
- 对 `status=pending` 的 run 调用 `POST /results`（payload 合法） → HTTP 200

---

### FC-3：gp 级跨轮闸——活跃 run 谓词

**范围文件**：`packages/brain/src/routes/acceptance.js`（POST /runs 建单端点）

**行为约定**：
- 建单前的 gp 级活跃 run 检查谓词改为 `status IN ('pending','in_review')`
- adjudicated / stale 状态的历史 run 不阻拦新建单
- 与 `loadPendingRuns` 的查询范围完全对齐

**可验证断言**：
- 同一 gp_id 下存在 `status=pending` 的 run 时，新建单 → HTTP 409
- 同一 gp_id 下仅存在 `status=adjudicated` 的 run 时，新建单 → HTTP 201

---

### FC-4：9 条读侧出口覆盖 + 反向断言

**范围文件**：`packages/brain/src/__tests__/acceptance-read-outlets.test.js`（新建）

**行为约定（覆盖出口清单）**：

内网（5221）：
1. `GET /api/brain/acceptance/pending`
2. `GET /api/brain/acceptance/runs?gp_id=<id>`
3. `GET /api/brain/acceptance/runs/:run_key`
4. `GET /api/brain/acceptance/runs/:run_key/checks`
5. `loadRunsWithChecks` 函数
6. `loadPendingRuns` 函数

公网（5223）：
7. `GET /acceptance/pending`
8. `GET /acceptance/catalog`
9. `POST /acceptance/pending`（如有）

**反向断言**：adjudicated 与 stale run 并存时，`GET /runs?gp_id` 返回结果**包含** adjudicated run（已定案轮不被过滤）。

---

### FC-5：createBearerAuth 下沉路由级 + 三 token 分权

**范围文件**：`acceptance-ai.js`、`acceptance-public-server.js`

**行为约定**：

| token | 环境变量 | 授权端点 |
|---|---|---|
| AI token | `ACCEPTANCE_AI_TOKEN` | POST /api/brain/acceptance/ai-results |
| gate token | `ACCEPTANCE_GATE_TOKEN` | GET /acceptance/pending、GET /acceptance/catalog（5223 只读） |
| 既有 token | `ACCEPTANCE_API_TOKEN` | 内网 5221 全部端点（不变） |

- 三钥匙任一缺失：只降级对应端点（不挂载），不拖挂 listener（fail-closed）
- `createBearerAuth` 从 listener 级下沉到路由级，每条端点独立绑定

**可验证断言**：
- AI token + `POST /ai-results` → HTTP 200（合法 payload）
- gate token + `GET /acceptance/pending`（5223）→ HTTP 200
- gate token + `POST /acceptance/results`（5223 公网）→ HTTP 410（休眠端点，非 401；休眠优先于鉴权）
- gate token + `POST /api/brain/acceptance/results`（5221 内网）→ HTTP 401（无内网写权限）
- ACCEPTANCE_API_TOKEN + `POST /ai-results` → HTTP 401（AI token 独享）

---

### FC-6：5223 公网写端点休眠（410 Gone）

**范围文件**：`packages/brain/src/routes/acceptance.js`（createAcceptancePublicRouter）

**行为约定**：
- 公网写端点 `POST /acceptance/results` 改返 HTTP 410 Gone
- 路由以注释形式保留代码（不删除），注明决策编号 fc7b5dc0
- 只读 `GET /acceptance/pending` 保留，绑定 gate token
- 响应体：`{ "error": "endpoint_retired", "hint": "已休眠，通过内网 5221 写入" }`

**可验证断言**：
- `POST localhost:5223/acceptance/results` → HTTP 410（无论携带何 token）
- `GET localhost:5223/acceptance/pending`（携带有效 gate token）→ HTTP 200

---

### FC-7：写侧 token 隔离——AI token 写人列必 4xx

**范围文件**：`packages/brain/src/__tests__/acceptance-token-isolation.test.js`（新建）

**行为约定**：
- AI token 尝试写 `result` / `submitted_by` / `decided_at` 任一人列 → 4xx
- gate token 尝试任何写操作 → 4xx
- ACCEPTANCE_API_TOKEN 尝试 `POST /ai-results` → HTTP 401

**可验证断言**：
- AI token + 写 result 字段 → HTTP 4xx（403 或 400）
- gate token + POST /results → HTTP 401 或 404
- ACCEPTANCE_API_TOKEN + POST /ai-results → HTTP 401

---

## E2E 验收

以下 7 条验收项须全部通过，以 `curl localhost:5221` + `curl localhost:5223` + `psql cecelia` 为执行环境：

### E2E-1：列白名单有效

```bash
TOKEN="$ACCEPTANCE_API_TOKEN"
RESP=$(curl -sf -H "Authorization: Bearer $TOKEN" http://localhost:5221/api/brain/acceptance/pending)
echo "$RESP" | node -e "
  const data = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
  const checks = (data.runs || data).flatMap(r => r.checks || []);
  const leaked = checks.filter(c => 'ai_verdict' in c || 'ai_evidence' in c || 'ai_run_at' in c);
  if (leaked.length > 0) { console.error('FAIL: AI 列泄漏', leaked[0]); process.exit(1); }
  console.log('PASS: checks 不含 AI 三列，共', checks.length, '格');
"
```

**预期**：脚本输出 `PASS`，exit 0。

### E2E-1b：view=ai 正向验证（AI 三列出现）

```bash
GATE_TOKEN="$ACCEPTANCE_GATE_TOKEN"
RESP=$(curl -sf -H "Authorization: Bearer $GATE_TOKEN" \
  "http://localhost:5221/api/brain/acceptance/pending?view=ai")
echo "$RESP" | node -e "
  const data = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
  const checks = (data.runs || data).flatMap(r => r.checks || []);
  if (checks.length === 0) {
    console.log('SKIP: 无 check 数据，跳过 view=ai 验证');
    process.exit(0);
  }
  const withAi = checks.filter(c => 'ai_verdict' in c);
  if (withAi.length === 0) {
    console.error('FAIL: view=ai + gate token 但 AI 三列未出现（checks 共', checks.length, '条）');
    process.exit(1);
  }
  console.log('PASS: view=ai 返回 AI 三列，含 ai_verdict 的 check 共', withAi.length, '条');
"
```

**预期**：脚本输出 `PASS`（或 `SKIP` 若数据库无 check），exit 0。

### E2E-2：adjudicated run 拒绝人列回写（409）

```bash
# 需要有一个 status=adjudicated 的 run，将 RUN_KEY 替换为实际值
RUN_KEY="<adjudicated-run-key>"
TOKEN="$ACCEPTANCE_API_TOKEN"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
  -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"run_key":"'"$RUN_KEY"'","results":[{"check_key":"S1-c1","result":"通过"}]}' \
  http://localhost:5221/api/brain/acceptance/results)
[ "$STATUS" = "409" ] && echo "PASS: adjudicated run 返回 409" || echo "FAIL: 期望 409，实际 $STATUS"
```

**预期**：输出 `PASS`。

### E2E-3：gp 级跨轮闸

```bash
# 3a：存在 pending run 时建单 → 409
GP_ID="7790f728-f490-4243-b166-03f3250a0938"
TOKEN="$ACCEPTANCE_API_TOKEN"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
  -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"gp_id":"'"$GP_ID"'"}' \
  http://localhost:5221/api/brain/acceptance/runs)
[ "$STATUS" = "409" ] && echo "PASS E2E-3a: pending run 阻拦 → 409" || echo "INFO E2E-3a: $STATUS（若无 pending run 则跳过此项）"

# 3b：仅存在 adjudicated run 时建单 → 201
# 先将当前 pending run 强制标记为 adjudicated（仅测试环境），再尝试建单
GP_ID_ADJ="${GP_ID_ADJ:-$GP_ID}"
TOKEN="$ACCEPTANCE_API_TOKEN"
# 构造：将已有 run 设为 adjudicated（测试环境直接通过 psql，或通过内部接口）
# 若已有 adjudicated run，直接建单验证
STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
  -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "{\"gp_id\":\"$GP_ID_ADJ\"}" \
  http://localhost:5221/api/brain/acceptance/runs)
[ "$STATUS" = "201" ] && echo "PASS E2E-3b: adjudicated run 不阻拦新建单 → 201" \
  || echo "FAIL E2E-3b: 期望 201，实际 $STATUS（请确认 gp_id 下无 pending/in_review run）"
```

### E2E-4：adjudicated run 在读侧可见

```bash
GP_ID="<gp-id-with-adjudicated-and-stale>"
TOKEN="$ACCEPTANCE_API_TOKEN"
RESP=$(curl -sf -H "Authorization: Bearer $TOKEN" \
  "http://localhost:5221/api/brain/acceptance/runs?gp_id=$GP_ID")
echo "$RESP" | node -e "
  const runs = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
  const adj = runs.filter(r => r.status === 'adjudicated');
  if (adj.length === 0) { console.error('FAIL: adjudicated run 被过滤'); process.exit(1); }
  console.log('PASS: adjudicated run 可见，共', adj.length, '条');
"
```

### E2E-5：AI token 写人列 → 4xx

```bash
AI_TOKEN="$ACCEPTANCE_AI_TOKEN"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
  -X POST -H "Authorization: Bearer $AI_TOKEN" -H "Content-Type: application/json" \
  -d '{"run_key":"dummy","results":[{"check_key":"S1-c1","result":"通过"}]}' \
  http://localhost:5221/api/brain/acceptance/results)
[ "${STATUS:0:1}" = "4" ] && echo "PASS: AI token 写人列 → $STATUS" || echo "FAIL: 期望 4xx，实际 $STATUS"
```

### E2E-6：5223 写端点休眠（410）

```bash
STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
  -X POST -H "Content-Type: application/json" \
  -d '{}' \
  http://localhost:5223/acceptance/results)
[ "$STATUS" = "410" ] && echo "PASS: 5223 写端点返回 410 Gone" || echo "FAIL: 期望 410，实际 $STATUS"
```

### E2E-7：npm test 全绿

```bash
cd /workspace && npm test --workspace=packages/brain -- \
  --testPathPattern="acceptance-read-outlets|acceptance-token-isolation" \
  2>&1 | tail -20
# 预期：Test Suites: 2 passed, 2 total；Tests: N passed, N total
```

---

## 交付物与文件映射

| 文件 | 类型 | 关联 FC |
|---|---|---|
| `packages/brain/src/routes/acceptance.js` | 修改 | FC-1/2/3 |
| `packages/brain/src/routes/acceptance-ai.js` | 修改（AI token 路由级中间件） | FC-5 |
| `packages/brain/src/acceptance-public-server.js` | 修改（gate token + 410 休眠） | FC-5/6 |
| `packages/brain/src/__tests__/acceptance-read-outlets.test.js` | 新建 | FC-4 |
| `packages/brain/src/__tests__/acceptance-token-isolation.test.js` | 新建 | FC-7 |

---

## 不在范围内（明确排除）

- D1 已验收能力（AI 三列结构、7 值状态机、POST /ai-results 基础路由、scenario_not_triggered 400）
- D2（数据分层）
- D4（决策通道）
- 任何前端/Dashboard 改动
- 数据库 schema 变更（D3 不新增 migration）
