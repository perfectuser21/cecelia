# Deploy 风险分级系统设计（2026-04-05）

## 场景

实现 GitHub Actions 发布决策层，在 Brain 核心改动时自动分流到 Safe Lane（staging 验证），非核心改动走 Fast Lane（直接部署）。

## 根本原因

Brain 包含多个关键编排文件（thalamus/tick/executor 等），其改动风险远高于普通配置修改。之前所有 PR 都走同一条部署路径，缺乏对高风险改动的缓冲保护，可能导致编排故障直接影响生产环境。

## 设计决策

**1. 风险分级策略**
- Fast Lane（risk_level=low）：改动非核心文件 → 直接部署 production
- Safe Lane（risk_level=high）：改动核心文件 → 先部署 staging 验证 → smoke test 通过后部署 production
- [SAFE-DEPLOY] bypass：commit message 含此标签强制走 Fast Lane

**2. 核心文件清单**
高风险路径包括 8 个 Brain 核心文件：
- `packages/brain/src/thalamus.js` — 任务编排引擎
- `packages/brain/src/tick.js` — 定时循环核心
- `packages/brain/src/executor.js` — 动作执行器
- `packages/brain/src/task-router.js` — 任务路由
- `packages/brain/src/migrate.js` / `migrations/` — 数据库迁移
- `packages/brain/src/selfcheck.js` — 自检机制
- `packages/brain/src/routes/ops.js` — 运维接口

**3. Staging 验证流程**
- 触发 staging 部署（端口 5222）
- 轮询等待 staging 部署完成（max 300s）
- 执行 staging smoke test（健康检查）
- 通过后才允许 production 部署

## 下次预防

- [ ] **DoD 设计缺陷**：测试命令需要验证原始文件名而不是正则表达式转义版本，下次在注释中同时列出两种格式
- [ ] **分支混淆风险**：ensure .dev-mode 文件与 .task 卡片一致，检测是否有多个任务混在同一分支
- [ ] **Bypass 滥用**：[SAFE-DEPLOY] bypass 可能被滥用绕过 Safe Lane 检查，建议添加日志审计和使用限制
- [ ] **Staging 环境同步**：确保 staging（5222）与 production（5221）的 Brain 版本完全一致，避免验证有效性问题
- [ ] **Smoke Test 覆盖**：当前 smoke test 只检查 /health，考虑添加更深层的验证（如 API 端点调用）
