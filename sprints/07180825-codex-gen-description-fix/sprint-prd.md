# Sprint PRD: codex_test_gen 生成器空 description 修复

**Sprint ID**: 07180825-codex-gen-description-fix
**Task ID**: c3528706-8c83-4df0-a2af-31e6483ec05f
**日期**: 2026-07-18
**优先级**: P1

---

## 问题根因

### 直接根因：`codex-test-gen.js` 入队 payload 缺 `description` 字段

文件：`packages/brain/src/codex-test-gen.js`，`runCodexTestGen` 函数，第 154-167 行。

入队时构造的 `body` 只含 `task_type / title / status / priority / payload`，**完全没有 `description` 字段**：

```js
body: JSON.stringify({
  task_type: 'codex_test_gen',
  title: `[自动生成测试] ${targetFile}`,
  status: 'queued',
  priority: 'P3',       // 另一个 bug：P3 不在 validPriorities ['P0','P1','P2'] 中
  payload: {
    target_file: targetFile,
    trigger: 'codex_test_gen_scheduler',
  },
  // ← description 缺失
}),
```

### Preflight 检查逻辑（`packages/brain/src/pre-flight-check.js` 第 61-69 行）

`codex_test_gen` **不在** `SYSTEM_TASK_TYPES` 豁免白名单中，因此会走描述非空检查：

```js
const descContent = task.description || task.prd_content || task.payload?.prd_summary;
if (!isSystemTask) {
  if (!descContent || descContent.trim().length === 0) {
    issues.push('Task description is empty');
  }
}
```

三次 preflight 失败后触发三振机制，任务状态 → `blocked`，`blocked_reason='pre_flight_rejected'`。

### 次要问题：`priority: 'P3'` 非法

Preflight 只接受 `['P0', 'P1', 'P2']`（第 89 行），`P3` 会触发 "Invalid priority" 错误。被 blocked 的 5 个任务显示 priority=P2，说明在入队后被调度器升级了，但源头代码仍然写的是 P3，未来新入队的任务同样有此风险。

### 受影响的 5 个 blocked 任务

| ID | target_file | blocked_detail |
|----|------------|----------------|
| `83fc5def` | `packages/brain/src/drain.js` | Task description is empty (strikes=3) |
| `613aa09e` | `packages/brain/src/brain-manifest.js` | Task description is empty (strikes=3) |
| `f4bd8692` | `packages/brain/src/quota-guard.js` | Task description is empty (strikes=3) |
| `06e1b20e` | `packages/brain/src/scheduler-jobs.js` | Task description is empty (strikes=3) |
| `433b3625` | `packages/brain/src/codex-test-gen.js` | Task description is empty (strikes=3) |

---

## Invariant 约束

| ID | 约束描述 | 检验方式 |
|----|----------|----------|
| INV-1 | `runCodexTestGen` 入队的每个任务 `description` 非空，且包含 `target_file` 路径 | 断言 `body.description` 含 `targetFile` 字符串 |
| INV-2 | `runCodexTestGen` 入队的每个任务 `description` 长度 >= 20 字符 | 断言 `body.description.trim().length >= 20` |
| INV-3 | `runCodexTestGen` 入队的每个任务 `payload` 含 `candidate_test_paths` 字段（候选测试路径）| 断言 `body.payload.candidate_test_paths` 为非空数组 |
| INV-4 | `runCodexTestGen` 入队的任务 `description` 含"vitest"或"测试"关键词，体现生成要求 | 断言 description 含 `vitest` |
| INV-5 | `runCodexTestGen` 入队的任务 `priority` 为合法值（P2），可通过 preflight | 断言 `body.priority` 在 `['P0','P1','P2']` 中 |
| INV-6 | 修补后的 5 个 blocked 任务 `status` 变为 `queued`，`description` 非空 | 断言查询结果 `status='queued'` 且 `description IS NOT NULL` |
| INV-7 | 既有黑名单过滤逻辑不破坏（dispatcher/slot-allocator 等不出现在入队列表）| 既有测试 `codex-test-gen.test.js` 全过 |
| INV-8 | 去重逻辑不破坏（7 天内同文件跳过）| 既有测试 `codex-test-gen.test.js` 全过 |

---

## 累积 FR（功能需求）

| ID | 需求描述 |
|----|----------|
| FR-1 | `runCodexTestGen` 入队时，在 `body` 中加入 `description` 字段，内容模板：`为 {target_file} 补写 vitest 单元测试。要求：仅 mock 系统边界（DB/网络/fs），覆盖主要分支，CI 兼容，文件输出到 packages/brain/src/__tests__/{stem}.test.js。` |
| FR-2 | `runCodexTestGen` 入队时，`payload` 中加入 `candidate_test_paths` 字段，值为 `['packages/brain/src/__tests__/{stem}.test.js']` |
| FR-3 | `runCodexTestGen` 入队时，`priority` 从 `'P3'` 改为 `'P2'`，通过 preflight priority 检查 |
| FR-4 | 新增 failing test：断言 `runCodexTestGen` 产出任务的 `description` 非空且含 `target_file` 路径（TDD Red 先写，Green 后实现） |
| FR-5 | 编写一次性修补脚本，对 5 个 blocked 任务执行：① 写入 `description`；② 清空 preflight 三振记录（重置 `metadata.pre_flight_fail_count=0`、`pre_flight_failed=false`）；③ 将 `status` 回设为 `queued`，`blocked_at`/`blocked_reason`/`blocked_detail` 清空 |
| FR-6 | 修补脚本执行完毕后，通过 Brain API 验证 5 个任务 `status='queued'` 且 `description IS NOT NULL` |

---

## NFR（非功能需求）

| ID | 需求描述 |
|----|----------|
| NFR-1 | 修复不改动 preflight 逻辑、黑名单过滤逻辑、去重逻辑，保持向后兼容 |
| NFR-2 | 修补脚本为幂等操作（可重复执行不产生副作用） |
| NFR-3 | 新增测试必须进 CI（`packages/brain/src/__tests__/` 路径下，由 `brain-ci.yml` 捡起） |
| NFR-4 | description 模板须为中英文混合可读内容，至少包含：目标文件路径、"vitest"关键词、mock 要求 |

---

## 实现计划（TDD：先 failing test，再实现）

### Step 1：写 Failing Test（Red 阶段）

文件：`packages/brain/src/__tests__/codex-test-gen-description.test.js`（新建）

测试内容：
- Mock `fetch`，捕获 `runCodexTestGen` 的实际入队 body
- 断言 `body.description` 非空
- 断言 `body.description` 含 `target_file` 路径
- 断言 `body.description` 含 `vitest` 关键词
- 断言 `body.payload.candidate_test_paths` 非空数组
- 断言 `body.priority` 为 `'P2'`

**在 fix 前这些断言必须 FAIL**（验证 Red 阶段）

### Step 2：修复 `codex-test-gen.js`（Green 阶段）

修改 `packages/brain/src/codex-test-gen.js` 中 `runCodexTestGen` 函数：

1. 在入队 `body` 中加入 `description` 字段，模板使用 `targetFile` 变量和 `stem`（文件名不含扩展名）
2. 在 `payload` 中加入 `candidate_test_paths: ['packages/brain/src/__tests__/${stem}.test.js']`
3. `priority` 从 `'P3'` 改为 `'P2'`

### Step 3：验证现有测试全过（Regression 验证）

运行：
```bash
cd /workspace && npx vitest run packages/brain/src/__tests__/codex-test-gen.test.js
cd /workspace && npx vitest run tests/regression/07172225-codex-pool-activation/codex-test-gen.test.ts
```

确保既有的黑名单过滤、去重逻辑测试全部 PASS。

### Step 4：执行修补脚本（5 个 blocked 任务解封）

编写并运行 `sprints/07180825-codex-gen-description-fix/repair-blocked-tasks.js`：

对 5 个 blocked 任务 ID 逐一：
1. 通过 `PATCH /api/brain/tasks/{id}` 写入 description、清 metadata 三振记录、回设 status=queued
2. 验证回设成功

### Step 5：验收

- 触发一次 `runCodexTestGen`（或等待 scheduler 下次执行），确认新入队任务携带 `description` 字段
- 验证新任务通过 preflight，进入 `queued` 状态
- 确认至少 1 条 `codex_test_gen` 任务真实流转（不要求 PR merge）

---

## 修补计划（5 个 blocked 任务的修补脚本）

脚本路径：`sprints/07180825-codex-gen-description-fix/repair-blocked-tasks.js`

修补目标 task IDs：
- `83fc5def-3748-43c6-80a7-aa99a70720d6`（target: drain.js）
- `613aa09e-fad4-4b48-87ea-ce5e3daf38d1`（target: brain-manifest.js）
- `f4bd8692-590f-4ed7-8bea-52c1e1abc76f`（target: quota-guard.js）
- `06e1b20e-e300-499d-97bd-6f63afded028`（target: scheduler-jobs.js）
- `433b3625-3ae5-41e9-959c-fdc0c888d158`（target: codex-test-gen.js）

每个任务的修补操作（PATCH body）：
```json
{
  "description": "为 {target_file} 补写 vitest 单元测试。要求：仅 mock 系统边界（DB/网络/fs），覆盖主要分支，CI 兼容，文件输出到 packages/brain/src/__tests__/{stem}.test.js。",
  "status": "queued",
  "blocked_at": null,
  "blocked_reason": null,
  "blocked_detail": null,
  "metadata": {
    "pre_flight_failed": false,
    "pre_flight_fail_count": 0,
    "pre_flight_issues": [],
    "repaired_at": "<ISO timestamp>",
    "repaired_by": "sprint-07180825-repair-script"
  }
}
```

验证查询（修补完成后执行）：
```bash
curl "http://localhost:5221/api/brain/tasks?status=queued&limit=20" | \
  python3 -c "import json,sys; tasks=json.load(sys.stdin); \
  ids={'83fc5def','613aa09e','f4bd8692','06e1b20e','433b3625'}; \
  found=[t for t in tasks if any(t['id'].startswith(i) for i in ids)]; \
  print(f'已解封: {len(found)}/5')"
```

---

journey_type: bug_fix
target_environment: local_api
