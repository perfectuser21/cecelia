# PRD: LangGraph 节点内联 SKILL 内容（取代 /slash 调用）

## 背景
PR #2399 凭据修复后 LangGraph 容器能跑 Claude Code，但 reviewer 循环 24 轮无一次 APPROVED。根因：容器里 Claude headless 模式返回 "Unknown command: /harness-planner"，skill 调用语法不工作。Planner exit=1 导致 prd_content 为 null，后续 proposer/reviewer 拿到 "PRD 未生成" 只能无限 REVISION。

## 成功标准
- harness-graph.js 6 个节点的 prompt 都把 SKILL.md 内联，不用 /slash 语法
- Planner 能产出真实 PRD 内容（state.prd_content 非空）
- GAN 对抗轮次 <= 5 轮即 APPROVED 进 generator
