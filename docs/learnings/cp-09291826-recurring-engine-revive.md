# Learning：recurring_tasks 定时引擎停摆 5 个月（任务 3d0db274）

- 现象：定时模板最后一次出实例是 05-09，之后无人察觉。
- 根因：Wave 2 把 executeTick 废弃后，挂在它上面的 checkRecurringTasks 没迁到 scheduler-jobs；且到点判定要求"当前分钟恰好命中"+服务器本地时区，即使还在跑也会在 us-vps(UTC) 上错过北京时间点。
- 教训：
  - 调度入口迁移必须带"注册表断言"测试（scheduler-jobs.test.js 断言 job 名），否则静默断电。
  - 到点判定用持久化的 next_run_at + CAS，不要依赖"本轮恰好落在那一分钟"。
  - tasks 有 `(title) WHERE status IN ('cancelled','canceled')` 唯一索引（迁移 074）：同名任务批量取消会整批失败——周期性实例标题必须带时间点；只有真库集成测试能暴露。
  - 落后告警（next_run_at 过期 >10min）让"引擎卡住"不再静默。
