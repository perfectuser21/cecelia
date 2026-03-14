---
id: learning-format-duration-cx
version: 1.0.0
created: 2026-03-14
updated: 2026-03-14
branch: cp-03140957-format-duration-cx
changelog:
  - 1.0.0: 初始版本
---

# Learning: format_duration_ms 亚秒边界修正（2026-03-14）

### 失败统计

- CI 失败 1 次
- 本地验证失败 1 次

### CI 失败记录

- 失败 #1：`Learning Format Gate` 要求 PR 首轮就包含 branch learning 文件，而不是等主检查全绿后再补
  - 修复方式：新增 `docs/learnings/cp-03140957-format-duration-cx.md` 并推回功能分支
  - 下次如何预防：只要进入 `/dev` 且仓库启用了 learning gate，就在第一次 PR 修复循环里把 per-branch learning 当成硬门禁产物处理

### 本地验证失败记录

- 失败 #1：`npm run qa -w packages/engine` 命中了仓库现有的 hook/cleanup 测试基线失败，和本次 `format-duration` 改动无直接关联
  - 修复方式：保留 `shell test + targeted vitest + typecheck + build` 作为本次变更验证，同时在 incident log 中记录 baseline 情况
  - 下次如何预防：小范围 utility 变更先跑目标测试锁定自身回归，再决定是否要为仓库级基线单独开修复任务

### 错误判断记录

- 一开始按 step 文案理解为“CI 通过后再写 Learning”，但仓库实际的 L1 Process Gate 会在 PR 阶段直接校验 learning 文件是否存在
- 一开始以为 `format_duration_ms` 的亚秒逻辑已经够用，但实际 `1ms` 到 `99ms` 会被压成 `0s`，这是可观测信息丢失

### 影响程度

- Medium

### 预防措施

- 以后看到 `Learning Format Gate` 时，默认把 per-branch learning 文件视为首轮 PR 必备产物
- shell 工具函数除了主路径外，要专门补“非零但最小量级”的边界测试，避免被整数截断悄悄吃掉信息
