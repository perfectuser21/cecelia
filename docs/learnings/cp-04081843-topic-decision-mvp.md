# Learning: 选题决策闭环引擎 MVP

## 任务背景
补充选题决策系统的可观测性缺口：审核率统计 API、内容库缺口信号、Dashboard 审核 UI。

### 根本原因
系统已有 topic-selector/scheduler/suggestion-manager 完整流水线，但缺少：
1. 审核率统计 API（无法追踪 ≥70% 目标）
2. 内容库缺口信号（topic-selector 未利用库存缺口数据）
3. Dashboard 选题审核 UI（ContentStudio 是占位符）

### 下次预防

- [ ] **DoD curl 测试不能直连本地服务**：`curl localhost:5221/...` 在 CI 环境会失败（无 Brain 服务）。应改用 `node -e` 检查源码内容，或用 vitest 单元测试替代运行时验证。
- [ ] **路由顺序陷阱**：routes.js 通过 `router.stack.push(...)` 合并子路由时，路由顺序是注册顺序。`/topics/stats` 若无正确定义会落入其他 catch-all 路由返回 UUID 类型错误。
- [ ] **ESM 导出验证**：`getContentGapContext` 使用 `node --input-type=module` 验证，不能用 CommonJS `require()`。
