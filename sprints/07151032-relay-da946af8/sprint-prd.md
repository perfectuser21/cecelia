# Sprint PRD: relay-smoke executor 字段（headless-smoke）

- **Task ID**: da946af8-44af-4fc2-8991-e801619cb192
- **Sprint Dir**: sprints/07151032-relay-da946af8
- **Journey ID**: bb8cc561-b3ee-4fec-b74d-2255694bd963（Cecelia Harness Pipeline，dev_pipeline）
- **日期**: 2026-07-15

---

## 背景

Cecelia Harness Pipeline 需要验证 headless Claude relay 容器已正确注入 `HARNESS_EXECUTOR` 环境变量。
当前 `GET /api/brain/relay-smoke` 仅返回 `controller` 字段，无法区分执行环境，新增 `executor` 字段以实现此证明。

---

## Invariant 约束

1. 不改动 B1–B5 已有合同测试断言（`ok: true`、`controller: "2.2.0"` 字段必须保持不变）
2. 端点路径 `GET /api/brain/relay-smoke` 不变
3. 无 DB 查询，纯内存/环境变量读取
4. 不修改其他 walking-skeleton 端点逻辑

---

## 累积 FR

| FR | 描述 | 来源 |
|----|------|------|
| FR1 | 端点返回 `ok: true` | 已有 B1 |
| FR2 | 端点返回 `controller: "2.2.0"` | 已有 B3 |
| FR3 | HTTP 状态码 200 | 已有 B2 |
| FR4 | Content-Type 为 application/json | 已有 B4 |
| FR5 | 响应时间 < 100ms | 已有 B5 NFR |
| FR6 | 端点返回 `executor` 字段（非空字符串，读 `process.env.HARNESS_EXECUTOR \|\| 'unknown'`） | 新增 |

---

## Golden Path

1. headless relay 容器以 `HARNESS_EXECUTOR=claude` 启动后，调用 `curl localhost:5221/api/brain/relay-smoke`，响应体为：
   ```json
   {"ok": true, "controller": "2.2.0", "executor": "claude"}
   ```
   `executor` 字段值等于注入的环境变量值，证明容器环境正确传递。

---

## NFR

- 响应时间 < 100ms（无 I/O，纯同步读取 `process.env`）
- 无 DB 查询，无外部依赖
- 零副作用：GET 幂等，不写状态

---

## E2E 验收

```bash
#!/usr/bin/env bash
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
curl -sf "$BRAIN_URL/api/brain/relay-smoke" | jq -e '.executor != null and .executor != ""'

echo "=== 全部验收通过 ==="
```

---

journey_type: dev_pipeline
target_environment: local_api
