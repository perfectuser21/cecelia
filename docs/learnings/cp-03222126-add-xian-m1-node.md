# Learning: 添加西安M1为独立任务路由节点

**Branch**: cp-03222126-add-xian-m1-node
**Task**: 5e35d6d2-c814-480c-a6b2-7bd6eda37aff

### 根本原因

西安M1（100.88.166.55）已是正式 Codex 工作节点，已在 CODEX_BRIDGES 列表中负载均衡，但：
1. UI 注释写死"M1 不参与任务路由"，造成误解
2. 没有 `xian_m1` location key，无法将任务钉到 M1 专用（只能走自动负载均衡）
3. `isValidLocation()` 和 `detectRoutingFailure()` 不认识 `xian_m1`，若 DB 有 xian_m1 记录会被判为无效并降级

### 解决方案

1. **executor.js**：新增 `XIAN_M1_BRIDGE_URL` 常量 + `xian_m1` 路由分支，`triggerCodexBridge` 加 `forceBridgeUrl` 参数支持钉机器
2. **task-router.js**：`isValidLocation()` 和 `detectRoutingFailure()` 两处数组加 `'xian_m1'`
3. **TaskTypeConfigPage.tsx**：类型/颜色/标签/radio 三选项，删除错误注释

### 两种路由模式共存

- `xian` → `selectBestBridge()` 自动负载均衡（M4 + M1 都在池中）
- `xian_m1` → 直接调 `XIAN_M1_BRIDGE_URL` 钉到 M1

### 下次预防

- [ ] 新增工作节点时，同时更新 `isValidLocation()`、`detectRoutingFailure()`、UI 类型/标签三处
- [ ] 注释中的机器状态描述要及时同步，不要让静态注释落后于实际状态
