# Learning — codex-review 回调误触 cecelia-run 熔断器（2026-05-05）

分支：cp-0505100001-codex-review-circuit-breaker-fix
版本：Brain 1.228.0

## 故障

Brain `cecelia-run` 熔断器反复打开，359 次失败计数，阻塞所有 dev 任务派发。
`circuit_breaker_states` 表记录：state=OPEN，failures=359，last_failure 持续增长。

## 根本原因

`arch_review` / `code_review` 任务调用 `triggerCodexReview()`，后者 spawn Docker 内
`/opt/homebrew/bin/codex`（macOS homebrew 路径）。Docker 容器里该路径不存在，
child process 触发 `ENOENT` 错误，`child.on('error')` 处理器通过回调接口发回
`coding_type='codex-review'` 的失败 callback。

`callback-processor.js` 的失败处理分支未区分 `coding_type`，直接调用
`cbFailure('cecelia-run')`（对应 `circuit-breaker.recordFailure('cecelia-run')`）。
每次 arch_review 任务被派到 Docker 就触发一次，8 次后熔断，5 分钟探针也失败
（`triggerCodexReview` 同样 spawn），循环打开，最终累计 359 次。

## 解法

`callback-processor.js` destructure 时新增 `coding_type` 字段，并在失败处理链中增加
`isCodexReview` 分支：

```js
const isCodexReview = coding_type === 'codex-review';

if (isBillingCap || isTransientApiError) {
  // 跳过熔断计数
} else if (isCodexReview) {
  // codex-review 走独立执行池，失败不归因 cecelia-run 熔断器
  console.log(`[callback-processor] codex-review 失败，跳过 cecelia-run 熔断计数`);
  raise('P2', 'task_failed', ...).catch(() => {});
} else {
  await cbFailure('cecelia-run');
  raise('P2', 'task_failed', ...).catch(() => {});
}
```

## 下次预防

- [ ] `cbFailure('cecelia-run')` 只应该被调用当 cecelia agent 进程本身失败（执行超时、进程崩溃）；codex、arch_review 等辅助工具失败不等于 cecelia-run 失败，调用前必须检查 coding_type
- [ ] `triggerCodexReview` 的 ENOENT 根因未修（Docker 里没有 codex binary）；本次 fix 只是正确归因，下一步应让 arch_review 任务在 Docker 环境下优雅降级（跳过 codex 步骤或改用 API）
- [ ] 新增熔断路径时必须同步更新测试，避免出现"熔断计数路径无测试覆盖"的盲区
- [ ] 发现熔断器 OPEN 时，先查 `circuit_breaker_states` 确认 failures 计数趋势，再 grep `cbFailure` 所有调用点，逐一核对触发条件是否与被保护的资源严格对应
