# Learning: 机器注册表 + Capability Tags 动态路由

Branch: cp-03231134-machine-registry
Date: 2026-03-23

## 做了什么

将 task-router.js 中的静态 `LOCATION_MAP`（task_type → location 字符串）扩展为两层：
1. `LOCATION_MAP` 保留向后兼容（xian/us/xian_m1），但移除了 'hk' 条目
2. 新增 `TASK_REQUIREMENTS`（task_type → capability tags[]），为将来纯 tags 路由铺路
3. executor.js 新增 `MACHINE_REGISTRY` + `selectBestMachine()`，支持基于 capability 的动态选机

## 关键决策

**为什么保留 LOCATION_MAP 而不是直接替换**：executor.js 的调用链很深（getCachedLocation → getTaskLocation → triggerCeceliaRun），全量重写风险大。这次先并行建立 TASK_REQUIREMENTS + MACHINE_REGISTRY 体系，下一步再逐步迁移调用方。

**HK MiniMax 移除原因**：HK（100.86.118.99）不是自有机器，不应该在路由中。research/talk/explore/data 改为路由到西安 Codex（general 标签），功能等价但走自有机器。

## 教训

1. CI DoD 检查需要 `[BEHAVIOR]` 标签条目（不能全是 `[ARTIFACT]`），要在写 Task Card 时就加好，不要等 CI 失败再修
2. 修改路由时，测试文件中对 location 的硬编码断言需要全量搜索更新（`grep -rn "'hk'"` 是必要步骤）
3. 预存在的测试失败（slot-allocator 阈值、llm-caller OpenAI key）会干扰判断，先在 main 分支验证是否预存，再决定是否修复
