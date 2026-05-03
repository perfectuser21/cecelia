# Learning: lint-test-pairing 删除测试文件盲区

### 根本原因

`lint-test-pairing.sh` 使用 `diff-filter=AM` 只检测新增/修改文件，完全不感知删除操作。AI agent 可以删除 `executor.test.js` 后修改 `executor.js`，lint 会在仓库中找到已存在的 test 文件（此刻已不存在但 lint 用 `-f` 检测磁盘状态），或者在某些时序下误判为通过。核心问题：删除路径从未进入任何 lint 检查范围。

### 下次预防

- [ ] 所有 lint gate 编写时，明确考虑 `diff-filter=D`（删除）场景
- [ ] 新增 lint 规则前问：AI 能否通过删除而非添加来绕过这条规则？
- [ ] `lint-test-pairing` 已修复：删 test 文件但 src 仍存在 → FAIL；src 同 PR 也删（模块移除）→ 放行
