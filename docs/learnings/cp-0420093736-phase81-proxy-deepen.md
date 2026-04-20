# cp-0420093736-phase81-proxy-deepen — Learning

### 背景

Phase 8.1：把 Superpowers 32 个交互点中 13 个关键路径点（brainstorming 6 + SDD 3 + RCR 4）的 proxy prompt 深度化。

### 根本原因

Phase 6 瘦身后 proxy.md 只覆盖 17 个交互点（53%）且为"浅层固定默认值"。用户 2026-04-20 明确要求"完全自主 + AI 深度研究后回答"。之前走偏根因：proxy 把 decisions/learnings 列为核心 anchor（用户说"不一定准"），没有围绕"用户的话 > 代码 > OKR"建立数据源排序；且"问用户"的交互点默认"给固定答案"而非"深度自动化"。

### 下次预防

- [ ] 任何 autonomous 回答规则：数据源排序声明必须放在 prompt 首部，且明确声明"不读 decisions/learnings/design-docs"
- [ ] 任何新增"问用户"交互点 → 默认先写 proxy 深度规则，再考虑人为 gate
- [ ] Structured Review Block 规范落地到 Brain（Phase 8.3），替代"打分"的口头约定；每个自主决策必须可事后追溯
- [ ] PR LOC 阈值（软 200 / 硬 400）在 harness-planner 也复用，不要两边各写
