# Contract Draft — relay-runs PATCH 短号防呆

- **TASK_ID**: 8e07a118-9b9f-45b3-9d8c-f37d581339e1
- **Sprint**: 07150222-relay-runs-patch-shortid
- **日期**: 2026-07-14
- **target_environment**: local_api
- **journey_type**: local_api

---

## Golden Path 对照表

| # | 场景 | 输入 | 期望响应 | DB 状态断言 |
|---|------|------|----------|-------------|
| GP-1 | 短号命中唯一活跃 v2 run | `PATCH /orchestrator/relay-runs/dd34e184` body: `{phase:"done"}` | 200 + run 对象（phase=done, completed_at 非空） | `SELECT phase FROM initiative_runs WHERE initiative_id LIKE 'dd34e184%'` → done |
| GP-2 | 短号命中多条非终态 → 取最新 started_at | `PATCH /orchestrator/relay-runs/aabb1122` body: `{phase:"evaluate"}` | 200 + 更新的是 started_at 最大的那条 | 较旧的那条 phase 不变 |
| GP-3 | 完整 UUID 传参（既有逻辑不回退） | `PATCH /orchestrator/relay-runs/dd34e184-xxxx-xxxx-xxxx-xxxxxxxxxxxx` | 200 或 404（与修复前等价） | 无变化 |
| GP-4 | 短号命中 0 条 | `PATCH /orchestrator/relay-runs/00000000` | 404 + `{error:"run not found for short id: 00000000"}` | 无写入 |
| GP-5 | 参数格式非法（非 UUID / 非 8 位十六进制） | `PATCH /orchestrator/relay-runs/bad-id!` | 400 + `{error:"invalid id format"}` | 无写入 |
| GP-6 | DB 查询抛异常 | 模拟 pool.query 抛出 | 500 + `{error:"internal error"}`，console.warn 含短号 | — |

---

## E2E 验收

> target_environment=local_api；使用本地运行的 Brain API（localhost:5221）+ psql 直连 DB 验证。

```bash
#!/usr/bin/env bash
# E2E 验收脚本（proposer 生成，GAN 阶段执行）
# 前置条件：Brain API 运行于 localhost:5221，psql 可访问同一 DB

set -euo pipefail
BRAIN=http://localhost:5221/api/brain

# ── 准备：插入测试 run ──────────────────────────────────────────────
FULL_UUID="dd34e184-0000-0000-0000-000000000001"
SHORT_ID="dd34e184"

psql "$DATABASE_URL" <<SQL
  INSERT INTO initiative_runs
    (id, initiative_id, phase, orchestrator_version, started_at)
  VALUES
    (gen_random_uuid(), '$FULL_UUID', 'planning', 'v2', NOW())
  ON CONFLICT DO NOTHING;
SQL

# ── 场景 1：短号 PATCH phase=done → 200，DB 确认 ───────────────────
echo "[E2E-1] 短号 PATCH done"
HTTP=$(curl -s -o /tmp/e2e1.json -w "%{http_code}" \
  -X PATCH "$BRAIN/orchestrator/relay-runs/$SHORT_ID" \
  -H 'Content-Type: application/json' \
  -d '{"phase":"done"}')
[ "$HTTP" = "200" ] || { echo "FAIL E2E-1: expected 200, got $HTTP"; cat /tmp/e2e1.json; exit 1; }
DB_PHASE=$(psql -t "$DATABASE_URL" -c \
  "SELECT phase FROM initiative_runs WHERE initiative_id::text LIKE '${SHORT_ID}%' AND orchestrator_version='v2' LIMIT 1")
echo "$DB_PHASE" | grep -q "done" || { echo "FAIL E2E-1: DB phase not done"; exit 1; }
echo "  PASS E2E-1"

# ── 场景 2：短号命中多条 → 更新 started_at 最新 ─────────────────────
echo "[E2E-2] 多条命中取最新"
UUID_OLD="aabb1122-0000-0000-0000-000000000001"
UUID_NEW="aabb1122-0000-0000-0000-000000000002"
SHORT2="aabb1122"
psql "$DATABASE_URL" <<SQL2
  INSERT INTO initiative_runs (id, initiative_id, phase, orchestrator_version, started_at)
  VALUES
    (gen_random_uuid(), '$UUID_OLD', 'planning', 'v2', NOW() - INTERVAL '1 hour'),
    (gen_random_uuid(), '$UUID_NEW', 'planning', 'v2', NOW());
SQL2
HTTP=$(curl -s -o /tmp/e2e2.json -w "%{http_code}" \
  -X PATCH "$BRAIN/orchestrator/relay-runs/$SHORT2" \
  -H 'Content-Type: application/json' \
  -d '{"phase":"evaluate"}')
[ "$HTTP" = "200" ] || { echo "FAIL E2E-2: expected 200, got $HTTP"; cat /tmp/e2e2.json; exit 1; }
UPDATED_ID=$(psql -t "$DATABASE_URL" -c \
  "SELECT initiative_id FROM initiative_runs WHERE initiative_id::text LIKE '${SHORT2}%' AND phase='evaluate' AND orchestrator_version='v2' LIMIT 1" | tr -d ' ')
[ "$UPDATED_ID" = "$UUID_NEW" ] || { echo "FAIL E2E-2: wrong run updated ($UPDATED_ID != $UUID_NEW)"; exit 1; }
OLD_PHASE=$(psql -t "$DATABASE_URL" -c \
  "SELECT phase FROM initiative_runs WHERE initiative_id='$UUID_OLD' AND orchestrator_version='v2' LIMIT 1" | tr -d ' ')
[ "$OLD_PHASE" = "planning" ] || { echo "FAIL E2E-2: old run phase changed to $OLD_PHASE"; exit 1; }
echo "  PASS E2E-2"

# ── 场景 3：完整 UUID 走既有逻辑（不回退）──────────────────────────
echo "[E2E-3] 完整 UUID PATCH"
HTTP=$(curl -s -o /tmp/e2e3.json -w "%{http_code}" \
  -X PATCH "$BRAIN/orchestrator/relay-runs/$FULL_UUID" \
  -H 'Content-Type: application/json' \
  -d '{"phase":"done"}')
[[ "$HTTP" = "200" || "$HTTP" = "404" ]] || { echo "FAIL E2E-3: expected 200/404, got $HTTP"; cat /tmp/e2e3.json; exit 1; }
echo "  PASS E2E-3 (HTTP=$HTTP)"

# ── 场景 4：短号命中 0 条 → 404 含短号原值 ─────────────────────────
echo "[E2E-4] 短号 0 命中"
HTTP=$(curl -s -o /tmp/e2e4.json -w "%{http_code}" \
  -X PATCH "$BRAIN/orchestrator/relay-runs/00000000" \
  -H 'Content-Type: application/json' \
  -d '{"phase":"done"}')
[ "$HTTP" = "404" ] || { echo "FAIL E2E-4: expected 404, got $HTTP"; cat /tmp/e2e4.json; exit 1; }
grep -q "00000000" /tmp/e2e4.json || { echo "FAIL E2E-4: error body missing short id"; cat /tmp/e2e4.json; exit 1; }
echo "  PASS E2E-4"

echo "ALL E2E PASS"
```

---

## 未覆盖真实链路清单

| 链路 | 未覆盖原因 | 风险评级 |
|------|-----------|----------|
| controller session 发 PATCH 时携带真实 phase 序列（planning→gan→generate→evaluate→done） | 单测只验单次写入，不验多步状态机流转 | 中（watchdog 已有覆盖） |
| 短号前缀冲突（两个 initiative_id 前 8 位相同但属于不同活跃 run）| 测试插入的 UUID 都是可控前缀，生产罕见但不零概率 | 低（UUID v4 概率极小） |
| DB 响应超时（> 10ms）告警 | NFR 要求有 < 10ms 约束但无自动化计时断言 | 低（indexed prefix scan） |
| 鉴权 token 失效时返回 401 | 范围外，不新增鉴权测试 | 不适用 |
| pr_url 与 phase=done 同时写入验证（pr_url 落库 + 格式校验回归） | 已有 relay-runs-verdict-writeback.test.js 覆盖，本 sprint 不重复 | 无 |

## Test Contract

| BEHAVIOR | Test File | it() 名称（子串匹配） |
|----------|-----------|----------------------|
| BEHAVIOR-1: 短号命中唯一活跃 run → 200 + phase 更新 | ../../packages/brain/src/__tests__/relay-runs-patch-shortid.test.js | 返回 200 且响应体含 phase |
| BEHAVIOR-2: 多条命中取最新非终态 | ../../packages/brain/src/__tests__/relay-runs-patch-shortid.test.js | 更新的是 started_at 最新 |
| BEHAVIOR-3: 0条命中 → 404 含短号 | ../../packages/brain/src/__tests__/relay-runs-patch-shortid.test.js | 命中 0 条 |
| BEHAVIOR-4: 非法格式 → 400 | ../../packages/brain/src/__tests__/relay-runs-patch-shortid.test.js | 格式非法 |
| BEHAVIOR-5: 完整 UUID 行为不回退 | ../../packages/brain/src/__tests__/relay-runs-patch-shortid.test.js | 完整 UUID |
| BEHAVIOR-6: DB 异常 → 500 + console.warn | ../../packages/brain/src/__tests__/relay-runs-patch-shortid.test.js | DB 抛异常 |
