---
id: learning-dev-local-ci-mirror
version: 1.0.0
created: 2026-03-15
updated: 2026-03-15
changelog:
  - 1.0.0: 初始版本
---

# Learning: /dev 步骤本地 CI 镜像检查（2026-03-15）

## 陷阱 1：Subagent 只验证 Test 命令，不验证 DoD 格式（2026-03-15）

### 根本原因

Verifier Subagent 只运行 DoD 条目里的 `Test:` 命令（如 `grep -c '...'`），不运行 `check-dod-mapping.cjs`。后者是 CI 专用脚本，检查 DoD 格式规则（[BEHAVIOR] 不能用 grep、条目数≥3），Subagent 完全不知道这些规则的存在。导致 Subagent PASS → CI FAIL 的矛盾，Subagent 形同虚设。

### 下次预防

- [ ] Step 1 格式自检通过后，立即本地跑 `node scripts/devgate/check-dod-mapping.cjs`，非零退出则修 DoD 再跑，通过才进 Subagent
- [ ] 记住：Subagent 是第二层（质量），CI 脚本是第一层（格式），顺序不能颠倒

## 陷阱 2：Learning 格式 bash 自检不等于 CI 检查（2026-03-15）

### 根本原因

Step 4 的 bash 自检只检查基础格式（文件存在、`### 根本原因`、`### 下次预防`、`- [ ]`），但 `check-learning.sh` 还有额外验证逻辑。用自己写的 bash 代替 CI 脚本，存在规则不一致的风险。

### 下次预防

- [ ] bash 格式自检完成后，紧接着跑 `bash packages/engine/scripts/devgate/check-learning.sh`（设置 `GITHUB_HEAD_REF` 和 `PR_TITLE` 环境变量）
- [ ] 永远用 CI 的同款脚本做本地验证，不自己重写检查逻辑

## 陷阱 3：Workspace 改动缺少本地 build 检查（2026-03-15）

### 根本原因

改 `apps/dashboard` 等 Workspace 代码时，只跑 `npm test`（单元测试），不跑 `npm run build`（TypeScript 编译）。TypeScript 类型错误不会导致测试失败，但会导致 CI L3 build 失败。

### 下次预防

- [ ] 检测到 `apps/` 改动时，push 前必须跑 `cd apps/xxx && npm run build`
- [ ] TypeScript 编译错误要在本地 build 时发现，不能等 CI

## 架构结论：三层防御（2026-03-15）

| 层 | 工具 | 职责 |
|----|------|------|
| **第 1 层（格式）** | CI 同款脚本（check-dod-mapping / check-learning / build）| 本地先跑，拦格式错误 |
| **第 2 层（质量）** | Verifier Subagent | LLM 评估深度和完整性 |
| **第 3 层（兜底）** | CI | 最终裁判，不应是发现格式问题的地方 |
