---
branch: cp-03171706-fix-brain-l3-tests
pr: "#1039"
date: 2026-03-17
---

# Learning: 修复 Brain L3 测试失败

## 根本原因

**两个独立问题同时导致 CI L3 `coverage-baseline` job 每次 push main 都失败：**

1. **startup-sync.test.js（3 个失败）**：PR #1025 修改了孤儿任务恢复逻辑（`watchdog_retry_count < 2` → requeue，`>= 2` → fail），但测试 payload 未同步更新，`watchdog_retry_count=0` 走 requeue 路径，断言 `orphans_fixed=1` 失败（实际是 `requeued=1`）。

2. **blocks.test.js（17 个失败）**：纯集成测试，直接 `fetch('http://localhost:5221/api/brain/...')`。`brain-unit` CI job 已用 `--exclude` 排除，但 `coverage-baseline` job 用 `npm run test:coverage` 无排除，CI 中无 Brain 服务，全部 `fetch failed`。

## 修复方案

1. `startup-sync.test.js`：3 个孤儿测试用例 payload 添加 `watchdog_retry_count: 2`，触发 fail 路径（`>= 2` 阈值）
2. `blocks.test.js`：顶部加 `BRAIN_INTEGRATION` 环境变量 skip guard（与 `smoke.test.js` 同模式），`coverage-baseline` job 中会跳过

## 下次预防

- [ ] **修改逻辑时同步更新测试**：PR #1025 改了孤儿重试逻辑但未更新测试——修改行为时，PR 描述应明确列出需同步更新的测试文件
- [ ] **集成测试必须有 skip guard**：任何需要外部服务（DB/HTTP/服务端口）的测试必须用环境变量 guard（`BRAIN_INTEGRATION`、`SMOKE_ENABLED` 等），不能让 coverage job 裸跑
- [ ] **coverage job 排除 pattern 需统一管理**：目前 `brain-unit` 用 `--exclude`，`coverage-baseline` 无排除，两者行为不一致；应在 `vitest.config.js` 或 `package.json` 统一配置 exclude pattern
- [ ] **跑 test:coverage 前检查是否有无 guard 的集成测试**：CI coverage job 只应跑纯单元测试，集成测试靠 guard 自动跳过
