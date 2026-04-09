# Task Card: Harness Pipeline 稳定性修复 — 4 个 Bug

## 任务目标

修复阻塞 Harness v4.0 自主运行的 4 个 Bug，使 pipeline 能完整跑通无需人工干预。

## 背景

E2E v4 测试显示：
1. `harness-watcher.js` CI 失败路径 SQL 类型推断错误 → watcher crash
2. `tick.js` 超时重入队错误计入熔断器失败次数 → 熔断误开
3. `execution.js` 创建 `harness_ci_watch` 任务缺少 `description` 字段 → pre-flight 拒绝
4. `account-usage-scheduling.test.js` H2/H3 因 H1 设置的 spending cap 泄漏导致测试失败 → brain-unit CI 失败

## DoD

- [x] **[ARTIFACT]** `harness-watcher.js` 中 SQL 参数改为 `$2::text` 和 `$3::int`
  - Test: `manual:node -e "const c=require('fs').readFileSync('packages/brain/src/harness-watcher.js','utf8');if(!c.includes('\$2::text'))process.exit(1);console.log('OK')"`

- [x] **[ARTIFACT]** `tick.js` 超时重入队路径不再调用 `recordFailure('cecelia-run')`
  - Test: `manual:node -e "const c=require('fs').readFileSync('packages/brain/src/tick.js','utf8');if(c.includes('requeue') && c.includes('recordFailure'))process.exit(1);console.log('OK')"`

- [x] **[ARTIFACT]** `execution.js` 两处 `harness_ci_watch` 创建路径（generate/fix 完成后）均包含非空 `description`（已存在，无需修改）
  - Test: `manual:node -e "const c=require('fs').readFileSync('packages/brain/src/routes/execution.js','utf8');if(!c.includes('等待 CI 通过后创建 Evaluator'))process.exit(1);console.log('OK')"`

- [x] **[BEHAVIOR]** `account-usage-scheduling.test.js` H2 和 H3 通过（无 spending cap 状态泄漏）
  - Test: `tests/brain-unit`

## 成功标准

`brain-unit` CI 全部通过；harness pipeline 可在 CI 失败路径下正常路由；超时重入队不再触发熔断器。
