---
id: learning-fix-engine-test-drift
version: 1.0.0
created: 2026-03-14
updated: 2026-03-14
changelog:
  - 1.0.0: 初始版本
branch: cp-03141205-fix-engine-test-drift
pr: pending
---

# Learning: Engine 测试漂移修复

## 根本原因

1. **stop-dev.sh Unicode 污染（与 test-dev-health.sh 同一 bug）**
   `$DEV_MODE）` 中 `）`（U+FF09，UTF-8：0xEF 0xBC 0x89）的 0xEF 字节在 macOS bash 3.2 中被视为变量名字符
   → `DEV_MODE°: unbound variable` → `set -euo pipefail` 触发 exit 1 而非预期的 exit 2

2. **ci-timeout.test.ts 引用已删除的 engine-ci.yml**
   CI 架构重构（PR #755）将 `engine-ci.yml` 拆分为 l1/l2/l3/l4 四个文件，但测试从未更新

3. **stop-hook-state-integrity 旧格式测试期望值过时**
   v14.0.0 "删除所有旧格式兼容代码"，旧 `.dev-lock`（无后缀）不再被 session 预检查匹配
   → 旧格式工作流现在正确退出 0（允许结束），测试应反映此变更

## 下次预防

- [ ] 在 CI 架构重构时必须同步更新所有引用旧 CI 文件名的测试（engine-ci.yml → l1/l2/l3/l4）
- [ ] 与 test-dev-health.sh 同样的教训：`$VARNAME` 后接全角字符时，必须用 `${VARNAME}` 明确界定
- [ ] 删除旧格式支持时，必须同步更新相关测试（期望值从 exit 2 改为 exit 0）
- [ ] 本地 macOS 测试只能验证 37 个"伪失败"（stat -c 平台差异），CI（Linux）是真正裁判
