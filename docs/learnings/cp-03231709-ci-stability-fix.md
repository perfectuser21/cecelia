# Learning: CI 稳定性加固 — 修复预存测试失败 + L4 Smoke Check

**分支**: cp-03231709-ci-stability-fix
**日期**: 2026-03-23
**PR**: #1451

---

### 根本原因

1. `packages/brain/src/actions.js:175` 的 `createInitiative` 函数在 INSERT 时硬编码了 `status='pending'`，而两个测试（orchestrated 模式和 cecelia backward compat 模式）均期望 `status='active'`。initiative 创建后应立即进入调度队列，`active` 是正确的初始状态。

2. `brain-test-baseline.txt=2` 的容忍机制允许最多 2 个预存测试失败静默通过 CI，导致测试债务可以悄悄积累直到 baseline 被耗尽时才被发现。

3. L4 Smoke Check 两个 bug：
   - **入口路径错误**：`node src/server.js` 应为 `node server.js`。Brain 入口定义在 `packages/brain/package.json` 的 `"main": "server.js"`，不在 `src/` 子目录。
   - **启动超时不足**：Brain 启动时需扫描 145+ 条迁移记录（全部 SKIP 但有 I/O）加上模块初始化，实测约 30s，20s 超时不够——扩展到 60s。

---

### 下次预防

- [ ] `createInitiative` 等"创建型"函数的初始 `status` 字段，必须在 Task Card DoD 里明确写 `[PRESERVE]` 条目保护，防止后续重构静默改变
- [ ] 任何 baseline 容忍文件（`*-baseline.txt`）修改时，必须同时提供"为什么可以设此值"的说明注释，防止基线被滥用为技术债逃逸口
- [ ] CI L1 的 DoD Execution Gate 对 `bash -c "... && echo OK"` 末尾的 `echo` 视为假测试——PRESERVE/BEHAVIOR 测试必须用 `node -e "...if(!cond)process.exit(1)"` 形式，不能以 `echo` 结尾
- [ ] `.dev-mode.*` 被 gitignore，CI detect-stage 默认回退到 stage=4，触发 Learning Format Gate——应在 Stage 3 推送前就准备好 Learning 文件（即本次教训）
- [ ] CI Smoke Check 写 `node XXX` 前先确认 `package.json` 的 `"main"` 字段，不凭路径猜测入口
- [ ] 新增 Smoke Check 时必须实测（或估算）服务启动时间，预留足够的 health 等待窗口
