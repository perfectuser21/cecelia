# Sprint Contract: Harness v4.0 自身流程优化

**任务 ID**: 402f7dd7-347b-4063-84ba-1bbca40ec2c8
**Sprint Dir**: sprints/harness-v4-self-optimize
**状态**: APPROVED（手动批准，跳过 GAN 阶段）

---

## Feature 1: GAN MAX_GAN_ROUNDS 防死循环

**位置**: `packages/brain/src/routes/execution.js` — REVISION 路由
**描述**: GAN 对抗（contract_review REVISION）每轮创建新的 propose 任务，无上限可能死循环。
**修复**: 添加 `MAX_GAN_ROUNDS = 3` 常量，`nextRound > MAX_GAN_ROUNDS` 时停止对抗，打印错误日志，不创建新 propose 任务。

**验收**:
```
node -e "
const c = require('fs').readFileSync('packages/brain/src/routes/execution.js', 'utf8');
if (!c.includes('MAX_GAN_ROUNDS')) { console.error('FAIL: MAX_GAN_ROUNDS not found'); process.exit(1); }
if (!c.includes('nextRound > MAX_GAN_ROUNDS') && !c.includes('nextRound >= MAX_GAN_ROUNDS')) {
  console.error('FAIL: no MAX_GAN_ROUNDS guard'); process.exit(1);
}
console.log('PASS');
"
```

---

## Feature 2: CI watch 超时创建 harness_evaluate(ci_timeout:true)

**位置**: `packages/brain/src/harness-watcher.js` — timeout 路径
**描述**: CI watch 超过 `MAX_CI_WATCH_POLLS` 时，当前只标记 failed，不触发 Evaluator。
**修复**: 超时时额外创建 `harness_evaluate` 任务，payload 含 `ci_timeout: true`，让 Evaluator 做静态分析。

**验收**:
```
node -e "
const c = require('fs').readFileSync('packages/brain/src/harness-watcher.js', 'utf8');
if (!c.includes('ci_timeout')) { console.error('FAIL: ci_timeout not found in harness-watcher.js'); process.exit(1); }
if (!c.includes('harness_evaluate')) { console.error('FAIL: harness_evaluate creation not found on timeout'); process.exit(1); }
console.log('PASS');
"
```

---

## Feature 3: harness_fix 后 pr_url 正确传递

**位置**: `packages/brain/src/routes/execution.js` — harness_evaluate FAIL → harness_fix 路径
**描述**: harness_evaluate FAIL 创建 harness_fix 时，payload 未包含 `pr_url`，导致 harness_fix 完成后无法创建有效 harness_ci_watch。
**修复**: 在 harness_fix payload 中加入 `pr_url: harnessPayload.pr_url`。

**验收**:
```
node -e "
const c = require('fs').readFileSync('packages/brain/src/routes/execution.js', 'utf8');
// 找 harness_evaluate FAIL → harness_fix 创建块，确认 pr_url 在 payload 里
const fixBlock = c.match(/FAIL.*harness_fix[\s\S]{0,2000}task_type.*harness_fix[\s\S]{0,500}payload[\s\S]{0,300}/);
if (!fixBlock) { console.error('FAIL: harness_fix creation block not found'); process.exit(1); }
// 找 harness_evaluate FAIL 块中 harness_fix 的 payload
const evalFailIdx = c.indexOf('FAIL → harness_fix');
const fixPayloadIdx = c.indexOf('pr_url: harnessPayload.pr_url', evalFailIdx);
if (fixPayloadIdx === -1) { console.error('FAIL: pr_url not passed to harness_fix payload'); process.exit(1); }
console.log('PASS');
"
```

---

## Feature 4: deploy_watch 超时降级测试覆盖

**位置**: `packages/brain/src/harness-watcher.js` — deploy timeout 路径
**描述**: deploy_watch 超时时调用 `_createHarnessReport(task, payload, 'deploy_timeout')` 并计入 `deploy_passed++`（不准确）。
**修复**: 超时时在 report payload 中加入 `coverage_degraded: true`，计数器改为 `deploy_pending++`（代表降级）。

**验收**:
```
node -e "
const c = require('fs').readFileSync('packages/brain/src/harness-watcher.js', 'utf8');
if (!c.includes('coverage_degraded')) { console.error('FAIL: coverage_degraded not found'); process.exit(1); }
console.log('PASS');
"
```

---

## Feature 5: harness-watcher.js 30s 轮询节流

**位置**: `packages/brain/src/harness-watcher.js`
**描述**: harness-watcher 每次 Brain tick（5s）都执行，高频 CI 轮询浪费 gh CLI 调用。
**修复**: 添加模块级 `_lastHarnessWatchMs = 0` 和 `HARNESS_WATCH_INTERVAL_MS = 30000`，`processHarnessCiWatchers` 入口检查节流，未到 30s 直接返回空结果。

**验收**:
```
node -e "
const c = require('fs').readFileSync('packages/brain/src/harness-watcher.js', 'utf8');
if (!c.includes('HARNESS_WATCH_INTERVAL_MS')) { console.error('FAIL: HARNESS_WATCH_INTERVAL_MS not found'); process.exit(1); }
if (!c.includes('_lastHarnessWatchMs') && !c.includes('lastHarnessWatchMs')) {
  console.error('FAIL: throttle timestamp not found'); process.exit(1);
}
console.log('PASS');
"
```
