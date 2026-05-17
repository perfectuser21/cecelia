# spawn-logging fail-fast on missing task.id — 消除 taskId=unknown 盲区

## Goal
让 `logging.js` 缺失 `opts.task.id` 时打 `console.warn` 不再静默落到 `'unknown'`。修 Phase B2 forensic 发现的"Brain logs 17 条 taskId=unknown 8+ 小时无人报警"盲区。

## 背景
Phase B2 forensic 调查 zombie-cleaner 误杀 bug 时发现：Brain docker logs 17 条 `Orphan worktree ... taskId=unknown`（zombie-cleaner 打的）+ `logging.js:16` 对缺 `opts?.task?.id` silent fallback 到 `'unknown'` → 故障在监控层隐形。本 PR 修 spawn 层 silent fallback（zombie-cleaner 侧另一 PR）。

## Tasks
1. 改 `packages/brain/src/spawn/middleware/logging.js`：
   - 加 `taskIdMissing` 旗标 + `ctx.warn` 注入
   - `logStart()` 入口若 `taskIdMissing=true` → `warn('[spawn-logger] missing task.id (falling back to unknown)')`
2. 改 `packages/brain/src/spawn/__tests__/logging.test.js`：加 1 case 断言 warn 被调用
3. 现有 4 cases 不退化

## 成功标准
- `logging.js` 对缺 task.id 产生显式 warn，非 silent fallback
- 测试 ≥ 5 cases 全 pass
- warn 通过 `ctx.warn` 注入便于测试（对齐现有 `ctx.log` 模式）
- 不改 `account-rotation.js` / `cap-marking.js` 等其它 middleware 的 `|| 'unknown'` fallback（范围外）

## 不做
- 不升级 warn 到 thalamus alert（YAGNI）
- 不改 caller（root cause 在调用方传 opts，那是另一 PR）
- 不新增 metrics.incrementCounter 基础设施
- 不改 zombie-cleaner 侧的 taskId=unknown log（另一 PR，不同 root cause）

## DoD
- [BEHAVIOR] logging.js taskIdMissing 旗标 + warn 触发；Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/spawn/middleware/logging.js','utf8'); if(!c.includes('taskIdMissing')||!c.includes('missing task.id')) process.exit(1)"
- [BEHAVIOR] logging.test.js ≥ 5 cases 全 pass；Test: tests/packages/brain/src/spawn/__tests__/logging.test.js

## 风险
- `ctx.warn` 注入可能影响现有调用方（他们用默认 console.warn，应无副作用）
- warn 过多污染日志：只在 task.id 真缺失时触发，预期低频

