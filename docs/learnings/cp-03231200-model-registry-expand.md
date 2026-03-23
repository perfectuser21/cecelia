# Learning: model-registry 扩展 + Codex 无头 provider

**分支**: cp-03231200-model-registry-expand
**日期**: 2026-03-22

---

### 根本原因

孤儿 pipeline：任务在 Brain 中以小写优先级 `p1` 创建，pre-flight 校验失败（要求 `P1`），导致任务永久停留在 `queued` 状态，Pipeline Patrol 检测为孤儿。

### 关键决策

1. **codex provider 模型 ID 加前缀 `codex/`**：避免与 openai provider 同名模型（如 `gpt-5.4`）在 `getProviderForModel()` 查找时产生歧义。每个模型 ID 唯一对应一个 provider。

2. **callCodexHeadless 超时处理**：spawn 进程后设置独立 clearTimeout，避免 zombie 进程。child.kill() 在超时时发送 SIGTERM，Node 子进程默认会终止。

3. **per-branch PRD 文件创建**：branch-protect.sh 在 packages/ 子目录开发时要求根目录存在 `.prd-{branch}.md`，而 Brain 调度创建的是 `.prd-task-{uuid}.md`，孤儿救援时需手动创建符合命名规范的副本。

### 下次预防

- [ ] Brain 任务创建时 priority 必须大写（P0/P1/P2），创建侧校验或 pre-flight 友好提示
- [ ] orphan rescue 流程：检测到 `.prd-task-{uuid}.md` 时，自动创建 `.prd-{branch}.md` 软链接或副本
- [ ] codex provider 模型 ID 命名约定：统一使用 `codex/` 前缀区分 provider 路由
