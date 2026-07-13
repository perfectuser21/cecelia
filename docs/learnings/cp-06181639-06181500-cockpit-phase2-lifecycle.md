# Learning — Cockpit Phase 2 — 一页看全 pipeline 全生命周期

## 运行指标

- GAN 轮次：0
- Evaluator Fix 次数：0
- PR：https://github.com/perfectuser21/cecelia/pull/3400
- Sprint Dir：sprints/06181500-cockpit-phase2-lifecycle

## 发现的问题

### [PROMPT] Prompt 类问题

- （无）

### [BUG] 代码缺陷

- （无）

### [INFRA] 基础设施问题

- harness-report 执行时本地 Brain (localhost:5221) 未运行，Phase A 的 Brain 回写步骤（任务状态/Notes/Registry/飞书）全部 WARN 跳过；本地文件交付（report/learning/index.html）正常完成。需在 Brain 恢复后手动补同步。

### [DESIGN] 设计缺陷

- （无）

## 下次预防清单

- [ ] 检查 contract-draft.md 格式是否符合 evaluator 预期
- [ ] 确认 DoD 所有 [BEHAVIOR] 条目有对应测试
- [ ] GAN 轮次 > 2 时复盘 evaluator prompt 是否过严
- [ ] reportNode spawn 前确认 Brain 服务存活，避免 Phase A 整段降级
