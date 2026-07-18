# Contract Draft: codex_test_gen 生成器空 description 修复

**Sprint ID**: 07180825-codex-gen-description-fix
**Task ID**: c3528706-8c83-4df0-a2af-31e6483ec05f
**Contract 版本**: v1
**日期**: 2026-07-18
**journey_type**: bug_fix
**target_environment**: local_api

---

## 问题摘要

`packages/brain/src/codex-test-gen.js` 的 `runCodexTestGen` 函数在向 Brain API 入队任务时，`body` 缺少 `description` 字段，且 `priority` 使用非法值 `'P3'`（合法值为 `['P0','P1','P2']`）。

`codex_test_gen` 不在 preflight 的 `SYSTEM_TASK_TYPES` 豁免白名单，每次入队的任务均无法通过 preflight 的描述非空检查，三振后进入 `blocked` 状态，造成 5 个历史任务永久卡死。

---

## 验收范围

### 覆盖的 Invariant

| ID | 描述 | 覆盖方式 |
|----|------|----------|
| INV-1 | `runCodexTestGen` 入队的每个任务 `description` 非空且含 `target_file` 路径 | 单元测试断言 `body.description` 含 `targetFile` |
| INV-2 | `description` 长度 >= 20 字符 | 单元测试断言 `body.description.trim().length >= 20` |
| INV-3 | `payload` 含 `candidate_test_paths` 非空数组 | 单元测试断言 `body.payload.candidate_test_paths` |
| INV-4 | `description` 含 `vitest` 关键词 | 单元测试断言 description 含 `vitest` |
| INV-5 | `priority` 为合法值 `P2` | 单元测试断言 `body.priority === 'P2'` |
| INV-6 | 修补后 5 个 blocked 任务 `status='queued'`，`description IS NOT NULL` | 修补脚本执行后 API 验证 |
| INV-7 | 既有黑名单过滤逻辑不破坏 | 回归：`codex-test-gen.test.js` 全过 |
| INV-8 | 去重逻辑不破坏（7 天内同文件跳过）| 回归：`codex-test-gen.test.js` 全过 |

### 覆盖的 FR

| ID | 描述 | 实现方式 |
|----|------|----------|
| FR-1 | 入队 body 加入 `description` 字段，含目标路径 + vitest 要求 | 修改 `runCodexTestGen` |
| FR-2 | `payload` 中加入 `candidate_test_paths` 字段 | 修改 `runCodexTestGen` |
| FR-3 | `priority` 从 `'P3'` 改为 `'P2'` | 修改 `runCodexTestGen` |
| FR-4 | 新增 failing test（TDD Red 先写，Green 后实现）| 新建 `codex-test-gen-description.test.js` |
| FR-5 | 一次性修补脚本修复 5 个 blocked 任务 | 新建 `repair-blocked-tasks.js` |
| FR-6 | 修补脚本执行后 Brain API 验证 5 个任务 `status='queued'` | 修补脚本末尾验证 + manual:bash 验收命令 |

---

## E2E 验收

### 场景 1：新入队任务携带 description（核心修复验证）

**前置条件**：Brain API 运行于 `http://localhost:5221`，DB 可连接。

**测试步骤**：

1. 拦截 `runCodexTestGen` 对 `POST /api/brain/tasks` 的调用，捕获入队 body。
2. 断言 `body.description` 非空。
3. 断言 `body.description` 含 `target_file` 路径字符串。
4. 断言 `body.description` 含 `vitest` 关键词。
5. 断言 `body.payload.candidate_test_paths` 为非空数组。
6. 断言 `body.priority` 为 `'P2'`。

**期望结果**：全部断言通过。

**验收命令（Red 阶段确认）**：
```bash
cd /workspace && npx vitest run packages/brain/src/__tests__/codex-test-gen-description.test.js 2>&1 | head -50
```

### 场景 2：新入队任务通过 preflight 检查

**前置条件**：修复后的 `codex-test-gen.js` 入队任务，任务字段满足 preflight 约束。

**测试步骤**：

1. 构造符合修复后格式的任务对象（含 description、合法 priority）。
2. 调用 `preFlightCheck(task)`。
3. 断言 `result.passed === true`。
4. 断言 `result.issues` 为空数组。

**期望结果**：preflight 通过，`passed: true`，`issues: []`。

### 场景 3：5 个历史 blocked 任务解封

**前置条件**：Brain API 可访问，5 个 blocked 任务 ID 确认存在（前缀 `83fc5def`、`613aa09e`、`f4bd8692`、`06e1b20e`、`433b3625`）。

**测试步骤**：

1. 执行修补脚本 `sprints/07180825-codex-gen-description-fix/repair-blocked-tasks.js`。
2. 脚本为每个任务 PATCH：`description` + `status=queued` + 清零三振计数器。
3. 脚本执行后调用 Brain API 查询验证。

**期望结果**：5 个任务均 `status='queued'`，`description IS NOT NULL`，`metadata.pre_flight_fail_count=0`。

**验收命令**：
```bash
node /workspace/sprints/07180825-codex-gen-description-fix/repair-blocked-tasks.js
```

### 场景 4：回归验证——既有测试全过

**测试步骤**：

1. 运行既有 `codex-test-gen.test.js`，确认黑名单过滤、去重逻辑全部通过。
2. 运行回归测试 `tests/regression/07172225-codex-pool-activation/codex-test-gen.test.ts`。

**期望结果**：零失败、零跳过（已知必须通过的断言）。

**验收命令**：
```bash
cd /workspace && npx vitest run packages/brain/src/__tests__/codex-test-gen.test.js && npx vitest run tests/regression/07172225-codex-pool-activation/codex-test-gen.test.ts
```

---

## 未覆盖真实链路清单

| 编号 | 未覆盖链路 | 原因 / 风险评估 |
|------|-----------|----------------|
| 1 | scheduler 真实调度触发（scheduler-jobs.js 按 cron 触发 `runCodexTestGen`）| 需要等待 scheduler 执行窗口（每日定时），不在本次 bug_fix sprint 强制验收范围；可通过手动调用 `runCodexTestGen` 等效替代 |
| 2 | 新入队任务经 tick.js 被 Codex executor 真实执行（生成测试文件提交 PR）| 属于下游执行链路，本次 sprint 目标仅为"任务能进入 queued 状态并通过 preflight"，不要求 PR merge |
| 3 | preflight 三振后 `alertOnPreFlightFail` 飞书告警推送链路 | 不属于本次修复范围，且本次修复后不应触发 |
| 4 | `getRecentlyQueuedFiles` 真实 DB 去重查询（需连接 Postgres）| 单元测试已注入 `recentFiles` mock，真实 DB 链路由 `target_environment=local_api` 场景覆盖 |

---

## 实现边界（NFR 约束）

- 修复不改动 preflight 逻辑、黑名单过滤逻辑、去重逻辑（NFR-1）
- 修补脚本为幂等操作（NFR-2）
- 新增测试文件路径：`packages/brain/src/__tests__/codex-test-gen-description.test.js`（NFR-3，由 brain-ci.yml 捡起）
- description 模板含目标文件路径 + `vitest` 关键词 + mock 要求（NFR-4）
