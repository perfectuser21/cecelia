# Learning: executor 路由被并行 PR squash 覆盖

## 概要
PR #1192 的路由改动（DEV_ONLY_TYPES）被并行 PR #1194 的 squash merge 覆盖。

### 根本原因
两个 PR 同时改 executor.js，squash merge 时后者覆盖了前者的改动。CI 只检查功能测试，不检查"路由逻辑是否存在"。

### 下次预防
- [ ] 并行 PR 改同一文件时，合并后立即验证所有改动都在 main 上
- [ ] 添加 CI 检查：DEV_ONLY_TYPES 必须存在于 executor.js
