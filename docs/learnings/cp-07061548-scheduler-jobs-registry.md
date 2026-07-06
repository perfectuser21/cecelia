# scheduler-jobs 注册表：Wave 2 死代码带的第一刀

### 根本原因
2026-05-04 Wave 2 重构把 tick-loop 从 executeTick 切到 runScheduler（纯派发）后，
executeTick step 10.x 约 25 个定时任务调用全部成死代码且无人发现两个月——
诊断类/总结类机制没有"自身死亡告警"，静默死亡与天下太平不可区分。

### 下次预防
- [ ] 替换核心调度器时必须产出孤儿清单（migration-orphan-audit 铁律，本 PR 的 docs/current/executetick-dead-jobs-inventory.md 即范例）
- [ ] 定时任务一律挂 scheduler-jobs 注册表（错误隔离+timeout+观测哨兵），禁止再裸挂 setInterval
- [ ] 注册表 loop 必须带重入守卫（本次质量审查抓到：setInterval 不等上轮跑完会叠加并发，踩模块自 gate 的 TOCTOU）
- [ ] 观测哨兵 scheduler_job_last_run:* 供死人开关体检；P1 后续 PR 落体外哨兵
