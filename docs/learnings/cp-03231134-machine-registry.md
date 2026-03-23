# Learning: 机器注册表 + Capability Tags 动态路由

Branch: cp-03231134-machine-registry
Date: 2026-03-23

## 做了什么

将 task-router.js 中的静态 LOCATION_MAP 扩展为两层：
1. `LOCATION_MAP` 保留向后兼容（xian/us），移除 'hk' 条目（HK MiniMax 不是自有机器）
2. 新增 `TASK_REQUIREMENTS`（task_type → capability tags[]），为将来纯 tags 路由铺路
3. executor.js 新增 `MACHINE_REGISTRY` + `selectBestMachine()`，支持基于 capability 的动态选机

## 根本原因

HK MiniMax（100.86.118.99）不是自有机器，路由到 hk 会依赖第三方服务。research/talk/explore 等通用任务应该在自有机器（西安 Codex）上运行，按负载均衡选最闲。

## 下次预防

- [ ] 新增机器时，直接在 MACHINE_REGISTRY 中注册 + 标记 capability tags，不需要修改路由代码
- [ ] 修改 location 时同步搜索所有测试文件中的硬编码断言（`grep -rn "'hk'"` 或 `'location'`）
- [ ] CI DoD 检查需要 `[BEHAVIOR]` 标签 + `Test:` 独立缩进行格式，Task Card 一开始就要写对
- [ ] Learning 文件需要 `根本原因`、`下次预防`、checklist（`- [ ]`）三个章节

## 关键决策

保留 LOCATION_MAP 向后兼容，并行建立 TASK_REQUIREMENTS + MACHINE_REGISTRY 体系。executor.js 调用链深（getCachedLocation → getTaskLocation → triggerCeceliaRun），全量重写风险高，这次先并行，下一步再迁移调用方。
