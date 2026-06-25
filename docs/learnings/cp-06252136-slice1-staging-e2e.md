# Learning — 阶段2 Slice 1：harness merge 后 staging 部署 + 自动 E2E

> 分支：cp-0625212445-slice1-staging-e2e
> Brain Task：312fb32b-c7c4-470c-ade5-753200480278
> 日期：2026-06-25

## 背景

旧 harness「merge=终点」：evaluator 三层全在 merge 前，E2E 验的是 PR 分支/活宿主而非真部署实例。
合了但真环境里坏的验不出 —— silent-success 老病根。Slice 1 在 sub_task 合并后延长 pipeline：
部署候选到 :5222 staging → 在**真 staging 实例**跑 contract E2E → verdict 落库。

## 做了什么

- `staging-e2e-runner.js`：Brain 内部 handler（纯逻辑 + 副作用 deps 注入，单测无需 docker/db）。
- `harness-task.graph.js` `mergePrNode`：merge 成功后 best-effort 建 `staging_e2e` 任务（两条 merged 分支都建）。
- `executor.js` `triggerCeceliaRun`：`staging_e2e` 内部 handler 分支（同步执行，排在 retired 短路块之前）。
- migration 304 `staging_e2e_results`（pr_url UNIQUE）；task-router 注册 `staging_e2e`；selfcheck/DEFINITION 同步 304。

### 根本原因

silent-success 的根因不是"没跑 E2E"，是**E2E 跑错了地方**：跑在 merge 前的 PR 分支/活宿主，
而不是合并后部署出来的真实例。同一份 contract 断言，target 指错就验不出真环境的坏。
所以本片的命根是**皇冠断言**：E2E target 必须钉死 staging:5222，不能退回 production:5221 或活宿主。

另一个反复踩的坑：merge 后挂接新步骤时，本能想用 langgraph 节点 + interrupt 等结果。但 memory
`harness-langgraph-interrupt-throw` 记着 interrupt 等人/等回调会重新挂起死循环 + 容器泄漏。
正确解：staging E2E 做成**独立 Brain 任务**（可长期 pending），用 best-effort `INSERT INTO tasks`
副作用挂接（复刻 reportNode 派 harness_report 的现成模式），merge 节点返回值/路由完全不变。

### 下次预防

- 任何"merge 后延长 pipeline"的需求，先问：新步骤会不会等人/等异步回调？会 → 必须做成 Brain 任务状态，
  **绝不**用 langgraph interrupt（死循环 + 容器泄漏）。
- 任何"真环境验收"的功能，皇冠断言必须证明**打到的是部署出来的真实例**（host:port 明确），
  不是 PR 分支/活宿主，否则又是 silent-success。
- merge 路径上的任何副作用必须 best-effort try/catch 永不 throw，放在 return 前最后一步；
  幂等用 DB 级 UNIQUE + 建任务 NOT EXISTS 双闸（merge 节点会因 BEHIND 重试/已被外部合并多次进入）。
- 复用现成件（staging-deploy.sh / host-executor / evaluator 容器机制），**禁建平行部署/E2E 系统**。

## checklist

- [x] 皇冠断言（E2E target=staging:5222）有单测 + DoD BEHAVIOR 命令
- [x] 两条 merged 分支都建 staging_e2e 任务（正常 + 已被外部合并幂等分支）
- [x] merge 副作用 try/catch 永不 throw（运行时单测：INSERT 抛错 merge 仍返回 merged）
- [x] DB 级幂等：staging_e2e_results.pr_url UNIQUE + 建任务 NOT EXISTS
- [x] 不碰 langgraph interrupt（merge 节点路由/返回值不变）
- [x] 复用 staging-deploy.sh + host-executor，未建平行系统
- [x] 本片只到 verdict 落库，未碰放行/promote/report（Slice 2/3 边界）
- [x] DevGate 三件套（facts-check / check-version-sync / check-dod-mapping）全过
