# Learning: CI L4 cross-integration 修复

**分支**: cp-03251503-ci-cross-integration-fix
**Brain Task**: ce32e939-d823-47ee-a310-a3482a2fdcba
**日期**: 2026-03-25

---

### 根本原因

`ci-l4-runtime.yml` 的 job 触发条件是单向的：
- `brain-integration` 只在 `packages/brain/` 变更时触发
- `workspace-integration` 只在 `apps/` 变更时触发

这意味着 Brain 修改 API 后，不会自动运行 `workspace-integration`（含 `brain-api-integration.test.ts`），跨组件 API 兼容性无法被 CI 验证。

同样，`devgate-checks` 只在 brain 变更时触发，workspace PR 的 DoD/RCI 检查也会被跳过。

---

### 修复方案

4 处改动，均在 `.github/workflows/ci-l4-runtime.yml`：

1. **brain-integration if**: 增加 `|| needs.changes.outputs.workspace == 'true'`
2. **workspace-integration if**: 增加 `|| needs.changes.outputs.brain == 'true'`
3. **devgate-checks if**: 扩展为 brain OR workspace 变更均触发
4. **l4-passed gate**: 统一为 brain OR workspace 变更时检查双向集成结果

---

### 下次预防

- [ ] 新增 CI job 时，考虑跨组件依赖：某个 job 是否应该在"相关组件"变更时也触发？
- [ ] brain-integration 和 workspace-integration 是互相关联的——Brain API 是 workspace 的依赖，任一侧变更都应触发双向验证
- [ ] l4-passed gate 逻辑应同步更新——如果 job 的触发条件扩大，gate 的检查逻辑也要对应扩大
- [ ] DevGate（DoD/RCI 检查）应对所有代码变更触发，不应仅限于 brain 变更
