# Learning: Cecelia 自我感知层

## 根本原因

Cecelia 丘脑和 Claude Code 都存在"上下文盲"问题：
- 丘脑 LLM 调用只注入 800 token 历史记忆，没有系统能力地图和实时状态
- executor dispatch 给 Claude Code 的 prompt 没有系统背景
- AGENTS.md + .agent-knowledge/ 虽然存在，但从未被注入到任何 LLM 调用

## 根本架构洞察

这是行业通用问题（OpenClaw 称之为 Status Scan）：
- 持久进程（Brain Node.js）有状态 ≠ LLM 层有感知
- LLM 调用是无状态的，必须在每次调用时注入当前状态
- "系统有记忆" ≠ "LLM 知道当前情况"

## 解法

三层叠加（参考 OpenClaw 设计）：
1. **静态知识**（AGENTS.md）→ 告诉 AI 系统架构（已有，但未注入）
2. **动态感知**（buildSelfAwarenessContext）→ 每次 LLM 调用注入实时状态（本次新增）
3. **执行背景**（buildSystemContextBlock）→ dispatch 时让 Claude Code 知道自己角色（本次新增）

## 下次预防

- [ ] 新增任何 LLM 调用层时，必须同步注入自我感知上下文
- [ ] AGENTS.md 更新后，SKILLS_SUMMARY 常量也要同步更新
- [ ] buildSelfAwarenessContext 缓存 TTL 应与 Tick 间隔匹配（当前 5min = Tick 间隔）
- [ ] 考虑将 SKILLS_SUMMARY 改为从 .agent-knowledge/skills-index.md 动态读取
