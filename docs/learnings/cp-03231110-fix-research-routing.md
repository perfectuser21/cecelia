# Learning - research task_type 路由断链修复

**Branch**: cp-03231110-fix-research-routing
**PR**: #1416

### 根本原因

executor.js skillMap 中 `'research': null`，导致调研任务在路由阶段直接放弃派发。
`preparePrompt` 里已有 research 专属处理逻辑（直接用 task description 构建 prompt），
但因 skillMap 返回 null，路由判断提前终止，永远到不了 preparePrompt。

### 下次预防

- [ ] 新增 task_type 时，skillMap 和 preparePrompt 必须同时检查一致性——skillMap null 但 preparePrompt 有处理是矛盾状态
- [ ] "完全只读"任务不需要 skill，应用空字符串 `''` 而非 `null`，让路由继续走到 preparePrompt 的专属处理分支
