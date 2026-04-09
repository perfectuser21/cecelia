# Task Card

**task_id**: 66ce68db-2a40-4d02-b6ec-fbcd41a438fc  
**branch**: cp-66ce68db-fix-harness-quiet  
**类型**: fix(brain)

## 背景

1. Harness Pipeline 架构决策（2026-04-09）明确：`harness_evaluate`、`harness_ci_watch`、`harness_deploy_watch` 应砍掉，/dev 跑完 PR 合并即结束，直接走 `harness_report`。但 execution.js 代码未跟上，仍在创建这些废弃链路。

2. `BRAIN_QUIET_MODE=true` 应跳过所有后台 LLM 调用，但 `runDesireSystem`（含 reflection）和 `triggerCodeQualityScan` 未被保护，每次 tick 仍在执行。

## 要做的事

### Fix 1: execution.js — harness_generate 完成后直接 harness_report

- `harness_generate` callback：pr_url 存在时，直接创建 `harness_report`（不再创建 `harness_ci_watch`）
- `harness_fix` callback：同样，修完后直接创建 `harness_report`
- 删掉 `harness_ci_watch` required payload 校验（不再需要）

### Fix 2: tick.js — runDesireSystem + triggerCodeQualityScan 加 BRAIN_QUIET_MODE 保护

- `runDesireSystem` 调用块加 `if (!BRAIN_QUIET_MODE)` 保护
- `triggerCodeQualityScan` 调用块加 `if (!BRAIN_QUIET_MODE)` 保护

## DoD

- [x] `execution.js`：`harness_generate` 完成后创建 `harness_report`，不再创建 `harness_ci_watch`
- [x] `execution.js`：`harness_fix` 完成后同样直接 `harness_report`
- [x] `tick.js`：`runDesireSystem` 被 `BRAIN_QUIET_MODE` 保护
- [x] `tick.js`：`triggerCodeQualityScan` 被 `BRAIN_QUIET_MODE` 保护
- [x] [BEHAVIOR] Brain 日志中不再出现 `desire system` 或 `reflection` 相关调用（BRAIN_QUIET_MODE=true 时）
  - Test: `manual:node -e "const s=require('fs').readFileSync('packages/brain/src/tick.js','utf8'); if(!/if\s*\(!BRAIN_QUIET_MODE\)[\s\S]{0,200}runDesireSystem/.test(s))process.exit(1); console.log('PASS')"`
- [x] [BEHAVIOR] execution.js 中 harness_generate 不再引用 harness_ci_watch
  - Test: `manual:node -e "const s=require('fs').readFileSync('packages/brain/src/routes/execution.js','utf8'); const m=s.match(/harness_generate[\s\S]{0,2000}harness_ci_watch/); if(m)process.exit(1); console.log('PASS')"`
