# liveness 误判 codex-review 修复设计（issue f1d6840f，arch_review 最后一环）

Brain task: e34bb2d0；决策 9befa9c3。

## 根因（三轮真机复现 + 代码全图）
两层探活互不相通：
- 合同层 `assessTaskLiveness`（executor-contracts.js:259）对 executor_kind=null 正确 fail-open，三个调用方（zombie-reaper/tick-helpers/healing）都跳过——没杀它
- **真凶=进程层 `probeTaskLiveness`（executor.js:3915，tick 每2分钟 + recovery-loop 每5分钟调）**：SELECT 不含 executor_kind、零引用合同层；探三信号 activeProcesses pid / payload.current_run_id / ps 扫描——codex-review 三无（detached spawn、RUN_ID 只在 env）→ 60 秒宽限（3946-3951）后恒判死 → SUSPECT → DEAD → requeueTask('liveness_dead') → 3 次 quarantine
- 旁证：initiative 系兄弟类型有 60 分钟宽限名单（3992），唯 arch_review 等漏网

## 修法（方案 A 增强版）

lock 文件 `/tmp/codex-review-locks/<taskId>.lock` 生命周期完美匹配存活：spawn 前写（executor.js:2443-2444，含 startedAt）、spawn error handler 删（2485）、exit handler 删（2505）。

1. **打标**：triggerCodexReview lock 写入后 `await setExecutorKind(task.id, 'codex-review-local')`。
2. **合同层新 kind**：executor-contracts.js VALID_EXECUTOR_KINDS + EXECUTOR_CONTRACTS 加 `codex-review-local`：probe = lock 存在且 startedAt 距今 < 90min → alive；超龄 → dead；缺失 → dead。onStale: 'requeue'。
3. **进程层接线**：probeTaskLiveness 在 harness/initiative 豁免逻辑同层加分支：`REVIEW_TASK_TYPES.includes(task.task_type)` → isAlive 用同一 lock 检查 helper（新抽 `isCodexReviewLockAlive(taskId)`，两层共用 SSOT），不走 ps 扫描。
4. **claim 清理小刀**：paused-requeuer.js requeue UPDATE 补 `claimed_by=NULL, claimed_at=NULL`（现存漏洞）；regression test 钉死 requeueTask('liveness_dead') 路径清 claim（main 已有实现 c51e4182a，测试防回退）。

安全性：lock 缺失→dead 与 callback 竞态无害（callback 先改状态后 requeueTask `WHERE status='in_progress'` 空转）；容器重启→/tmp 清空→lock 缺失→双确认回队，孤儿有出路（整体豁免方案做不到，故弃）。

## 测试策略（unit，vitest）
- liveness-probe.test.js 加 REVIEW 分支三态（照既有 vi.hoisted mockPool + mock fs 写法）：lock 在且新鲜→alive；超龄→dead；缺失→dead
- executor-contracts：VALID_EXECUTOR_KINDS 含新 kind + 新合同 probe 三态
- paused-requeuer：requeue 后 claimed_by/claimed_at 为 NULL
- executor 静态断言：triggerCodexReview 含 setExecutorKind('codex-review-local' 调用
- commit-1 全红（proven-to-fire），commit-2 绿
- integration（部署后真机终验）：派发真实 arch_review 全程不被误判，codex 跑完 verdict 落库

## 不做
- 不动 Monitor stuck-run / thalamus retry 本体
- 不给其他 legacy null-kind 任务改语义（方案 C 已否决）
- 生产镜像取证项（requeueTask 清 claim 是否在跑旧 build）由部署后终验顺带覆盖
