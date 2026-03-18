# Learning: resource-monitor.js 新模块创建

## 任务
创建 packages/brain/src/resource-monitor.js，封装 os.loadavg + memoryUsage，暴露 getResourcePressure()

### 根本原因
branch-protect.sh 要求 packages/ 子目录开发必须同时提供：
1. per-branch PRD（`.prd-<branch>.md`）
2. 最新的 `.dod.md`

旧 .dod.md 是其他任务的残留，导致写文件被 Hook 阻止。

### 下次预防
- [ ] 进入 worktree 后首先检查 .dod.md 是否属于本任务
- [ ] 若是旧任务残留，先更新 .dod.md 再写代码
- [ ] per-branch PRD 文件命名必须精确匹配分支名：`.prd-<branch-name>.md`

### 技术决策
- `resetThresholds()` 导出供测试使用，模块级变量方式存储阈值（vs 传参），与 circuit-breaker.js 风格一致
- 使用 `vi.mock('os')` + `vi.spyOn(process, 'memoryUsage')` 完成完整 mock 隔离
- 阈值判断用严格大于（`>`），等于阈值不触发 throttle
