# Contract Draft — F1 接单失守三联修复

sprint_dir: sprints/08052003-relay-8419142d
task_id: 8419142d-ce38-4285-9afa-64edbe574eb4
gear: hotfix
版本: r1 (hotfix 直接组装，源自锚定声明 A/B/C)

---

## 背景摘要

2026-08-05 实证三个并发 bug：
1. `POST /api/brain/tasks` 携带 `status=blocked` 被覆盖为 `queued`（注册层白名单过滤）
2. `depends_on_prev` 串行语义不生效，导致 blocked 任务并行抢跑（根因同 Bug 1：初始 status 写错了）
3. 同任务被双容器重复派发（spawn 层缺 DB 级幂等防重）

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 注册 blocked 写入 | `packages/brain/src/__tests__/f1-registration-dispatch.test.js` | TC-A-1: 携带 status=blocked 时，INSERT 的 $5 参数应为 "blocked"/TC-A-2: 携带 status=blocked 时，INSERT SQL 必须含 blocked_at 字段 | → FAIL（ALLOWED_CREATE_STATUSES 无 blocked，$5 写 queued） |
| spawn 幂等防重 | `packages/brain/src/__tests__/f1-registration-dispatch.test.js` | TC-C-1: initiative_runs 存在非终态行 → spawn 被拒绝，reason=active_run_guard/TC-C-2: initiative_runs 无非终态行 → 正常放行（不误阻）/TC-C-3: DB 守门查询失败 → 保守通过（fail-open） | → FAIL（无 initiative_runs 守卫，直接 spawn） |
| 注册序列回归 | `packages/brain/src/__tests__/f1-registration-dispatch.test.js` | TC-REG-1: status=blocked 注册时，INSERT 参数不得包含 "queued"（状态不被篡改） | → FAIL（两个 blocked 任务被改写为 queued） |

---

## E2E 验收

e2e 由集成测试 TC-REG 覆盖（local_api，无真实容器派发，spawnFn mock 计数验证）。

```bash
# manual:bash
cd packages/brain && npx vitest run --reporter=verbose src/__tests__/f1-registration-dispatch.test.js
```

期望：4 个测试全绿（TC-A / TC-B / TC-C / TC-REG），无 ERROR。

---

## 未覆盖真实链路清单

N/A — 所有三个断言均可在 unit/integration 层完整验证，无需真实 Docker 容器或真实 DB。

