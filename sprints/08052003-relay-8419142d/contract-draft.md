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

## 测试契约表

| # | 类型 | 描述 | 对应断言 |
|---|------|------|---------|
| TC-A | [BEHAVIOR] | POST 注册含 status=blocked → DB 行 status=blocked, blocked_at 非 null | 断言 A |
| TC-B | [BEHAVIOR] | dispatcher 遇 status=blocked 任务 → spawnFn 零次调用 | 断言 B |
| TC-C | [BEHAVIOR] | 同 task_id 在途容器存在 → 二次 spawn 被拒，日志含关键词 | 断言 C |
| TC-REG | [BEHAVIOR] | 回归：注册 1 queued + 2 blocked 串行序列，仅首个被派发 | 断言 A+B |

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

