# T4 — spawn-logging fail-fast on missing task.id

**Date**: 2026-04-24
**Status**: Approved
**Task**: `553ad51a-c644-47ed-bd8b-658635cfabcb`
**Scope**: 单文件修改 + 1 测试 case

## 1. 目标
修 `packages/brain/src/spawn/middleware/logging.js:16` 对缺 `opts.task.id` 的 silent fallback（直接落到 `'unknown'` 无日志），改为打 `console.warn`。消除 Brain docker logs 17+ 条 `taskId=unknown` 历史盲区（Phase B2 forensic 发现 8+ 小时无人报警）。

## 2. 现状

```js
// packages/brain/src/spawn/middleware/logging.js L14-18
export function createSpawnLogger(opts, ctx = {}) {
  const log = ctx.log || console.log;
  const taskId = opts?.task?.id || 'unknown';
  const taskType = opts?.task?.task_type || 'unknown';
  const skill = opts?.skill || 'unknown';
  ...
}
```

3 处 silent fallback（`taskId` / `taskType` / `skill`），其中 `taskId` 缺失最严重（pipeline-patrol / zombie-cleaner 等其它 log 都跟着写 unknown）。

## 3. 设计

### 3.1 改动
- 注入 `ctx.warn`（对齐已有 `ctx.log`）默认 `console.warn`
- `taskIdMissing` flag：`opts?.task?.id` 缺失时 true
- `logStart()` 入口若 `taskIdMissing === true` → `warn('[spawn-logger] missing task.id (falling back to \"unknown\")')`

### 3.2 只改 taskId（YAGNI）
`taskType` / `skill` 缺失严重性低 + 噪音风险高，**不改**。若后续有需要再扩展。

### 3.3 具体代码

```js
export function createSpawnLogger(opts, ctx = {}) {
  const log = ctx.log || console.log;
  const warn = ctx.warn || console.warn;

  const rawTaskId = opts?.task?.id;
  const taskIdMissing = !rawTaskId;
  const taskId = rawTaskId || 'unknown';
  const taskType = opts?.task?.task_type || 'unknown';
  const skill = opts?.skill || 'unknown';
  const startedAt = Date.now();

  return {
    logStart() {
      if (taskIdMissing) {
        warn('[spawn-logger] missing task.id (falling back to "unknown")');
      }
      log(`[spawn] start task=${taskId} type=${taskType} skill=${skill} account=${opts?.env?.CECELIA_CREDENTIALS || 'auto'}`);
    },
    logEnd(result) {
      // 原逻辑不动
      ...
    },
  };
}
```

## 4. 测试

新增 case（第 5 个）在 `packages/brain/src/spawn/__tests__/logging.test.js`：

```js
it('logStart warns when task.id missing', () => {
  const logs = [];
  const warns = [];
  const l = createSpawnLogger(
    { task: { task_type: 'dev' }, skill: '/dev', env: {} },
    { log: (m) => logs.push(m), warn: (m) => warns.push(m) },
  );
  l.logStart();
  expect(warns).toHaveLength(1);
  expect(warns[0]).toContain('[spawn-logger] missing task.id');
  expect(logs[0]).toContain('task=unknown');
});
```

现有 4 cases 不退化。

## 5. 成功标准
- warn 在缺 task.id 时打；有 task.id 时不打
- 测试 ≥ 5 cases 全 pass
- 现有 spawn 子树 62 cases 不退化

## 6. 不做
- `taskType` / `skill` fallback（YAGNI）
- 新增 metrics.incrementCounter 基础设施
- caller 侧 fix（root cause 在调用方，另一 PR）
- zombie-cleaner.js 侧 taskId=unknown log（另一 PR，不同 root cause）
- warn 升级到 thalamus alert
