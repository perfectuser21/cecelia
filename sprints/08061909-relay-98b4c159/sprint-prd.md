# Sprint PRD — headless-cancel-smoke [98b4c159]

sprint_id: 98b4c159
sprint_dir: sprints/08061909-relay-98b4c159
journey_type: quality-smoke
target_environment: local

---

## 背景

Brain dispatch 链路 smoke probe 清理缺口：`claude-headed-dispatch-smoke.sh` 用
psql DELETE 删除探针任务，若 tick 先于 cleanup 捡走任务（状态变 in_progress），
DELETE 静默失败，遗留"漂浮"任务。本 sprint 验证 PATCH status=cancelled 作为
headless 探针安全清理路径的幂等性与状态一致性。

---

## Invariant 约束

| ID   | 约束描述 |
|------|----------|
| I-01 | smoke 脚本必须通过 `executor=claude` + `mode=headless` 路由到 headless executor，不得触发真实 agent 调度 |
| I-02 | `headless-cancel-smoke.sh` 必须在 `packages/quality/smoke-allowlist.txt` 中登记，棘轮不允许新增 smoke debt |
| I-03 | 脚本行数严格 < 60 行（含注释），CI 自动校验行数超出即红 |
| I-04 | 依赖锁：仅允许 bash + curl + python3，禁止 jq / psql / node |

---

## 累积 FR

| ID    | 需求描述 | 验收条件 |
|-------|----------|----------|
| FR001 | POST tasks(mode=headless, executor=claude, orchestrator=skill-relay) | 返回 HTTP 200/201 + JSON body 含 id 字段 |
| FR002 | GET tasks/{id} 读回验证 payload.mode | 响应 payload.mode == "headless" |
| FR003 | PATCH tasks/{id} status=cancelled | 返回 HTTP 200，取消清理路径可用 |
| FR004 | GET tasks/{id} 状态固化验证 | 响应 status == "cancelled" |
| FR005 | POST tasks 二次创建同名探针（可重入性） | 返回 HTTP 200/201，证明清理后可重复运行 |

---

## NFR

| ID     | 约束 |
|--------|------|
| NFR-01 | 脚本体积 < 60 行（含空行与注释） |
| NFR-02 | 运行时依赖：bash + curl + python3 only，禁止 jq / psql / node |
| NFR-03 | 可重入：探针 title 固定为 `headless-cancel-probe-test`，PATCH cancelled 后可重复运行 |
| NFR-04 | 目标环境：本地 Brain localhost:5221，无需外部依赖 |

---

## 验收断言

- A1: POST /api/brain/tasks 返回 HTTP 200 或 201，响应 JSON 包含 `id` 字段（非空）
- A2: GET /api/brain/tasks/{id} 返回 payload.mode == "headless"
- A3: PATCH /api/brain/tasks/{id} body={"status":"cancelled"} 返回 HTTP 200
- A4: GET /api/brain/tasks/{id} 返回 status == "cancelled"
- A5: 第二次 POST /api/brain/tasks（title="headless-cancel-probe-test"）返回 HTTP 200 或 201

---

## 产物清单

| 产物路径 | 描述 |
|----------|------|
| `packages/brain/scripts/smoke/headless-cancel-smoke.sh` | 主 smoke 脚本（< 60 行，bash+curl+python3） |
| `packages/quality/smoke-allowlist.txt` | 追加 `headless-cancel-smoke.sh` 登记 |

---

journey_type: quality-smoke
target_environment: local
