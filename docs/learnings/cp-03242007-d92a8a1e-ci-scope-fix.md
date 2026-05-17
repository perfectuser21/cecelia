# Learning: CI scope 补全 — workspace L4触发器 + Brain-API集成测试 + routing-map

**Branch**: cp-03242007-d92a8a1e-eef3-415a-b394-7eb72b
**PR**: #1555
**Date**: 2026-03-24

---

### 根本原因

PR #1533（CI scope 补全）因落后 main 27 commit 被关闭，但其中三项改动未进 main：
1. L4 缺少 workspace 触发器，apps/ 变动不触发任何 L4 job
2. Brain-API proxy 层无集成测试，前端→Brain 路径无自动化覆盖
3. routing-map 未注册 scripts/ 全目录和 ci/ 非配置文件

### 下次预防

- [ ] CI workflow 改动时 PR title 必须含 `[CONFIG]` 或 `[INFRA]`（L1 CI Config Audit 强制要求）
- [ ] workspace 子系统新增测试时，同步在 L4 workflow 添加对应触发器（不只是 L3）
- [ ] routing-map 注册时注意区分：`scripts/devgate/**` 已由 `devgate-core` 覆盖，`scripts/**` 作为父级不冲突，层级分明
- [ ] 新测试文件使用 `vi.stubGlobal('fetch', mockFetch)` + `afterEach vi.unstubAllGlobals()` 模式，确保 CI 无服务状态可运行
- [ ] 所有 /dev 任务的 Learning 必须在合并前 push 到功能分支，Learning Format Gate 会检查 per-branch 文件
