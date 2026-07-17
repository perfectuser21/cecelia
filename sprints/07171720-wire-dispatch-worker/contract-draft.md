# 合同草案：wire-dispatch-worker
<!-- task_id: 1f50b6ac-8076-47c5-bff6-cc6bdb79bcd1 -->
<!-- sprint_dir: sprints/07171720-wire-dispatch-worker -->
<!-- generated: 2026-07-17 -->

## 目标

将 `scripts/dispatch-worker.mjs` 接入 `packages/brain/src/harness-skill-relay.js` 的 executor 路由，使 `payload.executor='worker-pool'` 的 `harness_initiative` 任务能通过 dispatch-worker 自动选号（查余量 → 择优 → 撞墙换号），而非降为缺省 codex/claude 路径。

---

## 改动范围

**修改文件**：`packages/brain/src/harness-skill-relay.js`

- 在 `spawnSkillRelaySession` 函数中新增 `worker-pool` executor 分支
- 在 B2+B3 守门之前（headed 分支之后）插入 `isWorkerPool` 判断
- `worker-pool` 分支不走 docker spawn，改为调用 `dispatch-worker.mjs`（通过注入的 `dispatchWorkerFn` 或真实 `node scripts/dispatch-worker.mjs` 子进程）
- `initiative_runs` 落行 `orchestrator_host='skill-relay-worker-pool'`，`phase='A_planning'`，`deadline=6h`
- `worker-pool` 路径不计入 `_activeCodexRelays`（独立链路，独立额度管理）

**新增文件**：`packages/brain/tests/dispatch-worker-relay.test.js`

- T1：worker-pool 路由到 dispatchWorkerFn（不调用 spawnFn）
- T2：核心任务护栏——base_repo=cecelia + packages/brain/src → terminal_failed
- T3：白名单外 executor 值拒绝（不静默降级）
- TDD commit 顺序：先提交 failing 测试（测试已写、实现未改），再提交接线实现（测试转 passing）

**禁止改动文件**：`scripts/dispatch-worker.mjs`（2026-07-16 已实测链路，函数签名/内部逻辑冻结）

---

## 接线规格

### FR-1: worker-pool executor 路由

`spawnSkillRelaySession(task, deps)` 当 `task.payload?.executor === 'worker-pool'` 时：

1. 跳过 docker 去重守卫（不检查 `cecelia-relay-${short}` 容器）
2. 跳过 B2/B3 codex 并发守门和额度软闸
3. 构造 brief 文件（skill 全文 + 上下文头，与 claude/codex 路径 prompt 格式一致）
4. 调用 `dispatchWorkerFn({ briefFile, dir: worktreePath })` 或等价的 `node scripts/dispatch-worker.mjs --brief <briefFile> --dir <worktreePath>`
5. spawn 失败（`ok: false`）→ task 回滚 queued，不落 `initiative_runs`
6. spawn 成功 → 落 `initiative_runs` 行：`orchestrator_host='skill-relay-worker-pool'`，`phase='A_planning'`，`deadline=NOW()+6h`
7. 不计入 `_activeCodexRelays`

**容器路径说明**：worker-pool 路径调用 dispatch-worker.mjs 时，使用绝对路径构造：
`path.resolve(__dirname, '../../../scripts/dispatch-worker.mjs')`（或等价的从 harness-skill-relay.js 所在目录出发的相对 resolve），避免容器内 cwd 歧义；宿主直跑时 cwd 已经是仓库根，两种路径均可达。

### FR-2: 调用命令格式

dispatch-worker 接收两个参数：
- `--brief <briefFile>` — brief 内容与现有 relay prompt 格式一致（skill 全文 + 上下文头）
- `--dir <worktreePath>` — worktree 绝对路径

### FR-3: initiative_runs 落行

```sql
INSERT INTO initiative_runs
  (initiative_id, phase, journey_id, orchestrator_version, orchestrator_host, deadline_at, ability_id, current_task_id)
VALUES
  ($initiativeId, 'A_planning', $journeyId, 'v2', 'skill-relay-worker-pool', NOW() + INTERVAL '6 hours', $abilityId, $taskId)
```

### FR-4: 核心任务护栏

当 `task.payload.base_repo` 解析为 cecelia repo 路径（含 `/perfect21/cecelia` 或等价识别）且合同改动路径含 `packages/brain/src` 时，executor 层（task-router 或 harness-skill-relay 入口）拒绝以 `worker-pool`（也拒绝 `codex`）派发，标 `terminal_failed`，`reason` 含 `feedback_no_core_tasks_to_codex`，不进入 dispatch-worker。

### FR-5: 白名单外 executor 值拒绝

`spawnSkillRelaySession` 接收到 `executor` 不属于 `['claude', 'codex', undefined, null, 'worker-pool']` 时，返回 `{ ok: false, error: 'unknown_executor: <value>' }`，不调用任何 spawnFn。

### FR-6: 账号选择日志可见

`.dispatch-worker-*.log` 文件（由 dispatch-worker.mjs 自动生成在 `worktreePath` 下）包含：
- `pickAccounts` 排序结果（vendor/name/usedPercent）
- 实际使用账号和 quota_wall 检测结果

---

## 不变约束

| 约束 | 检验方法 |
|------|----------|
| `dispatch-worker.mjs` 内部函数签名不变 | diff 检查：`buildCommand/dispatchWithRotation/queryUsage/pickAccounts` 无改动 |
| `_activeCodexRelays` 计数器只计 codex 路径 | 单元测试 T1 断言 worker-pool 后计数不变 |
| `_spawnHeadedSession` 的 `headedExecutor` 判断不变 | diff 检查：headed 分支无改动 |
| worker-pool 不进 headed 分支 | 单元测试：`mode='headed'` 时 isWorkerPool 不生效 |
| Grok 自然垫底（Infinity usedPercent） | dispatch-worker.mjs 已有逻辑，不改动 |

---

## Test Contract

| Workstream | Test File | Behaviors |
|---|---|---|
| [BEHAVIOR-1] worker-pool 路由到 dispatchWorkerFn | `../../packages/brain/tests/dispatch-worker-relay.test.js` | worker-pool routes to dispatchWorkerFn |
| [BEHAVIOR-2] 核心任务护栏 cecelia + brain/src → terminal_failed | `../../packages/brain/tests/dispatch-worker-relay.test.js` | core task guard rejects worker-pool with feedback_no_core_tasks_to_codex |
| [BEHAVIOR-3] worker-pool 不计入 _activeCodexRelays | `../../packages/brain/tests/dispatch-worker-relay.test.js` | worker-pool does not increment _activeCodexRelays |
| [BEHAVIOR-4] 白名单外 executor 拒绝（不静默降级） | `../../packages/brain/tests/dispatch-worker-relay.test.js` | unknown executor is rejected, no spawnFn called |
| [BEHAVIOR-5] headed 分支保持只支持 claude/codex | `../../packages/brain/tests/dispatch-worker-relay.test.js` | worker-pool routes to dispatchWorkerFn |
| [BEHAVIOR-6] 禁 mock dispatchWithRotation/buildCommand/queryUsage | `../../packages/brain/tests/dispatch-worker-relay.test.js` | unknown executor is rejected, no spawnFn called |

---

## E2E 验收

### 前置条件

```bash
# 确认 Brain 运行
curl -s localhost:5221/api/brain/context | jq '.status'

# 确认 dispatch-worker 可解析（不真实执行）
node scripts/dispatch-worker.mjs --help 2>&1 | head -5 || true
```

### E2E-1: 单元测试全绿（T1/T2/T3）

```bash
cd /workspace && node --experimental-vm-modules packages/brain/node_modules/.bin/jest \
  packages/brain/tests/dispatch-worker-relay.test.js \
  --no-coverage 2>&1 | tail -20
# 断言：PASS，T1 先 failing 再 passing，T2/T3 回归绿
```

### E2E-2: 白名单外 executor 拒绝验证

```bash
node -e "
import('/workspace/packages/brain/src/harness-skill-relay.js').then(async (m) => {
  const result = await m.spawnSkillRelaySession(
    { id: 'test-uuid', payload: { executor: 'unknown-bot', orchestrator: 'skill-relay' }, task_type: 'dev' },
    { pool: { query: async () => ({ rows: [] }) }, spawnFn: () => { throw new Error('should not be called'); } }
  );
  console.log(JSON.stringify(result));
  if (!result.ok && result.error) {
    console.log('PASS: unknown executor rejected');
  } else {
    console.log('FAIL: should have rejected unknown executor');
    process.exit(1);
  }
});
" 2>&1
```

### E2E-3: 核心任务护栏验证

```bash
node -e "
import('/workspace/packages/brain/src/harness-skill-relay.js').then(async (m) => {
  const result = await m.spawnSkillRelaySession(
    {
      id: 'core-task-uuid',
      payload: {
        executor: 'worker-pool',
        orchestrator: 'skill-relay',
        base_repo: '/Users/administrator/perfect21/cecelia',
        contract_paths: ['packages/brain/src/tick.js']
      },
      task_type: 'dev'
    },
    { pool: { query: async () => ({ rows: [] }) }, dispatchWorkerFn: () => { throw new Error('should not call dispatch-worker'); } }
  );
  console.log(JSON.stringify(result));
  if (!result.ok && JSON.stringify(result).includes('feedback_no_core_tasks_to_codex')) {
    console.log('PASS: core task guard fired');
  } else {
    console.log('FAIL: guard did not fire');
    process.exit(1);
  }
});
" 2>&1
```

### E2E-4: 真实全链验收（T4 behavior_test，可选，需真实账号）

```bash
# 发一条非核心低危任务
TASK_ID=$(curl -s -X POST localhost:5221/api/brain/tasks \
  -H 'Content-Type: application/json' \
  -d '{
    "task_type": "dev",
    "title": "smoke: worker-pool dispatch test",
    "payload": {
      "orchestrator": "skill-relay",
      "executor": "worker-pool",
      "base_repo": "zenithjoy",
      "sprint_dir": "sprints/workertest-smoke"
    }
  }' | jq -r '.id')

echo "task_id=$TASK_ID"
sleep 10

# 检查 initiative_runs 落行
psql $DATABASE_URL -c "
  SELECT orchestrator_host, phase, deadline_at
  FROM initiative_runs
  WHERE current_task_id='$TASK_ID'
  LIMIT 1;
"
# 期望：orchestrator_host='skill-relay-worker-pool', phase='A_planning'

# 检查 dispatch-worker 日志（账号选择行）
find . -name '.dispatch-worker-*.log' -newer /tmp -exec grep -l 'usedPercent\|vendor' {} \;
```

---

## 未覆盖真实链路清单

| 链路 | 未覆盖原因 | 豁免条件 |
|------|-----------|---------|
| `queryUsage` 真实网络请求 | 需要真实 codex/claude 账号 token | T4 behavior_test 覆盖（手动触发） |
| `dispatchWithRotation` 撞墙换账号重试 | 需要多账号 + 真实额度限制环境 | dispatch-worker.mjs 已有单独实测验证（2026-07-16） |
| 容器路径下 `DISPATCH_WORKER_IN_DOCKER` 模式 | 与宿主路径行为等价，dispatch-worker 内部已隔离 | NFR 规定：宿主模式优先，容器模式显式配置触发 |

---

## 依赖

- `scripts/dispatch-worker.mjs` 已存在且 2026-07-16 实测通过（冻结，不改动）
- `packages/brain/src/harness-skill-relay.js` 已有 deps 注入架构（可测试性现成）
- `initiative_runs` 表已有 `orchestrator_host` 字段（已存在字段，无 schema 迁移）
- 无新增外部依赖
