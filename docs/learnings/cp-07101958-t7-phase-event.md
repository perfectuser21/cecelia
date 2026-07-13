## 九要素T7：phase-event 复活 + zombie-reaper 心跳判活（2026-07-10）

cecelia PR #3743 + zenithjoy-skills PR #119/#120。initiative_run_events 自 07-04 起零写入（LangGraph→skill-relay 切换时写入方随图节点被删），API 端点一直健在没人调用；同时 zombie-reaper 靠 tasks.updated_at 单信号判活，07-10 一天内两次误杀正在跑的 T5/T6 有头任务。

### 根本原因
架构切换（LangGraph→skill-relay）只迁移了"编排"，没有盘点旧图节点身上挂着的**副作用职责**（细粒度阶段遥测写入），导致下游消费者（判活、巡逻、成本核算）静默断供三天才被审计发现。判活层则把"DB 行没更新"当成"进程死了"，两个信号被压成一个。

### 下次预防
- [ ] 架构迁移 checklist 必须列"旧组件的全部写入方职责"，逐条确认新架构谁接手（不只迁核心流程）
- [ ] 守护刀判活一律走 assessTaskLiveness + 多信号叠加（updated_at / phase-event 心跳 / 容器探活），禁再新增单信号杀手
- [ ] 表级断供靠 T1 账本保鲜守卫（ledger-hygiene）机械告警，不靠人肉审计发现
- [ ] skill 侧自报类 curl 一律 best-effort（-m 超时 + || true + 空值守卫），绝不阻塞主流程
