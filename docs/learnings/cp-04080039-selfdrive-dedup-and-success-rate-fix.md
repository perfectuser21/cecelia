# Learning: SelfDrive去重覆盖quarantined + 成功率排除pipeline_rescue

## 背景
24h成功率39%事件（2026-04-06）暴露两个代码设计缺陷，本次修复。

### 根本原因

**缺陷1：getTaskStats24h() 未排除 pipeline_rescue**
- pipeline_rescue storm（PR #2004修复的dedup漏洞）产生194个quarantined任务
- 这些任务全部被纳入成功率计算，导致24h成功率从~70%跌至39%
- SelfDrive 看到低成功率 → 误判系统故障 → 派发诊断任务（进一步放大）
- 修复：`FROM tasks WHERE task_type != 'pipeline_rescue'`

**缺陷2：SelfDrive 去重未覆盖近期 quarantined**
- account3 OAuth token 过期，dispatch 到 account3 的任务立即失败进入 quarantined
- SelfDrive 去重只检查 `queued/in_progress`，不见 quarantined
- 每次 SelfDrive cycle 发现低成功率 → 创建诊断任务 → 立即 quarantined → 下次再创建
- 产生 22 个额外失败任务（放大循环）
- 修复：扩展去重查询覆盖 `quarantined AND updated_at > NOW() - 24h`

### 下次预防

- [ ] 任何噪音性 task_type（pipeline_rescue/content_publish等）在成功率计算前应明确排除
- [ ] SelfDrive dedup 覆盖 quarantined 是防放大的关键：auth失败 → quarantined 立即发生，不会经过 queued
- [ ] 新增 task_type 时评估是否需要加入成功率统计白名单
