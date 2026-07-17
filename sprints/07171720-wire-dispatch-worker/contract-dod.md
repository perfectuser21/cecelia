# DoD 清单：wire-dispatch-worker
<!-- task_id: 1f50b6ac-8076-47c5-bff6-cc6bdb79bcd1 -->
<!-- sprint_dir: sprints/07171720-wire-dispatch-worker -->
<!-- generated: 2026-07-17 -->

## BEHAVIOR 条目

### [BEHAVIOR-1] worker-pool executor 路由正确分流

**断言**：当 `task.payload.executor === 'worker-pool'` 且 `task.payload.orchestrator === 'skill-relay'` 且 `base_repo` 非 cecelia 核心时，`spawnSkillRelaySession` 必须调用 `dispatchWorkerFn`（注入的 dispatch-worker 代理），不调用 `spawnFn`（docker spawn），返回 `{ ok: true, mode: 'skill-relay', orchestratorHost: 'skill-relay-worker-pool' }`。

**验收命令（manual:bash）**：

```bash
node --experimental-vm-modules /workspace/packages/brain/node_modules/.bin/jest \
  /workspace/packages/brain/tests/dispatch-worker-relay.test.js \
  -t "worker-pool routes to dispatchWorkerFn" \
  --no-coverage 2>&1 | grep -E "PASS|FAIL|✓|✗|worker-pool"
```

---

### [BEHAVIOR-2] 核心任务护栏：base_repo=cecelia + packages/brain/src → terminal_failed

**断言**：`base_repo` 解析含 `perfect21/cecelia` 或 `base_repo === 'cecelia'` 且 `payload.contract_paths`（或等价字段）含 `packages/brain/src` 路径前缀时，`spawnSkillRelaySession` 必须返回 `{ ok: false }` 且 `reason` 或 `error` 字符串含 `feedback_no_core_tasks_to_codex`，任务被标 `terminal_failed`，不调用 `dispatchWorkerFn` 也不调用 `spawnFn`。

**验收命令（manual:bash）**：

```bash
node --experimental-vm-modules /workspace/packages/brain/node_modules/.bin/jest \
  /workspace/packages/brain/tests/dispatch-worker-relay.test.js \
  -t "core task guard rejects worker-pool with feedback_no_core_tasks_to_codex" \
  --no-coverage 2>&1 | grep -E "PASS|FAIL|core|feedback_no_core"
```

**补充快速验证（manual:bash）**：

```bash
node -e "
import('/workspace/packages/brain/src/harness-skill-relay.js').then(async (m) => {
  const r = await m.spawnSkillRelaySession(
    { id: 'test-1', payload: { executor: 'worker-pool', orchestrator: 'skill-relay', base_repo: '/Users/administrator/perfect21/cecelia', contract_paths: ['packages/brain/src/tick.js'] }, task_type: 'dev' },
    { pool: { query: async () => ({ rows: [] }) }, dispatchWorkerFn: () => { throw new Error('SHOULD NOT CALL'); } }
  );
  const pass = !r.ok && JSON.stringify(r).includes('feedback_no_core_tasks_to_codex');
  console.log(pass ? 'PASS' : 'FAIL', JSON.stringify(r));
  process.exit(pass ? 0 : 1);
});" 2>&1
```

---

### [BEHAVIOR-3] _activeCodexRelays 计数器不计入 worker-pool 路径

**断言**：执行一次 `worker-pool` executor 的 `spawnSkillRelaySession`（成功 spawn）后，`_activeCodexRelays` 值保持 0（不递增）；而执行一次 `codex` executor 成功 spawn 后 `_activeCodexRelays` 变为 1。两条路径计数器行为相互独立。

**验收命令（manual:bash）**：

```bash
node --experimental-vm-modules /workspace/packages/brain/node_modules/.bin/jest \
  /workspace/packages/brain/tests/dispatch-worker-relay.test.js \
  -t "worker-pool does not increment _activeCodexRelays" \
  --no-coverage 2>&1 | grep -E "PASS|FAIL|activeCodex"
```

---

### [BEHAVIOR-4] 白名单外 executor 值被拒绝（不静默降级）

**断言**：`task.payload.executor` 为 `'unknown-bot'`（或任何非 `claude`/`codex`/`undefined`/`null`/`worker-pool` 的值）时，`spawnSkillRelaySession` 必须返回 `{ ok: false, error: ... }`，且 `error` 字段非空，不调用任何 `spawnFn` 或 `dispatchWorkerFn`。

**验收命令（manual:bash）**：

```bash
node -e "
import('/workspace/packages/brain/src/harness-skill-relay.js').then(async (m) => {
  let spawnCalled = false;
  const r = await m.spawnSkillRelaySession(
    { id: 'test-3', payload: { executor: 'unknown-bot', orchestrator: 'skill-relay' }, task_type: 'dev' },
    {
      pool: { query: async () => ({ rows: [] }) },
      spawnFn: () => { spawnCalled = true; },
      dispatchWorkerFn: () => { spawnCalled = true; }
    }
  );
  const pass = !r.ok && !spawnCalled && r.error;
  console.log(pass ? 'PASS' : 'FAIL', JSON.stringify(r), 'spawnCalled=' + spawnCalled);
  process.exit(pass ? 0 : 1);
});" 2>&1
```

---

### [BEHAVIOR-5] headed 分支保持只支持 claude/codex（worker-pool 不进 headed）

**断言**：`task.payload.mode === 'headed'` + `task.payload.executor === 'worker-pool'` 时，`spawnSkillRelaySession` 必须走 headed 分支（`_spawnHeadedSession`）但 headed 分支内部的 `headedExecutor` 判断忽略 `worker-pool`（按缺省 `codex` 处理），不走 dispatch-worker 路径。`worker-pool` executor 值在 headed 模式下不产生 dispatch-worker 调用。

**验收命令（manual:bash）**：

```bash
node --experimental-vm-modules /workspace/packages/brain/node_modules/.bin/jest \
  /workspace/packages/brain/tests/dispatch-worker-relay.test.js \
  -t "headed mode with worker-pool executor uses headed branch not dispatch-worker" \
  --no-coverage 2>&1 | grep -E "PASS|FAIL|headed"
```

---

### [BEHAVIOR-6] dispatch-worker 真实调用边不被 mock 为 no-op

**断言**：测试文件 `packages/brain/tests/dispatch-worker-relay.test.js` 中，`dispatchWithRotation`、`buildCommand`、`queryUsage` 三个函数不被 `jest.fn()` / `jest.spyOn` stub 为无操作实现；允许 stub `runWorker`（实际 spawn 子进程）以避免真实网络请求，但账号选择逻辑（`pickAccounts` + `queryUsage` mock 数据注入）必须真实执行，能覆盖 Grok 垫底（Infinity usedPercent）行为。

**验收命令（manual:bash）**：

```bash
# 确认测试文件中无对核心函数的 no-op stub
grep -n "jest.fn\|jest.spyOn\|mock" /workspace/packages/brain/tests/dispatch-worker-relay.test.js \
  | grep -v "runWorker\|dispatchWorkerFn\|spawnFn\|pool\|execFn\|loadSkill\|ensureWt\|tokenFn\|resolveAccountFn" \
  | grep -iE "dispatchWithRotation|buildCommand|queryUsage" \
  && echo "FAIL: 禁止 stub 真实调用边" || echo "PASS: 核心函数未被 no-op stub"
```

---

## 回归门禁

所有已有测试不退：

```bash
node --experimental-vm-modules /workspace/packages/brain/node_modules/.bin/jest \
  /workspace/packages/brain/tests/ \
  --no-coverage 2>&1 | tail -10
# 期望：全 PASS，无新增 FAIL
```

---

## CI 门禁

```bash
# brain-ci.yml 等价本地验证
node --experimental-vm-modules /workspace/packages/brain/node_modules/.bin/jest \
  /workspace/packages/brain/tests/ \
  --ci --no-coverage 2>&1 | grep -E "Tests:|Test Suites:|PASS|FAIL"
```

---

## 完成标准 Checklist

- [ ] T1 先 failing（改动前），接线后 passing（提交顺序保证）
- [ ] T2（核心任务护栏）回归绿
- [ ] T3（白名单外 executor 拒绝）回归绿
- [ ] T4（真实全链，behavior_test）可选运行，`.dispatch-worker-*.log` 含账号选择行
- [ ] `scripts/dispatch-worker.mjs` 无任何改动（git diff 确认）
- [ ] `_spawnHeadedSession` 无任何改动（headed 分支行为不变）
- [ ] `_activeCodexRelays` 只在 `isCodex` 路径递增（worker-pool 路径不触碰该计数器）
- [ ] `initiative_runs.orchestrator_host='skill-relay-worker-pool'` 落行（DB 可查）
- [ ] CI `brain-ci.yml` 全绿
