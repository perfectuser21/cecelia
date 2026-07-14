# Contract DoD — relay-runs PATCH 短号防呆

- **TASK_ID**: 8e07a118-9b9f-45b3-9d8c-f37d581339e1
- **Sprint**: 07150222-relay-runs-patch-shortid
- **日期**: 2026-07-14

---

## [BEHAVIOR] 条目（≥4 条，可机器验证）

### [BEHAVIOR-1] 8 位十六进制短号命中唯一活跃 v2 run → 200 + phase 更新落库

**场景**：initiative_id 以 `dd34e184` 开头、orchestrator_version='v2'、phase='planning' 的 run 在库中唯一。  
**请求**：`PATCH /api/brain/orchestrator/relay-runs/dd34e184` body `{"phase":"done"}`  
**断言**：
- HTTP 状态码 = 200
- 响应体 JSON 含 `phase: "done"` 且 `completed_at` 非 null
- `SELECT phase FROM initiative_runs WHERE initiative_id::text LIKE 'dd34e184%' AND orchestrator_version='v2'` → `done`

---

### [BEHAVIOR-2] 短号命中多条非终态 run → 取 started_at 最新的一条更新，其余不动

**场景**：库中有两条 initiative_id 前缀均为 `aabb1122` 的 v2 run，phase 均非 done/failed。  
**请求**：`PATCH /api/brain/orchestrator/relay-runs/aabb1122` body `{"phase":"evaluate"}`  
**断言**：
- HTTP 状态码 = 200
- 响应体的 `initiative_id` = started_at 较大的那条的 initiative_id
- started_at 较小的那条 phase 不变（仍为 planning）

---

### [BEHAVIOR-3] 短号命中 0 条活跃 v2 run → 404 且 error 含短号原值

**场景**：库中无 initiative_id 前缀为 `00000000` 的 v2 run（或均为终态）。  
**请求**：`PATCH /api/brain/orchestrator/relay-runs/00000000` body `{"phase":"done"}`  
**断言**：
- HTTP 状态码 = 404
- 响应体 JSON 中 `error` 字段包含字符串 `"00000000"`（短号原值）

---

### [BEHAVIOR-4] 参数格式非法（既非完整 UUID 也非 8 位十六进制）→ 400

**场景**：传入 `bad-id!`、`gggggggg`（非十六进制字符）或 `abcd`（长度不足）。  
**请求**：`PATCH /api/brain/orchestrator/relay-runs/bad-id!` body `{"phase":"done"}`  
**断言**：
- HTTP 状态码 = 400
- 响应体 JSON 中 `error` 字段 = `"invalid id format"`
- 无 DB 查询发出（pool.query 不被调用）

---

### [BEHAVIOR-5] 完整 UUID 参数走既有逻辑，行为不回退

**场景**：传入合法 UUID 格式 `dd34e184-0000-0000-0000-000000000001`。  
**请求**：`PATCH /api/brain/orchestrator/relay-runs/dd34e184-0000-0000-0000-000000000001` body `{"phase":"done"}`  
**断言**：
- HTTP 状态码 ∈ {200, 404}（视 DB 状态而定）
- 不返回 400（不误判为非法格式）
- 行为与修复前等价（直接用 UUID 查询，不触发短号解析路径）

---

### [BEHAVIOR-6] DB 查询抛异常 → 500 + console.warn 含短号上下文，不静默

**场景**：模拟 pool.query 抛出 Error（如 `invalid input syntax for type uuid`）。  
**请求**：`PATCH /api/brain/orchestrator/relay-runs/dd34e184` body `{"phase":"done"}`  
**断言**：
- HTTP 状态码 = 500
- 响应体 JSON 中 `error` 字段 = `"internal error"`（不暴露内部信息）
- `console.warn` 被调用，调用参数含 `dd34e184`（短号原值）

---

## 铁律核查

| 铁律 | 验证方式 |
|------|---------|
| 不改 relay-runs 字段语义与鉴权 | diff 检查：phase 白名单、pr_url 校验、鉴权中间件均无变动 |
| 短号解析在路由层统一做，不散落 handler 内 | 代码审查：解析逻辑位于 handler 首部，UPDATE SQL 收到的始终是完整 UUID |
| DB error console.warn 带 initiative_id/短号上下文，不静默 | [BEHAVIOR-6] 单测断言 console.warn spy |
| failing test 必须先于实现 commit 到 repo | git log 确认：test commit 先于 impl commit |

---

## manual:bash 验收命令

```bash
# 0. 启动 Brain（若未运行）
# cd /workspace && pnpm --filter brain dev &

# 1. [BEHAVIOR-1] 单条命中
curl -s -w "\nHTTP:%{http_code}" \
  -X PATCH http://localhost:5221/api/brain/orchestrator/relay-runs/dd34e184 \
  -H 'Content-Type: application/json' \
  -d '{"phase":"done"}'
# 期望: HTTP:200, body 含 phase:"done"

# 2. [BEHAVIOR-3] 0 命中 → 404 含短号
curl -s -w "\nHTTP:%{http_code}" \
  -X PATCH http://localhost:5221/api/brain/orchestrator/relay-runs/00000000 \
  -H 'Content-Type: application/json' \
  -d '{"phase":"done"}'
# 期望: HTTP:404, body.error 含 "00000000"

# 3. [BEHAVIOR-4] 非法格式 → 400
curl -s -w "\nHTTP:%{http_code}" \
  -X PATCH "http://localhost:5221/api/brain/orchestrator/relay-runs/bad-id!" \
  -H 'Content-Type: application/json' \
  -d '{"phase":"done"}'
# 期望: HTTP:400, body.error = "invalid id format"

# 4. [BEHAVIOR-5] 完整 UUID 不回退
curl -s -w "\nHTTP:%{http_code}" \
  -X PATCH "http://localhost:5221/api/brain/orchestrator/relay-runs/dd34e184-0000-0000-0000-000000000001" \
  -H 'Content-Type: application/json' \
  -d '{"phase":"done"}'
# 期望: HTTP:200 或 404（不得为 400）

# 5. 单测全跑（含 failing test 验证 Red 阶段）
cd /workspace && pnpm --filter brain test relay-runs-patch-shortid
```
