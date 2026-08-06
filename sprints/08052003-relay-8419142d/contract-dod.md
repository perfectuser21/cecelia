# Contract DoD — F1 接单失守三联修复

sprint_dir: sprints/08052003-relay-8419142d
task_id: 8419142d-ce38-4285-9afa-64edbe574eb4

---

## 验收项（DoD）

- [BEHAVIOR] TC-A 注册层尊重 status=blocked
- 文件: packages/brain/src/__tests__/f1-registration-dispatch.test.js
- 断言: POST /api/brain/tasks 携带 { status: "blocked", blocked_at: <ts> } 后，
  mockQuery 收到的 INSERT SQL 参数列表中 status 值为 "blocked"，blocked_at 非 null
- [x] failing test 先于修复 commit (Red commit 先)

- [BEHAVIOR] TC-B dispatcher 跳过 blocked 任务
- 文件: packages/brain/src/__tests__/f1-registration-dispatch.test.js
- 断言: 任务 status=blocked 时，dispatcher selectNextDispatchableTask SQL 的 WHERE 子句
  仅选 status='queued'，且 spawnSkillRelaySession 未被调用（spawnFn.mock.calls.length === 0）
- [x] failing test 先于修复 commit (Red commit 先)

- [BEHAVIOR] TC-C spawn 幂等防重
- 文件: packages/brain/src/__tests__/f1-registration-dispatch.test.js  
- 断言: 同 task_id 在途容器存在（initiative_runs 有非终态行）时，
  spawnSkillRelaySession 返回 { ok: false, reason: 'active_run_guard' }，
  spawnFn 未被调用；控制台日志含 "[dispatcher][spawn-guard]" 关键词
- [x] failing test 先于修复 commit (Red commit 先)

- [BEHAVIOR] TC-REG 三任务串行回归
- 文件: packages/brain/src/__tests__/f1-registration-dispatch.test.js
- 断言: 注册序列 [task1:queued, task2:blocked+depends_on_prev, task3:blocked+depends_on_prev]，
  仅 task1 被选中派发（selectNextDispatchableTask 返回 task1），
  task2/task3 因 status=blocked 不在 queued 候选中
- [x] 回归测试永久留在 CI

---

## 判定点登记表

| 判定点 | 判定方式 | 责任方 |
|--------|---------|--------|
| blocked 写入 DB | mockQuery SQL 参数断言 | evaluator TC-A |
| spawnFn 零次调用 | mock.calls.length === 0 | evaluator TC-B |
| spawn-guard 日志 | console.warn spy | evaluator TC-C |
| 回归仅首个派发 | selectNextDispatchableTask 返回值 | evaluator TC-REG |

---

## 手动验收命令

manual:bash
```bash
cd packages/brain && npx vitest run --reporter=verbose src/__tests__/f1-registration-dispatch.test.js
```

期望输出：4 passed，0 failed。

---

## 修复范围（FR 映射）

- FR-1 → packages/brain/src/routes/task-tasks.js（ALLOWED_CREATE_STATUSES + blocked_at INSERT）
- FR-2 → 无需单独改（selectNextDispatchableTask 已只选 queued；Bug B 是 Bug A 的下游表现）
- FR-3 → packages/brain/src/harness-skill-relay.js（spawn 前 DB 查 initiative_runs 防重）
- FR-4/5/6 → packages/brain/src/__tests__/f1-registration-dispatch.test.js（failing tests）
- FR-7 → packages/brain/.github/workflows/brain-ci.yml 或现有 CI 已收集路径


