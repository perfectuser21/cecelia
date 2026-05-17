# Learning: PR-D executor 真路径 smoke（2026-04-27）

- 影响：brain 最大核心模块 executor.js 3620 行 0 真覆盖
- 触发：4 agent 审计 / 100% foundation 路线 PR-D

---

### 根本原因

executor.js 是 brain 调度引擎核心（~3620 行），但 src/__tests__/executor*.test.js 全部 vi.mock 掉 db / spawn / bridge / pg。spawn 真路径需要 cecelia-bridge 在 CI clean docker 不可达，导致 0 真 smoke。

但 executor 有大量纯函数（路由表 / UUID / model selection / provider selection / credentials parsing），不依赖 IO，**完全可以 docker exec 直调验证契约**。

---

### 修复

`packages/brain/scripts/smoke/executor-pure-functions.sh` 5 case 覆盖 5 个关键纯函数：
- `getSkillForTaskType` 路由表
- `getSkillForTaskType` decomposition payload 优先级（覆盖 v6 升级路径）
- `generateRunId` UUID v4 格式
- `getProviderForTask` 不抛
- `checkTaskTypeMatch` 不抛（v9 函数）

学 PR-B dispatcher-real-paths.sh 的 docker exec 模式（已被 post-deploy 验证有效）。

### 设计要点

- **bash heredoc + JS regex**：bash 双引号串里 `/dev/i` 被吞（路径 glob 干扰），改用 `String.includes()` + `toLowerCase()`
- **assertion 不死写实现细节**：`/code-review` vs `/review` 这种实现选择会变。只验"返非空 + 含 task_type 关键字"
- **container 自动检测**：smoke 同时支持 CI (cecelia-brain-smoke) 和本机 (cecelia-node-brain)

---

### 下次预防

- [ ] 任何 brain 核心模块加新函数必须配套 smoke。executor 之外还有 cortex / thalamus / ops / brain-meta 等待 PR-E/F/...
- [ ] bash + 嵌入 JS 时避用 regex literal /xxx/，改 String 方法。或用 heredoc + node -e <<EOF
- [ ] smoke 不要死写实现细节（路由 path 名）— 只验合理"keyword 包含" 契约，让重命名重构不破坏 smoke
