# Learning: 修复 Initiative Pipeline 全链路闭环

### 根本原因

Initiative Pipeline 有三处断点：
1. `createInitiative` 直接写 `active` 状态，绕过了 `activateNextInitiatives` 的容量控制队列
2. KR 层缺少完成检测函数（`checkKRCompletion`）和激活函数（`activateNextKRs`），导致 KR 完成后不自动关闭，下一个 KR 也不激活
3. `tick.js` 没有调用 KR 层函数，整个 KR → Project → Scope → Initiative 链路顶层断裂

### 下次预防

- [ ] 新增任何层级的"创建"函数时，初始状态应为 `pending`，由对应的 `activateNext*` 函数按容量激活
- [ ] 新增状态检测函数时，必须同步在 `tick.js` 中注册调用入口
- [ ] 每新增一个层级（如 KR）的生命周期函数，对应在 tick.js 增加对应 Section
- [ ] DoD 测试中 `require()` 不适用于 ES module，Brain 代码全部是 ES module，应用 `node --input-type=module` 或 `grep` 检查文件内容
