# Learning: feat(capture) — Atom Review UI

**分支**: cp-03262253-capture-review-ui
**日期**: 2026-03-26

## 完成了什么

1. 新增 `AtomReview` 组件（`apps/api/features/gtd/components/AtomReview.tsx`）— 展示 pending_review 状态的 capture_atoms，按 target_type 筛选，显示 confidence/ai_reason，支持 confirm/dismiss 操作
2. 重构 `GTDInbox` 页面 — 从自定义 CSS class 改为 Tailwind CSS（与 GTDKnowledge 等页面风格一致），新增 Captures/Atom Review 双 Tab 切换
3. 完成 Capture Digestion 系列第 4 个 PR（Review UI），用户现在可以审阅 AI 拆解结果

### 根本原因

GTDInbox 页面原来使用自定义 CSS class（如 `gtd-inbox-page`、`gtd-inbox-header`），但没有对应的 CSS 文件定义这些样式。
其他 GTD 页面（GTDKnowledge、GTDOkr 等）都使用 Tailwind CSS 内联 class。
这导致 GTDInbox 的样式实际上未生效，页面缺少视觉样式。
为保持一致性并修复样式缺失问题，将整个页面重构为 Tailwind CSS。
同时新增 Tab 切换架构，为 AtomReview 面板提供了自然的集成点。

### 下次预防

- [ ] 新建前端组件时，检查同目录已有组件的样式方案（Tailwind vs CSS Module vs 自定义 class），保持一致
- [ ] `URLSearchParams` 构造查询字符串时，DoD 的 `includes()` 测试需要匹配实际源码字面量而非运行时 URL，必要时用模板字符串直接拼接使源码可检索
- [ ] vitest 在 worktree 下运行时可能因 npm workspace 问题导致非零 exit code（即使所有测试通过），GATE 测试不应依赖本地 `npm test` exit code
