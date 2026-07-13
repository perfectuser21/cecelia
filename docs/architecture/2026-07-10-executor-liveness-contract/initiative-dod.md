# Initiative DoD: 执行者活性合同统一(executor_kind)

Initiative: a2953ddc-aba2-4e5a-aa8c-13889a280b85

## 功能验收条件(Mode 3 逐条检查)
- [ ] F1: tasks 表存在 executor_kind 列(五值 check 约束),所有五个派发/认领点写入正确 kind — 验证: psql \d tasks + 每 kind 至少一条真实任务打标记录(SELECT executor_kind,count(*) GROUP BY 1)
- [ ] F2: executor-contracts.js 导出 EXECUTOR_CONTRACTS(五 kind)与 assessTaskLiveness,unknown 一律返回 fail-open — 验证: vitest 矩阵用例全绿
- [ ] F3: 四把守护刀(zombie-reaper/autoFailTimedOutTasks/dead-reset/restartStuckExecutors)全部经 assessTaskLiveness 判活,代码中不再存在 DEFAULT_EXEMPT_TASK_TYPES/HARNESS_TASK_TYPES 排除表/skill-relay 特判/content-pipeline 特判 — 验证: grep 断言 + 误杀回归用例(headed-session + updated_at 63min + 进程活 → 不杀)
- [ ] F4: Guard C 上线——对"全部已 commit 但有活进程持有 cwd"的 worktree,zombie-sweep 与 zombie-cleaner 均 skip — 验证: vitest 临时目录用例
- [ ] F5: PATCH →in_progress 自动补 claimed_by + executor_kind='headed-session';认领后 dispatcher 不再重复派发同任务 — 验证: vitest + 真环境注册任务 PATCH 后观察 2 个 tick 无二次派发
- [ ] F6: pre-flight 同一任务拒绝 3 次后 status=blocked(blocked_reason=pre_flight_rejected),不再入候选、告警停止 — 验证: 真环境造空 description 任务观察 3 tick 后 blocked
- [ ] F7: dev 任务派发不再经过 LangGraph(dev-task.graph.js 物理删除,workflows/index.js 无 dev-task 注册),且派发后 execution_attempts >= 1 — 验证: grep 断言 + 真环境派发一个 dev 任务查列值

## 集成测试通过条件
- [ ] I1: 最后一个 dev task 的集成测试套件全绿(integration_test_owner)
- [ ] I2: Golden Path 端到端:注册任务→有头认领(PATCH)→守护刀两轮扫描不误杀→callback 完成→claim 清空

## 架构对齐条件(Mode 3 自动校验)
- [ ] A1: 数据模型按 architecture.md(migration 328 逐字段)
- [ ] A2: 模块变更表逐项落地(新建 2 文件/修改 9 文件/删除 1 文件)
- [ ] A3: 关键决策 7 条无偏离(特别是 unknown fail-open 与 headed-session 绝不自动 failed)

## 非功能条件
- [ ] N1: 无新增 L1 bug(code_review 无 BLOCK)
- [ ] N2: Brain CI 全绿;facts-check/version-sync/manifest 同步
