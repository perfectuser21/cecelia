# Learning: 数据闭环 KR 卡点诊断

### 根本原因

OKR 拆解停在 Scope 层，没有产生 initiatives/tasks，导致 KR 进度永远 0%：
- `数据采集完整化`：3 scopes 全部 planning，0 initiatives，0 tasks
- `智能周报引擎`：项目本身 planning，3 scopes，0 initiatives，0 tasks

辅助原因：
1. Brain Tick 中 `platform_scraper` 任务调度逻辑缺失（executor.js 路由已就位但无触发器）
2. `pipeline_publish_stats` 表在 PR #1913 之前缺失，周报引擎即便触发也会报错

### 下次预防

- [ ] /decomp 完成后检查 `okr_initiatives` 表中是否有产出，而不仅仅是 scopes
- [ ] 新建 KR 后应立即检查是否有至少一条 task 进入 in_progress，否则 KR 进度永远 0%
- [ ] Brain 新增模块（如数据采集）时，确认 Tick 中有对应触发逻辑，不能只有 executor 路由
