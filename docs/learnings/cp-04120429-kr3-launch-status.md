---
branch: cp-0412022935-a0452a2a-a884-48e5-a483-e154bc
date: 2026-04-12
task: KR3 小程序核心功能开发推进 — 现状盘点与上线路径
---

# Learning: KR3 小程序现状盘点 — 代码 85% 完成，剩余均为手动操作

### 根本原因

KR3 Brain 进度显示 25%，但实际代码完成度约 85%（18 个 PR 已合并）。进度数字与代码进展严重脱节。

关键发现：
1. **并行作业冲突**：同一时段多个 worktree 推进同一功能（privacy popup），导致 main 仓库被 checkout 到中间态分支（cp-04120428-privacy-policy-popup），包含未完成的 app.json（注册了不存在的组件）。但 origin/main 已有正确实现（PR #18）。
2. **现状盘点优先于编码**：Brain 派来此任务时，代码层面已基本完成，核心工作是识别"剩余的是什么"而非"继续写代码"。

### 下次预防

- [ ] KR 进度更新必须在每个 PR 合并后同步（PR 合并 → `PATCH /api/brain/okr/:id`）
- [ ] 并行 worktree 推进同一功能前，先检查 origin/main 是否已有相同功能的合并 PR
- [ ] "任务完成" ≠ "代码完成" — 需要区分 code-done 和 deployed-tested-done

### 实操细节

- launch-checklist.md v2.0 将 26 个代码验证项从 `[ ]` 全部改为 `[x]`
- 4 个 P0 阻断项均为手动操作（不是代码 bug）：云函数部署 / 支付沙盒 / 真机测试 / 平台配置
- 灰度上线 8 步操作步骤已记录在 docs/launch-checklist.md 第八节
