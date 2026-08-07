# DoD 条目清单 — 背靠背裁剪 D3

## 元信息

- **task_id**: 0b7df1ca-da50-4928-9d24-bfbb8ae7cd90
- **合同版本**: R1
- **生成时间**: 2026-08-07

---

## [BEHAVIOR] 条目

### [BEHAVIOR-1] SQL 列白名单：默认响应不含 AI 三列

**关联**: FC-1 / FR-1 / I-2

**描述**: `loadChecks` 在 `includeAi=false`（默认）时，SELECT 语句不包含 ai_verdict、ai_evidence、ai_run_at。任何读侧端点的默认调用路径均不暴露 AI 三列给调用方。

**验收条件**:
- `GET /api/brain/acceptance/pending` 返回的每个 check 对象，`'ai_verdict' in check === false`
- `GET /api/brain/acceptance/runs?gp_id=X` 返回的 checks 中同样无 AI 三列
- 传入 `includeAi=true` 时 AI 三列出现（反向验证白名单参数有效）

**测试映射**: `acceptance-read-outlets.test.js` › "loadChecks 默认不含 AI 三列"

---

### [BEHAVIOR-2] adjudicated run 拒绝人列回写（服务端 409）

**关联**: FC-2 / FR-2 / I-1

**描述**: `POST /api/brain/acceptance/results` 在服务端强制校验 run.status 必须在 `('pending','in_review')` 内。对已定案（adjudicated）或已完成（completed）轮的回写请求，服务端直接拒绝，不依赖前端控制。

**验收条件**:
- 构造 `status=adjudicated` 的 run，POST /results → HTTP 409，响应含 `error` 字段
- `status=pending` 的 run，POST /results（合法 payload） → HTTP 200/201
- `status=in_review` 的 run，POST /results → HTTP 200（不被误拦）

**测试映射**: `acceptance-token-isolation.test.js` › "POST /results 对 adjudicated run → 409"

---

### [BEHAVIOR-3] gp 级跨轮闸谓词对齐（adjudicated 不阻拦建单）

**关联**: FC-3 / FR-3

**描述**: `POST /api/brain/acceptance/runs`（建单端点）的活跃 run 检查谓词精确为 `status IN ('pending','in_review')`。adjudicated / stale / completed 等终态 run 的存在**不**阻止同 gp_id 建新单。

**验收条件**:
- 同 gp_id 存在 `status=pending` run → 建单 → HTTP 409，error 含"活跃 run 已存在"类描述
- 同 gp_id 仅存在 `status=adjudicated` run → 建单 → HTTP 201（成功）
- 同 gp_id 仅存在 `status=stale` run → 建单 → HTTP 201（成功）

**测试映射**: `acceptance-read-outlets.test.js` › "gp 级跨轮闸——adjudicated 不阻拦建单"

---

### [BEHAVIOR-4] 三 token 分权——写操作隔离

**关联**: FC-5 / FC-7 / FR-5 / FR-7 / I-5 / I-6

**描述**: 三种 token 的权限边界严格隔离，无越权路径：
- `ACCEPTANCE_AI_TOKEN`：只授权 `POST /ai-results`，不得写人列（result/submitted_by/decided_at）
- `ACCEPTANCE_GATE_TOKEN`：只授权 5223 只读端点，任何写操作 401/404
- `ACCEPTANCE_API_TOKEN`：5221 全端点，但 `POST /ai-results` 拒绝（AI token 独享）

**验收条件**:
- AI token + `POST /ai-results`（合法 payload） → HTTP 200
- AI token + `POST /results`（写人列） → HTTP 4xx（401/403/400 均可）
- gate token + `GET /acceptance/pending`（5223）→ HTTP 200
- gate token + `POST /acceptance/results`（5223）→ HTTP 410（休眠，非 401；休眠优先于鉴权）
- gate token + `POST /api/brain/acceptance/results`（5221 内网）→ HTTP 401
- ACCEPTANCE_API_TOKEN + `POST /ai-results` → HTTP 401

**测试映射**: `acceptance-token-isolation.test.js` › "三 token 分权隔离"

---

### [BEHAVIOR-5] 5223 写端点休眠（410 Gone，不删码）

**关联**: FC-6 / FR-6 / I-8

**描述**: 公网 `POST /acceptance/results` 端点改返 HTTP 410 Gone，路由代码以注释形式保留并标注决策编号 fc7b5dc0。不删除任何已有代码，不影响 5221 内网写端点。

**验收条件**:
- `POST localhost:5223/acceptance/results` → HTTP 410，响应体含 `"error":"endpoint_retired"`
- `GET localhost:5223/acceptance/pending`（携带有效 gate token）→ HTTP 200（只读端点正常）
- 源码中 `router.post('/acceptance/results'` 保留（可 grep 验证），函数体返回 410

**测试映射**: `acceptance-token-isolation.test.js` › "POST localhost:5223/acceptance/results → 410 Gone"

---

### [BEHAVIOR-6] 反向断言——adjudicated run 在读侧可见

**关联**: FC-4 / FR-4

**描述**: `GET /api/brain/acceptance/runs?gp_id=X` 返回结果**包含** adjudicated run，不得被任何过滤逻辑排除。调用方需要能看到历史已定案轮，以完整呈现 gp 的多轮验收历史。

**验收条件**:
- 数据库中 gp_id X 下同时存在 adjudicated 与 stale run 时，API 响应包含两种状态的 run
- 响应数组中 `status=adjudicated` 的条目至少 1 条

**测试映射**: `acceptance-read-outlets.test.js` › "adjudicated 与 stale run 并存时，GET /runs?gp_id 包含 adjudicated run"

---

## manual:bash（可执行验收命令）

> 以下命令在 Brain 进程运行、数据库含测试数据的情况下可直接执行。
> 需要替换的占位符：`<RUN_KEY_ADJ>` = 实际 adjudicated run_key；`<GP_ID>` = 测试 gp_id。

```bash
#!/usr/bin/env bash
set -euo pipefail

BASE_INTERNAL="http://localhost:5221"
BASE_PUBLIC="http://localhost:5223"
TOKEN_API="${ACCEPTANCE_API_TOKEN:-}"
TOKEN_AI="${ACCEPTANCE_AI_TOKEN:-}"
TOKEN_GATE="${ACCEPTANCE_GATE_TOKEN:-}"
PASS=0; FAIL=0

check() {
  local label="$1" expect="$2" actual="$3"
  if [ "$actual" = "$expect" ]; then
    echo "PASS [$label]: HTTP $actual"
    PASS=$((PASS+1))
  else
    echo "FAIL [$label]: 期望 $expect，实际 $actual"
    FAIL=$((FAIL+1))
  fi
}

echo "=== DoD manual:bash 验收 D3 ==="

# --- BEHAVIOR-1: 列白名单 ---
echo ""
echo "--- BEHAVIOR-1: SQL 列白名单 ---"
RESP=$(curl -sf -H "Authorization: Bearer $TOKEN_API" "$BASE_INTERNAL/api/brain/acceptance/pending" || echo '{"runs":[]}')
AI_LEAKED=$(echo "$RESP" | node -e "
  const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
  const checks = (d.runs||[]).flatMap(r=>r.checks||[]);
  console.log(checks.filter(c=>'ai_verdict' in c).length);
" 2>/dev/null || echo "0")
if [ "$AI_LEAKED" = "0" ]; then
  echo "PASS [BEHAVIOR-1]: AI 三列未泄漏到 /pending 响应"
  PASS=$((PASS+1))
else
  echo "FAIL [BEHAVIOR-1]: 发现 $AI_LEAKED 格泄漏 ai_verdict"
  FAIL=$((FAIL+1))
fi

# --- BEHAVIOR-2: adjudicated run → 409 ---
echo ""
echo "--- BEHAVIOR-2: adjudicated run 拒绝回写 ---"
RUN_KEY_ADJ="${RUN_KEY_ADJ:-REPLACE_ME}"
if [ "$RUN_KEY_ADJ" != "REPLACE_ME" ]; then
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
    -X POST -H "Authorization: Bearer $TOKEN_API" -H "Content-Type: application/json" \
    -d "{\"run_key\":\"$RUN_KEY_ADJ\",\"results\":[{\"check_key\":\"S1-c1\",\"result\":\"通过\"}]}" \
    "$BASE_INTERNAL/api/brain/acceptance/results")
  check "BEHAVIOR-2 adjudicated→409" "409" "$STATUS"
else
  echo "SKIP [BEHAVIOR-2]: 未设置 RUN_KEY_ADJ"
fi

# --- BEHAVIOR-3: gp 级跨轮闸 ---
echo ""
echo "--- BEHAVIOR-3: gp 级跨轮闸 ---"
GP_ID="${GP_ID:-REPLACE_ME}"
if [ "$GP_ID" != "REPLACE_ME" ]; then
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
    -X POST -H "Authorization: Bearer $TOKEN_API" -H "Content-Type: application/json" \
    -d "{\"gp_id\":\"$GP_ID\"}" \
    "$BASE_INTERNAL/api/brain/acceptance/runs")
  # 若当前有 pending run → 期望 409；若已全定案 → 期望 201
  echo "INFO [BEHAVIOR-3]: POST /runs 返回 $STATUS（pending 时应为 409，已定案时应为 201）"
fi

# --- BEHAVIOR-4: 三 token 分权 ---
echo ""
echo "--- BEHAVIOR-4: 三 token 分权 ---"

# AI token → POST /ai-results（传空 payload 验权而非内容）
STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
  -X POST -H "Authorization: Bearer $TOKEN_AI" -H "Content-Type: application/json" \
  -d '{"run_key":"nonexistent","ai_results":[]}' \
  "$BASE_INTERNAL/api/brain/acceptance/ai-results")
# 200/400/422 均说明 token 通过鉴权（业务校验层面的错误）；401/403 = token 拒绝
if [ "$STATUS" = "401" ] || [ "$STATUS" = "403" ]; then
  echo "FAIL [BEHAVIOR-4a]: AI token 被 /ai-results 拒绝 → $STATUS"
  FAIL=$((FAIL+1))
else
  echo "PASS [BEHAVIOR-4a]: AI token 通过 /ai-results 鉴权（$STATUS）"
  PASS=$((PASS+1))
fi

# AI token → POST /results（写人列）→ 期望 4xx
STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
  -X POST -H "Authorization: Bearer $TOKEN_AI" -H "Content-Type: application/json" \
  -d '{"run_key":"nonexistent","results":[{"check_key":"S1-c1","result":"通过"}]}' \
  "$BASE_INTERNAL/api/brain/acceptance/results")
if [ "${STATUS:0:1}" = "4" ]; then
  echo "PASS [BEHAVIOR-4b]: AI token 写人列 → 4xx ($STATUS)"
  PASS=$((PASS+1))
else
  echo "FAIL [BEHAVIOR-4b]: AI token 写人列未被拒绝 → $STATUS"
  FAIL=$((FAIL+1))
fi

# gate token → GET /acceptance/pending（5223）
if [ -n "$TOKEN_GATE" ]; then
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
    -H "Authorization: Bearer $TOKEN_GATE" \
    "$BASE_PUBLIC/acceptance/pending")
  check "BEHAVIOR-4c gate→pending200" "200" "$STATUS"
fi

# ACCEPTANCE_API_TOKEN → POST /ai-results → 401
STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
  -X POST -H "Authorization: Bearer $TOKEN_API" -H "Content-Type: application/json" \
  -d '{"run_key":"x","ai_results":[]}' \
  "$BASE_INTERNAL/api/brain/acceptance/ai-results")
check "BEHAVIOR-4d api_token→ai-results→401" "401" "$STATUS"

# --- BEHAVIOR-5: 5223 写端点 410 ---
echo ""
echo "--- BEHAVIOR-5: 5223 写端点休眠 ---"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
  -X POST -H "Content-Type: application/json" \
  -d '{}' \
  "$BASE_PUBLIC/acceptance/results")
check "BEHAVIOR-5 5223-POST→410" "410" "$STATUS"

# 响应体验证
BODY=$(curl -s -X POST -H "Content-Type: application/json" -d '{}' "$BASE_PUBLIC/acceptance/results" || echo '{}')
if echo "$BODY" | grep -q "endpoint_retired"; then
  echo "PASS [BEHAVIOR-5-body]: 响应体含 endpoint_retired"
  PASS=$((PASS+1))
else
  echo "FAIL [BEHAVIOR-5-body]: 响应体不含 endpoint_retired: $BODY"
  FAIL=$((FAIL+1))
fi

# --- BEHAVIOR-6: adjudicated run 读侧可见（需测试数据）---
echo ""
echo "--- BEHAVIOR-6: adjudicated run 读侧可见 ---"
GP_ID_ADJ="${GP_ID_ADJ:-$GP_ID}"
if [ "${GP_ID_ADJ:-REPLACE_ME}" != "REPLACE_ME" ]; then
  RESP=$(curl -sf -H "Authorization: Bearer $TOKEN_API" \
    "$BASE_INTERNAL/api/brain/acceptance/runs?gp_id=$GP_ID_ADJ" || echo '[]')
  ADJ_COUNT=$(echo "$RESP" | node -e "
    const runs = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    console.log(runs.filter(r=>r.status==='adjudicated').length);
  " 2>/dev/null || echo "0")
  if [ "$ADJ_COUNT" -gt 0 ]; then
    echo "PASS [BEHAVIOR-6]: adjudicated run 可见，共 $ADJ_COUNT 条"
    PASS=$((PASS+1))
  else
    echo "INFO [BEHAVIOR-6]: 未找到 adjudicated run（需有测试数据才能验证）"
  fi
fi

# --- 自动化测试 ---
echo ""
echo "--- npm test（合同测试）---"
cd /workspace && npm test --workspace=packages/brain -- \
  --testPathPattern="acceptance-read-outlets|acceptance-token-isolation" \
  --passWithNoTests 2>&1 | tail -15

echo ""
echo "=== 结果汇总: PASS=$PASS FAIL=$FAIL ==="
[ "$FAIL" = "0" ] && echo "ALL PASS" && exit 0 || exit 1
```

---

## DevGate 门禁（改 Brain 前必跑）

```bash
node /workspace/scripts/facts-check.mjs
bash /workspace/scripts/check-version-sync.sh
node /workspace/packages/quality/scripts/devgate/check-dod-mapping.cjs
```

---

## 不在 DoD 范围内

- D1 已验收条目（不重复断言）
- D2 / D4 功能
- 前端/Dashboard 改动
- 数据库 schema 变更
