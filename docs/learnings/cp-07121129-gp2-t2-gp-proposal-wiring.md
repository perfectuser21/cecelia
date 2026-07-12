## GP2/T2 golden_path_proposal task_type 全链接线（2026-07-12）

### 根本原因
新 task_type 接派发链的真实接线面比任务描述多三处：任务描述给了 migration/task-router/executor:3218/relay/dispatcher:82-99 五点，但实际派不动的隐藏点还有 EXECUTOR_KIND_FOR 打标（漏了 setExecutorKind 取 undefined）、executor:3158 machine/executor override 劫持排除、dispatcher:598 needsBridgeCheck bridge 豁免（漏了会在 bridge 缺席时被永久 revert queued）。此外 feat+brain/src PR 有两道 CI 闸串行咬人：lint-feature-has-smoke（要 smoke.sh）→ Smoke Glob Runner（新 smoke.sh 还必须登记 packages/quality/smoke-allowlist.txt），第一闸修完才暴露第二闸。

### 下次预防
- [ ] 新 task_type 接线用七点清单：CHECK 约束 / task-router 四表 / EXECUTOR_KIND_FOR / executor dispatch 分支 / executor override 排除 / relay loadSkill 映射 / dispatcher cap+lock+bridge 三防线
- [ ] 接线前先 Research Subagent 全 grep 'harness_initiative' 字面量逐个判断，不只改任务描述列的行号
- [ ] feat+brain/src PR 开 PR 前直接一次带齐 smoke.sh + smoke-allowlist 登记，别等 CI 两连红
- [ ] 观测面（warroom/goals计数/harness统计/slot旁路）与心跳判据（harness-watchdog）按需另立，不算派发链必需
