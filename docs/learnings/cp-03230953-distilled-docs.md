# Learning — 记忆蒸馏文档层：为什么 Layer 2 是身份锚点而非检索优化

**Branch**: cp-03230953-distilled-docs
**PR**: #1407

### 根本原因

Cecelia 记忆系统的 Layer 0（原始记录）→ Layer 1（向量化）→ Layer 3（注入）链路中，Layer 2（蒸馏文档层）完全缺失。每次对话靠向量检索召回，无任何保证核心身份的机制：

- 如果 DB 查询超时或返回空，SOUL 信息会静默丢失
- 向量检索依赖 embedding，embedding 依赖 OpenAI API —— 任何一环故障都会影响身份注入
- 没有"永久锚点"，Cecelia 的行为在恶劣条件下会退化为无身份的通用助手

对比 OpenClaw 的 SOUL.md：核心性格作为静态文件，每次对话前必读，与任何检索结果无关。

### 设计决策

**SOUL 和 SELF_MODEL 注入方式**：预算外（budget-exempt）。

理由：SOUL 是身份保证，不能因 token 预算不足而被裁减。SELF_MODEL 是能力边界描述，影响 Cecelia 对自身局限的准确判断。两者的内容量可控（< 500 token），风险低。

**USER_PROFILE 和 WORLD_STATE**：仅 chat 模式追加，原因是这两者在任务执行模式（execute/plan/debug）下价值不高，反而增加噪音。

**DB 存储而非文件**：SELF_MODEL/USER_PROFILE/WORLD_STATE 是动态生成的，需要随 learnings 和 OKR 变化而更新。选择 distilled_docs 表而非文件，便于程序化更新和版本追踪。SOUL 虽然相对静态，也放在同一表中保持一致性。

### 下次预防

- [ ] 任何新的记忆检索路径，必须先问：SOUL 是否一定会被注入？不能只依赖向量检索保证身份
- [ ] 蒸馏文档的更新频率要与内容的时效性匹配：SOUL 几乎不变，WORLD_STATE 每天，SELF_MODEL 每周
- [ ] 向量检索失败时应有 graceful fallback，不能静默返回空 block——至少 SOUL 要保底注入
