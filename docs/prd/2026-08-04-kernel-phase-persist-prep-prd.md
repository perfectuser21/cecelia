# Bug PrepPRD：Kernel 运行中 run.phase / task.status 零持久化

## 症状
r17 实证：真实进度在 GAN 第 4 轮，DB 却显示 run.phase='planning'（初值未变）、task.status='queued'、updated_at=started_at。Dashboard、watchdog、orphan-guard、人工判断全被误导。

## 根因假设
Kernel 编排器运行中没有任何代码路径持久化前进相位：只有 finalizeKernelRun 写终态（done/failed），heartbeat 单独更新；task 侧只有 reconcileKernelTaskTerminal 写终态。派发时也不置 in_progress。属系统性缺失（issue ce42f68f P1）。

## 修法
1. run.phase：loop 每轮 derive 出 decision 后，若 decision.phase ∈ {planning,gan,generate,evaluate,judge} 且与 DB 值不同 → 独立单条 UPDATE（`phase IS DISTINCT FROM $2 AND phase NOT IN ('done','failed') AND orchestrator_version='v2'`）。终态仍归 finalize 独有，此处永不写 done/failed。
   ⚠️ 死锁约束（PR #4596 教训）：对 run 行的 UPDATE 必须独立 autocommit 单语句，禁止塞进任何会再锁其他行的事务。
2. task.status：run.js 启动装载 task 后，`status='queued'` → 置 'in_progress'（单条 UPDATE WHERE status='queued'，不碰终态/已 in_progress）。

## Regression Test 计划
failing test：loop 单轮（mock ground truth phase=planning、derive 返回 gan spawn）→ 断言发出 phase 持久化 UPDATE；wait:running 决策不触发；decision.phase='failed' 不触发。run.js 启动 queued→in_progress 单测。永久留 CI。

## 验收标准
- [ ] failing test 先 commit → 修复变绿
- [ ] 守卫：逻辑接缝，CI regression test（proven-to-fire）
- [ ] DevGate 三关 + version bump
- [ ] CI 全绿
