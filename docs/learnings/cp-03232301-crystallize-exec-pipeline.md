# Learning: crystallize 执行闭环断线修复

**Branch**: cp-03232301-81ddb0f9-8464-4db2-ad9c-e1c3cd
**Date**: 2026-03-24
**PR**: feat(brain): crystallize 执行闭环 — 补全3个断线

---

### 根本原因

crystallize task type (PR #1491) 建立了4步流水线的状态机框架，但执行层有3个断线遗漏：

1. `playwright-runner.sh` 没有 `send_callback()` 函数，子任务完成后不向 Brain 回传执行结果
2. `execution.js` 的 execution-callback 路由只处理了 content-pipeline 类型，`crystallize_*` 子任务完成后不调用 `advanceCrystallizeStage`
3. `executor.js` 的 `triggerCodexBridge` 没有 `isCrystallize` 分支，crystallize 子任务无法使用 playwright-runner.sh 执行

这导致 crystallize 流水线无法端到端运转：stage 完成了但流水线不推进。

### 下次预防

- [ ] 新增 orchestrator（状态机）时，必须同步完成"执行层闭环"checklist：runner 回传 + execution.js callback handler + executor.js dispatch 分支
- [ ] 参照已有类型（content-pipeline → execution.js 5c11块）做对称实现，避免遗漏
- [ ] PR 合并前在 task 卡 DoD 中明确勾选执行层3个必须点
- [ ] engine 文件（runners/）有变更时，PR title 加 `[CONFIG]` 并 bump engine 版本（5个文件同步）：package.json / package-lock.json（两处）/ VERSION / .hook-core-version / regression-contract.yaml
- [ ] rebase 到 main 之前先确认是否有冲突，特别是同一 PR 批次中同名文件的冲突（add/add conflict）
