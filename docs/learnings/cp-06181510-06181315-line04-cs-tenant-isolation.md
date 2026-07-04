# Learning — Line04 客服层多租户隔离

## 运行指标

- GAN 轮次：未知（Brain 5221 不可达，无法读取 payload.gan_rounds）
- PR：https://github.com/perfectuser21/zenithjoy-workspace/pull/792（open，未合并）
- Sprint Dir：sprints/06181315-line04-cs-tenant-isolation
- 验证形态：autonomous / local_api（vitest + mock pg pool，断言真实 SQL 文本+绑定参数）

## 发现的问题

### [INFRA] 基础设施问题

- **report 阶段后端栈整体宕机**：harness-report 由 reportNode 在 evaluator PASS 后自动 spawn，
  但执行时 Brain(localhost:5221) 与 Postgres(localhost:5432) 均未监听端口（HTTP 000 / 无进程 / 无容器）。
  → 结果：Phase A 的 Step 1-5/7（全部 curl Brain）与 Phase B（db-update → notion-push-sync）无法执行，
    任务状态未回写 completed、Notion Notes/Feature Registry/Registry/飞书通知/Sprint 状态同步全部缺失。
  → 仅完成不依赖后端的本地交付物（harness-report.md / learning.md / index.html）。
  → 预防：reportNode spawn report 前应做 Brain/Postgres 存活探针，宕机时入队"待补同步"而非静默丢失；
    或 report skill Step 0 增加后端探针，明确产出 BLOCKED 状态供后续补偿。

### [DESIGN] 设计缺陷

- **report 强依赖在线 Brain，无离线补偿队列**：当前 report 的所有 SSOT 写入都是即时 curl，
  后端短暂不可用即导致整次 Sprint 的状态/产出同步永久丢失（除非人工补跑）。
  建议：本地落一份 pending-sync 清单（含 task_id/feature_id/sprint_dir），后端恢复后由 tick 自动重放。

### [PROMPT] / [BUG]

- 本次未涉及（实现侧 evaluator 已 PASS）。

## 下次预防清单

- [ ] report Step 0 增加 Brain(5221)+Postgres(5432) 存活探针，宕机时产出 BLOCKED 标记 + 待补同步清单
- [ ] 不对已确认未监听的端口连发长超时 curl（浪费 wall-clock）
- [ ] 后端恢复后补跑同步：见 harness-report.md 的「DB sync BLOCKED」说明
