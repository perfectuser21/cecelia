# Sprint PRD: research 任务派发 payload 缺必填字段

## 任务信息
- Task ID: dd34e184-2ebb-4fc2-a943-31bb05f68ab2
- Sprint Dir: sprints/07141331-research-dispatch-payload
- 日期: 2026-07-14

## 根因分析

**根因：`buildCodexBridgePayload` 没有在 payload 中携带 `callback_url` 字段，而 xian bridge `/run` 端点要求该字段为必填。**

### 调用链

```
dispatchNextTask()                        → dispatcher.js
  └─ triggerCeceliaRun(task)              → executor.js:3137
       └─ triggerCodexBridge(task)         → executor.js:2636
            └─ buildCodexBridgePayload()   → executor.js:2594
                 POST bridgeUrl/run
                 → xian bridge 返回 { ok: false, error: "task_id 和 callback_url 必填" }
                 → execResult.success = false
                 → dispatcher.js:755 打印错误日志
                 → recordFailure('cecelia-run')  ← 14+ 次后熔断器跳
```

### 具体位置

**问题文件**：`/workspace/packages/brain/src/executor.js`

**第 2594-2607 行 `buildCodexBridgePayload`**：
```js
function buildCodexBridgePayload(task, promptContent, taskBranch, injectedAccounts, isCodexDev, isCrystallize) {
  const { runner, runner_args } = buildCodexRunnerConfig(task, taskBranch, isCodexDev, isCrystallize);
  return {
    task_id: task.id,
    checkpoint_id: null,
    prompt: promptContent,
    task_type: task.task_type,
    work_dir: task.payload?.repo_path,
    timeout_ms: 10 * 60 * 1000,
    runner,
    runner_args,
    branch: taskBranch,
    accounts: injectedAccounts.length > 0 ? injectedAccounts : undefined,
    // ❌ 缺少 callback_url
  };
}
```

**第 2636-2669 行 `triggerCodexBridge`**（调用方，research 路由到此）：
```js
async function triggerCodexBridge(task, forceBridgeUrl = null) {
  // ...
  const payload = buildCodexBridgePayload(...);  // 没有 callback_url
  const response = await fetch(`${bridgeUrl}/run`, {
    body: JSON.stringify(payload),  // bridge 拒绝此 payload
  });
```

**第 2659-2661 行**：bridge 返回 `{ ok: false, error: "task_id 和 callback_url 必填" }` 后：
```js
if (!result.ok) {
  return { success: false, taskId: task.id, error: result.error, executor: 'codex-bridge' };
}
```

### 路由链

- `research` 任务在 `task-router.js:256` 被标记为 `location: 'xian'`
- `executor.js:3213-3221`：`location === 'xian'` → `triggerCodexBridge(task)`
- 所有走 xian bridge 的 task_type（research, codex_qa, codex_dev, content-research 等）都经过 `buildCodexBridgePayload`，都缺 `callback_url`

### 为什么此前未触发

xian bridge 的 `/run` 端点验证在某次 bridge 版本升级中新增了 `callback_url` 必填校验，而 brain 侧的 `buildCodexBridgePayload` 没有同步更新。codex_dev 等任务因有 `runner` 字段走不同处理路径可能通过（或之前 bridge 版本更宽松），research 任务只有 prompt 无 runner，触发了此校验。

### 熔断链

- dispatcher.js:770：`execResult.success=false` 且非 `configError`/`spawn_deduplicated` → `recordFailure('cecelia-run')`
- 14+ 次失败 → `circuit-breaker.js` 开路
- `isAllowed('cecelia-run')` 返回 false → 所有后续任务被 `circuit_breaker_open` 拦截 → 34 分钟无派发

---

## 修复方案

**在 `buildCodexBridgePayload` 中加入 `callback_url` 字段。**

callback_url 指向 brain 的 execution-callback 端点，格式与其他路径一致：
`${BRAIN_URL}/api/brain/execution-callback`

其中 `BRAIN_URL` 优先读 `process.env.BRAIN_URL`，降级到 `http://localhost:5221`（与 executor.js:2439, 2464 保持一致）。

**修改位置**：`/workspace/packages/brain/src/executor.js`，`buildCodexBridgePayload` 函数（约第 2594 行）。

将返回对象新增 `callback_url` 字段：
```js
function buildCodexBridgePayload(task, promptContent, taskBranch, injectedAccounts, isCodexDev, isCrystallize) {
  const { runner, runner_args } = buildCodexRunnerConfig(task, taskBranch, isCodexDev, isCrystallize);
  const brainUrl = process.env.BRAIN_URL || 'http://localhost:5221';
  return {
    task_id: task.id,
    checkpoint_id: null,
    prompt: promptContent,
    task_type: task.task_type,
    work_dir: task.payload?.repo_path,
    timeout_ms: 10 * 60 * 1000,
    runner,
    runner_args,
    branch: taskBranch,
    accounts: injectedAccounts.length > 0 ? injectedAccounts : undefined,
    callback_url: `${brainUrl}/api/brain/execution-callback`,  // ← 新增
  };
}
```

---

## 测试计划

### Step 1: Failing Test（先 commit）

**文件位置**：`/workspace/packages/brain/src/__tests__/codex-bridge-payload-callback-url.test.js`

**测试策略**：单元测试，直接测试 `buildCodexBridgePayload` 的输出，mock `fetch` 验证 POST 到 bridge 时 payload 携带 `callback_url`。

```js
// 文件: packages/brain/src/__tests__/codex-bridge-payload-callback-url.test.js
// 测试用例描述：

describe('buildCodexBridgePayload — callback_url 必填字段', () => {
  it('research 任务的 payload 必须包含 callback_url', () => {
    // 调用 buildCodexBridgePayload 构造 research 任务 payload
    // 断言 payload.callback_url 存在且匹配 /api/brain/execution-callback
  });

  it('callback_url 指向 BRAIN_URL env 配置的地址', () => {
    // 设置 process.env.BRAIN_URL = 'http://hk-vps:5221'
    // 验证 payload.callback_url === 'http://hk-vps:5221/api/brain/execution-callback'
  });

  it('BRAIN_URL 未设置时 callback_url 降级到 localhost:5221', () => {
    // 删除 process.env.BRAIN_URL
    // 验证 payload.callback_url === 'http://localhost:5221/api/brain/execution-callback'
  });

  it('codex_dev / crystallize_forge 等其他 xian task_type 同样携带 callback_url', () => {
    // 验证 buildCodexBridgePayload 对 codex_dev 任务也携带 callback_url
  });
});

describe('triggerCodexBridge — research 任务 — bridge 拒绝缺 callback_url 时返回 success=false', () => {
  it('bridge 返回 { ok: false, error: "task_id 和 callback_url 必填" } → execResult.success=false', async () => {
    // mock fetch 返回该错误
    // mock research 任务调用 triggerCeceliaRun
    // 断言返回 { success: false, error: "task_id 和 callback_url 必填" }
    // (修复前必须先写这个 failing test)
  });
});
```

**运行命令**（修复前应红）：
```bash
cd /workspace && npx vitest run packages/brain/src/__tests__/codex-bridge-payload-callback-url.test.js
```

### Step 2: 修复

修改 `/workspace/packages/brain/src/executor.js` 第 2594 行附近的 `buildCodexBridgePayload` 函数，在返回对象中加入：
```js
callback_url: `${process.env.BRAIN_URL || 'http://localhost:5221'}/api/brain/execution-callback`,
```

### Step 3: 验收

```bash
# 单元测试全绿
cd /workspace && npx vitest run packages/brain/src/__tests__/codex-bridge-payload-callback-url.test.js

# 回归测试——确保 dispatcher 整体不受影响
cd /workspace && npx vitest run packages/brain/src/__tests__/dispatch-executor-fail.test.js
cd /workspace && npx vitest run packages/brain/src/__tests__/dispatcher.test.js

# 整体 brain 测试（CI 红警）
cd /workspace && npx vitest run packages/brain/src
```

---

## Invariant 约束
- 熔断器逻辑不动（circuit-breaker.js）：本次修复面向 payload 构造，不改熔断阈值/策略
- dispatcher 候选选择不动（selectNextDispatchableTask）：只修 triggerCodexBridge 调用链
- 所有 xian bridge 路径（research/codex_dev/crystallize_forge 等）修复后均携带 callback_url
- 不真调外部 webhook：测试内 fetch 全部 mock
- regression test 永久进 CI，不得删除

## 累积 FR
- FR-1：`buildCodexBridgePayload` 构造的 payload 必须包含 `callback_url` 字段
- FR-2：`callback_url` = `${BRAIN_URL}/api/brain/execution-callback`（BRAIN_URL 读 env，降级 localhost:5221）
- FR-3：研究任务（task_type=research）经过 triggerCodexBridge → xian bridge 后不再触发熔断器计数
- FR-4：回归验证：dev/content/codex_dev 等现有 xian 任务派发行为不变（既有测试全过）

## NFR
- 无性能/可用性额外要求：单字段新增，无 IO/DB 改动
- 测试覆盖：callback_url 字段有无 BRAIN_URL env 两种情况均有断言

## 铁律约束
- 不改熔断器逻辑（circuit-breaker.js 不动）
- 不动 dispatcher 候选选择（selectNextDispatchableTask 不动）
- 不真调外部 webhook，全部 mock（测试内 fetch 全部使用 vi.fn() mock）
- regression test 永久进 CI（测试文件提交后不得删除）

---

## 文件清单

### 新建
- `/workspace/packages/brain/src/__tests__/codex-bridge-payload-callback-url.test.js`（新建，failing test，先 commit）

### 修改
- `/workspace/packages/brain/src/executor.js`（修改 `buildCodexBridgePayload` 函数，约第 2594-2607 行，加入 `callback_url` 字段）

journey_type: bug_fix
target_environment: local_api
