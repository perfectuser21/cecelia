---
skeleton: false
journey_type: autonomous
target_environment: local_api
---
# Contract DoD — P0 Kernel Feedback Lineage Recovery 3

**范围**：恰好五个 Golden Path 行为；大小 L；任何条目不得预勾。

## ARTIFACT 条目

- [ ] [ARTIFACT] current-main 实际入口完成实现且 `packages/brain/DEFINITION.md` 版本同步
  Test: node -e "const fs=require('fs');for(const f of ['packages/brain/src/orchestrator/dispatcher.js','packages/brain/src/orchestrator/execution-contract.js','packages/brain/src/orchestrator/remote-bridge-transport.js','packages/brain/src/orchestrator/attempt-store.js','packages/brain/src/orchestrator/ground-truth.js','packages/brain/src/orchestrator/gates.js','packages/brain/src/routes/harness-callback.js','packages/brain/scripts/fleet-worker/attempt-runner.cjs','packages/brain/src/__tests__/harness-kernel-feedback-lineage.real.test.js','packages/brain/DEFINITION.md'])fs.accessSync(f)"

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L2] [B1] external result channel isolation
  动作: 通过真实 dispatcher 分别派发 reviewer、canary、in-process judge，并走 local-docker/fleet-worker adapters。
  预期观察: within 60s reviewer/canary 获 attempt 隔离的 0600 普通单链接 channel/capability，judge 无 channel；越权与 missing/reuse 全拒绝并清理。
  Test: manual:bash -c ': "${TEST_DATABASE_URL:?}"; npx vitest run packages/brain/src/__tests__/harness-kernel-feedback-lineage.real.test.js -t "\[B1\] external result channel isolation" --reporter=verbose'

- [ ] [BEHAVIOR] [L2] [B2] bounded HarnessResult v1 review
  动作: 向 v1 parser 提交边界值与逐项越界、非法 enum/binding/digest。
  预期观察: 合法边界通过；所有非法输入立即以具名业务断言拒绝。
  Test: manual:bash -c ': "${TEST_DATABASE_URL:?}"; npx vitest run packages/brain/src/__tests__/harness-kernel-feedback-lineage.real.test.js -t "\[B2\] bounded HarnessResult v1 review" --reporter=verbose'

- [ ] [BEHAVIOR] [L2] [B3] real callback transaction
  动作: 生产 store 在隔离 PG 建 run/task/attempt，经真实 socket POST callback，并做 replay/tamper/rollback/concurrency。
  预期观察: within 60s 完整 decision 仅落 attempt，decision-log 仅落有界摘要；错误体/状态码精确，敏感内容零反射。
  Test: manual:bash -c ': "${TEST_DATABASE_URL:?}"; npx vitest run packages/brain/src/__tests__/harness-kernel-feedback-lineage.real.test.js -t "\[B3\] real callback transaction" --reporter=verbose'

- [ ] [BEHAVIOR] [L2] [B4] exact prior_review lineage
  动作: 以真实 route→DB→ground-truth→dispatcher 执行 r1 REVISION、r2 resolutions、r2 APPROVED，并注入 stale/cross-run/recovery 反例。
  预期观察: within 60s prior_review/resolutions 精确传递且 fresh session；缺历史、错 id、stale SHA 在 launch 前阻断。
  Test: manual:bash -c ': "${TEST_DATABASE_URL:?}"; npx vitest run packages/brain/src/__tests__/harness-kernel-feedback-lineage.real.test.js -t "\[B4\] exact prior_review lineage" --reporter=verbose'

- [ ] [BEHAVIOR] [L2] [B5] final SHA merge gate
  动作: 真实解析测试 PR current head，写 evaluator/judge/human DB records，逐项 stale 后再给唯一同 SHA 组合。
  预期观察: 负路径 merge/deploy=0/0；合法路径=1/1；review_required 无批准时停住。
  Test: manual:bash -c ': "${TEST_DATABASE_URL:?}"; : "${TEST_PR_URL:?}"; npx vitest run packages/brain/src/__tests__/harness-kernel-feedback-lineage.real.test.js -t "\[B5\] final SHA merge gate" --reporter=verbose'

## 铁律映射

- INV-1 看产物恢复：B4 resume/recovery isolation。
- INV-2 语义成功：B3 回读 DB/dedupe，不只看 ok。
- INV-3 依赖修复：N/A，不处理 advisory。
- INV-4 长程心跳：N/A，无长 CI 等待。
- INV-5 毕业双检：交付前执行 DevGate。
- INV-6 真退出码：五条 manual oracle 以 vitest exit code 判定。
- INV-7 模板转义：无双引号 `node -e` `${}`。
- INV-8 烟测1784808160：N/A，不触及该模块。
- INV-9 烟测1784806023：N/A，不触及该模块。
- INV-10 真实多轮：B4 不重置 r1→r2 状态。
- INV-11 付费幂等：N/A，无付费服务。
- INV-12 时间关系：capability expiry/attempt terminal 顺序由 B1 断言。
- INV-13 环境关键字：local_api 与真实 HTTP/PG 一致。
- INV-14 环境主源：target_environment 取 task payload。
- INV-15 judge格式：B5 使用真实 judge attempt record。
- INV-16 字段有界：B2 全字段显式 bounds。
- INV-17 复活查死因：历史 commit/attempt 只作 evidence，不继承 approval。
- INV-18 错误值分支：B1-B5 fail closed。
- INV-19 烟测1784543954：N/A，不触及该模块。
- INV-20 状态停滞探针：N/A，不改 journey_features。
- INV-21 完成看收账：B3/B5 回读 DB/side-effect count。
- INV-22 人工场景：B5 覆盖 human approval。
- INV-23 headed锚点：N/A，无 headed relay。
- INV-24 退役看数据：N/A，不退役能力。
- INV-25 吞错计数：persistence_failed 显式 500/告警。
- INV-26 表名认领：仅复用 harness_attempts/orchestrator_decision_log。
- INV-27 必须有消费方：N/A，不新增 job。
- INV-28 多端完整：B1 覆盖 local-docker/fleet-worker。
- INV-29 unknown同义：B2/B3 冻结 error mapping。
- INV-30 ref校验：E2E 使用 `git rev-parse --verify "origin/main^{commit}"`。
- INV-31 生产资源隔离：显式 TEST_DATABASE_URL 与 final side-effect spies。
- INV-32 部署失败：B5 deploy 非零不降级。
- INV-33 生产自报：B5 server resolver 对账 PR head。
- INV-34 异步质量：N/A，无源码读取 async 测试。
- INV-35 合同表格式：Test Contract 固定四列。
- INV-36 Red精确暂存：仅暂存唯一真实测试路径。
- INV-37 调度真验：B1/B4 走真实 dispatcher。
- INV-38 定时入口：N/A，无 cron。
- INV-39 合并权：generator 不 merge；B5 等 controller/user。
- INV-40 headed环境：N/A，无 tmux。
- INV-41 先核真实历史：已核 d37a5e5/current-main 与旧证据。
- INV-42 共享CI禁区：不改 CI。
- INV-43 提前合并对账：B5 四方 final SHA。
- INV-44 烟测1783850042：N/A，不触及该模块。
- INV-45 brain烟测：实现 PR 必带既有 Brain smoke/allowlist 流程。
- INV-46 任务类型七点：N/A，不增 task_type。
- INV-47 服务双信号：N/A，不增常驻服务。
- INV-48 Mac守护域：N/A，不增服务。
- INV-49 宿主清单：N/A，不增服务。
- INV-50 烟测1783693282：N/A，不触及该模块。
- INV-51 单槽串行：B4 同一 attempt/session 不复用。
- INV-52 环境不写死：DB/PR/capability 均 server/env 推导。
- INV-53 真环境才done：local_api 真 socket/PG/adapter。
- INV-54 默认多租户：并发 runs/attempts 互不串。
- INV-55 凭据安全：B3 全表面脱敏。
- INV-56 日志脱敏：B3 禁 transcript/CoT/stack/message。
- INV-57 端点鉴权：B3 生产 bearer+lease owner。
- INV-58 租户隔离：run+attempt+task binding 防跨 scope。

## BEHAVIOR:E2E

模式 B 执行 `contract-draft.md` 的单一 bash 块；期望五个同名业务 PASS。无截图要求（autonomous/local_api）。
