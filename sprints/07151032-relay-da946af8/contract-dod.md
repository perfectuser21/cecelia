# Contract DoD — relay-smoke executor 字段

**Task ID**: da946af8-44af-4fc2-8991-e801619cb192
**Sprint Dir**: sprints/07151032-relay-da946af8
**Round**: 1

---

## [ARTIFACT] 产出物清单

- [ ] [ARTIFACT] `packages/brain/src/routes/walking-skeleton.js` 的 relay-smoke handler 返回体新增 `executor` 字段
  - 实现：`res.json({ ok: true, controller: '2.2.0', executor: process.env.HARNESS_EXECUTOR || 'unknown' })`
  - 文件唯一，单行改动

- [ ] [ARTIFACT] `sprints/07151032-relay-da946af8/tests/relay-smoke-executor.contract.test.js` 新增 B6 Vitest 测试文件
  - 不修改现有 `packages/brain/src/routes/__tests__/relay-smoke.contract.test.js`

---

## [BEHAVIOR] 行为断言清单

- [ ] [BEHAVIOR] B6: executor 字段为非空字符串
  Test: `manual:bash`
  ```bash
  BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
  RESP=$(curl -sf "$BRAIN_URL/api/brain/relay-smoke")
  echo "$RESP" | jq -e '.executor != null and (.executor | type) == "string" and .executor != ""' \
    || { echo "FAIL B6: executor 字段缺失或为空"; exit 1; }
  echo "PASS B6: executor=$(echo "$RESP" | jq -r '.executor')"
  ```
  期望: jq 断言返回 true，exit 0

- [ ] [BEHAVIOR] INV-1: B1~B5 已有合同断言不被破坏（ok:true 和 controller:2.2.0 必须保持）
  Test: `manual:bash`
  ```bash
  BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
  RESP=$(curl -sf "$BRAIN_URL/api/brain/relay-smoke")
  echo "$RESP" | jq -e '.ok == true' || { echo "FAIL INV-1a: ok != true"; exit 1; }
  echo "$RESP" | jq -e '.controller == "2.2.0"' || { echo "FAIL INV-1b: controller != 2.2.0"; exit 1; }
  STATUS=$(curl -o /dev/null -w "%{http_code}" -sf "$BRAIN_URL/api/brain/relay-smoke")
  [ "$STATUS" = "200" ] || { echo "FAIL INV-1c: HTTP $STATUS"; exit 1; }
  curl -sI "$BRAIN_URL/api/brain/relay-smoke" | grep -i "content-type.*application/json" \
    || { echo "FAIL INV-1d: Content-Type 不含 application/json"; exit 1; }
  echo "PASS INV-1: B1~B4 全部通过"
  ```
  期望: 全部 jq/grep 断言通过，exit 0

- [ ] [BEHAVIOR] INV-2: 端点路径 GET /api/brain/relay-smoke 不变
  Test: `manual:bash`
  ```bash
  BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
  STATUS=$(curl -o /dev/null -w "%{http_code}" -sf "$BRAIN_URL/api/brain/relay-smoke")
  [ "$STATUS" = "200" ] || { echo "FAIL INV-2: 端点路径不存在或返回非 200，HTTP=$STATUS"; exit 1; }
  echo "PASS INV-2: 端点路径 /api/brain/relay-smoke 正常响应 HTTP 200"
  ```
  期望: HTTP 200，exit 0

- [ ] [BEHAVIOR] INV-3: 端点无 DB 查询（纯内存/环境变量读取，响应时间 < 100ms）
  Test: `manual:bash`
  ```bash
  BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
  START_MS=$(date +%s%3N)
  curl -sf "$BRAIN_URL/api/brain/relay-smoke" > /dev/null
  END_MS=$(date +%s%3N)
  ELAPSED=$((END_MS - START_MS))
  [ "$ELAPSED" -lt 100 ] || { echo "FAIL INV-3: 响应时间 ${ELAPSED}ms >= 100ms，疑有 DB 查询"; exit 1; }
  echo "PASS INV-3: 响应时间 ${ELAPSED}ms < 100ms，无 DB 查询"
  ```
  期望: 响应时间 < 100ms，exit 0

- [ ] [BEHAVIOR] INV-4: 其他 walking-skeleton 端点逻辑不受影响（/api/brain/context 仍可访问）
  Test: `manual:bash`
  ```bash
  BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
  STATUS=$(curl -o /dev/null -w "%{http_code}" -sf "$BRAIN_URL/api/brain/context")
  [ "$STATUS" = "200" ] || { echo "FAIL INV-4: /api/brain/context 返回 HTTP $STATUS，端点受影响"; exit 1; }
  echo "PASS INV-4: /api/brain/context 仍正常响应 HTTP 200"
  ```
  期望: HTTP 200，exit 0

---

## 铁律覆盖索引（4/4）

| # | 铁律原文 | 对应 [BEHAVIOR] 条目 |
|---|---------|---------------------|
| 1 | 不改动 B1–B5 已有合同测试断言（ok:true、controller:"2.2.0" 必须保持） | INV-1 |
| 2 | 端点路径 GET /api/brain/relay-smoke 不变 | INV-2 |
| 3 | 无 DB 查询，纯内存/环境变量读取 | INV-3 |
| 4 | 不修改其他 walking-skeleton 端点逻辑 | INV-4 |

---

*DoD 版本: Round 1 | 所有 [BEHAVIOR] 为 `- [ ]` 格式（未预勾）*
