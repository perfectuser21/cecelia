# Learning — Cockpit Phase 3 — 决策面板（Brain端点+UI）

## 运行指标

- GAN 轮次：0（Brain 不可达，未取到实际值）
- Evaluator Fix 次数：0
- PR：https://github.com/perfectuser21/cecelia/pull/3401
- Sprint Dir：sprints/06181601-cockpit-phase3-decision-panel

## 发现的问题

### [PROMPT] Prompt 类问题

- （无）

### [BUG] 代码缺陷

- （无）

### [INFRA] 基础设施问题

- harness-report 运行容器内 Brain (localhost:5221) 不可达：无 docker、无 postgres(5432)、无 brain 进程。
  导致 Phase A 的 Brain API 步骤（任务回写/Dashboard/Notion Task/Report Note/Feature Registry/飞书/Registry）
  及 Phase B（db-update → notion-push-sync）全部无法在本容器内执行。
  本地产物（report.md/learning.md/index.html）已正常生成。需 Brain 恢复后手动触发本 skill 补同步。

### [DESIGN] 设计缺陷

- （观察）report agent 与 Brain 之间缺少强一致的回写保障：Brain 短暂不可达时，
  所有状态同步静默 WARN，pipeline 仍标记完成，存在 Notion/DB 与实际 PR 状态脱节的窗口。

## 下次预防清单

- [ ] report 启动时先探测 Brain 健康（/api/brain/tick/status），不可达时显式落 pending-resync 标记
- [ ] 检查 contract-draft.md / sprint-prd.md 是否随 sprint 落盘（本次仅有 prep-prd.md）
- [ ] 确认 DoD 所有 [BEHAVIOR] 条目有对应测试
