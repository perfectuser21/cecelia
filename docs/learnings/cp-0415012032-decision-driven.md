## Decision-Driven Autonomous Layer (2026-04-15)

### 根本原因
CTO/COO 审查发现 autonomous_mode 让 AI 自扮 user 做设计决策 = 同一个 LLM 给自己打勾，认知自欺。真正的 "user approval" 本意是 Alex 有真实利益、方向控制权，不是形式上的审查。

### 解决路径
不让 AI 自扮 user，而是查 Alex 真实历史决策（Brain decisions 表）。AI 被约束在 Alex 已经做过的决策范围内执行；缺关键决策就暂停等 Alex 回复，不自创。

### 下次预防
- [ ] 新加类似"自动化加一层"的设计前，先审查是否"AI 自己做证明自己"
- [ ] 凡是 Superpowers skill 要求"user approval" 的环节，必须找到真实人类判断的替代源（decisions 表、历史 learning、产品文档），不允许用 subagent 扮演
- [ ] classifyTopicCriticality 启发式关键词表需要随业务演进扩展，否则新类型 critical 决策会被默认成 routine 错过暂停
