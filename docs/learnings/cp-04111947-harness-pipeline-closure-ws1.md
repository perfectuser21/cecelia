### 根本原因

WS1 实现了 Harness v4.0 Pipeline 的 CI Watch 链路和 Post-Merge 收尾机制：
1. execution.js 最后 WS 回调由 inline CI 检查改为创建 harness_ci_watch（解耦异步轮询）
2. harness-watcher.js CI passed 段改为创建 harness_post_merge（统一收尾入口）
3. 新增 processHarnessPostMerge 函数负责 worktree 清理 + planner 回写 + report 创建
4. task-router.js 注册 harness_post_merge 类型及 LOCATION_MAP 路由

### 下次预防

- [ ] DoD 验证测试使用 `c.indexOf('keyword')` + 固定窗口（3000 chars）：被测函数须放在文件靠前位置，否则函数体超出窗口而验证失败
- [ ] 新增 Brain 任务类型时需同时修改 VALID_TASK_TYPES 和 LOCATION_MAP 两处，缺一会导致路由失败
- [ ] harness_post_merge 已注册到 task-router 但尚未在 tick.js 中调用 processHarnessPostMerge，如需实际调度需补充 tick.js 接入
