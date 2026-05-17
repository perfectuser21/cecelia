# Learning — quarantine 第三个守卫 hasActivePr

## 现象

Harness v6 闭环验证：task `a930d4dd` 已产出 PR（`tasks.pr_url` 填充 + `pr_status='ci_pending'`）但 Brain tick 仍把它当 queued 重派 → `failure_count` 持续累积 → quarantine 看到 >= 阈值拉黑 → shepherd 过滤 `status NOT IN ('quarantined')` 永远跳过 → PR 永远不 merge → 死循环。

### 根本原因

`handleTaskFailure` 已有两道活跃信号守卫：
1. `hasActiveCheckpoint(taskId)` — LangGraph checkpoints 表（GAN 类）
2. `hasActiveContainer(taskId)` — `docker ps` 命中 `cecelia-task-<12hex>`（Generator 类还在跑）

但缺第三道判 in-flight PR 的守卫。Generator 类任务一旦 push PR 后容器就退出，`hasActiveContainer` 返回 false；又不走 LangGraph，`hasActiveCheckpoint` 也返回 false。此时唯一活跃证据是 `tasks.pr_url + pr_status`，没有人查它，于是 `failure_count` 无限累积。

### 下次预防

- [ ] 新增 quarantine 类逻辑前先回顾"活跃信号是否齐全"：checkpoint / container / pr / 其他外部 deliverable
- [ ] tasks 表新增 deliverable 字段（pr_url、issue_url、commit_sha 等）时同步加守卫，禁止只依赖 failure_count 单一信号
- [ ] 守卫并列原则：每个守卫独立 short-circuit return + 独立测试文件 + 一致的 `(N/M)` 注释编号
- [ ] 在已有 mock chain 中插入新查询时，要扫所有引用同一 helper 的测试文件，避免静默 regression

## 修复

- 新增 `quarantine.js::hasActivePr(taskId)`：查 `tasks.pr_url + pr_status`，命中 `('open','ci_pending','merged')` 之一返回 true
- `handleTaskFailure` 在 `hasActiveContainer` 守卫之后插入第三段守卫，命中即 `{quarantined:false, skipped_active:true, reason:'active_pr', failure_count:0}`
- 测试文件 `quarantine-skip-active-pr.test.js` 覆盖真值表（7 例）+ 集成路径（4 例）
- 同步更新四个已存在 mock chain（quarantine-skip-active-checkpoint / quarantine-skip-active-container / quarantine-block / quarantine-billing-pause）以兼容新增的 hasActivePr 查询
- 把守卫注释从 `(1/2)` `(2/2)` 改为 `(1/3)` `(2/3)` `(3/3)` 保持序号一致
