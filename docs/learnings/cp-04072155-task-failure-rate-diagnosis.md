# Learning: 任务失败率骤降诊断 — pipeline_rescue storm

**分支**: cp-04072155-6d464cce-f5b4-4951-a782-0c1bb0  
**日期**: 2026-04-08

### 根本原因

pipeline-patrol dedup 检查遗漏 `quarantined` 状态，导致已隔离的 rescue 任务被无限重建：
- 23 个死亡 worktree × 10-26 次重试 = 231 quarantined 任务（88% 的"失败"）
- 成功率: 84%（基线）→ 32%（风暴期）
- SelfDrive 感知到成功率下降后，重复创建诊断任务，形成次级正反馈（22 个 dev 任务）

### 下次预防

- [ ] SelfDrive 创建任务前，检查同类任务是否已存在（去重）
- [ ] pipeline-patrol 类似 dedup 逻辑需覆盖所有"终止"状态（completed/cancelled/failed/quarantined）
- [ ] 成功率监控应区分"真实业务失败"和"系统监控噪音"（rescue 风暴不应触发 SelfDrive 紧急响应）
- [ ] 孤立 worktree（>7天）应定期清理，减少 rescue 任务母集
