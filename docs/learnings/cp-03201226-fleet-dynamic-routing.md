# Learning: 动态 Codex 并发上限 + task_type 路由硬分

## 概要
Brain 的 MAX_CODEX_CONCURRENT 硬编码为 3，executor 路由基于 LOCATION_MAP 查表，导致非 dev 任务全挤在美国 Claude Code。

### 根本原因
slot-allocator 和 executor 设计时只考虑单机场景。LOCATION_MAP 是静态映射，不区分"工具能力"和"机器位置"。需要的是按"任务是否依赖 Claude Code hooks"来分流，而非按 task_type 逐个配路由。

### 下次预防
- [ ] 新增 task_type 时考虑：它需要 Claude Code hooks 吗？不需要就默认走 Codex
- [ ] slot-allocator 的并发上限必须与实际资源挂钩，不能硬编码
