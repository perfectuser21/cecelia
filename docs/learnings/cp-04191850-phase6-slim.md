## Engine Phase 6 — Slim & Unblock（15.0.0 → 16.0.0）（2026-04-19）

### 根本原因

Phase 5（15.0.0）实现了 TERMINAL IMPERATIVE 接力，但深度审计暴露 3 类结构问题：

1. **阻碍 — proxy 规则失联**：Phase 5 把 /dev SKILL.md 改成纯点火链时，删掉了"必读 autonomous-research-proxy.md"的 `cat` 指令。proxy 211 行规则（Tier 1/2/3 替代 Superpowers 问用户交互点的完整规则集）因此被主 agent 完全无视。结果：brainstorming 问 clarifying question / spec approval / finishing 4 选项时，主 agent 按原 Superpowers 意图停下等用户，autonomous 死锁。

2. **矛盾 — engine-enrich 一字不差复制 brainstorming**：engine-enrich SKILL.md 里的 "5 自问 + 3 轮自 review + 探索代码库" 是 superpowers:brainstorming SKILL.md 的 checklist 拷贝。Phase 4 删 01-spec.md 的理由是"duplicate brainstorming"，但 engine-enrich 做同样的事只是换了名字。

3. **阻碍 — engine-decision 产物无人消费**：engine-decision 写 `.decisions-<branch>.yaml`，SKILL.md 里说"后续 Superpowers subagent 应 cat 此文件"——但 Superpowers 自己不知道这个文件，autonomous-research-proxy 的 Tier 1/2/3 规则里也没有任何一条说"派 Research Subagent 前先 cat decisions yaml"。写完就废，脏 artifact。

4. **垃圾——74% 噪音**：Engine 自己写的 6 个文件 748 行，真正对主 agent 有用的只约 195 行。/dev SKILL.md 116 行中 100 行是给人看的架构图/目录树/接力链图/Phase 4 已删列表；autonomous-research-proxy 211 行中 170 行是 F4 17 项交互点审计表、POC 参考、覆盖率统计、已删文件路径映射（全部是历史档案，运行时主 agent 读这些纯粹浪费 token 并可能让主 agent 去 Read 已删文件）。

### 下次预防

- [ ] 每次加 skill/step 前问自己：**它做的事 Superpowers 是不是已经做了？** 若是，下放到 autonomous-research-proxy 的 Tier 规则，不要独立 skill
- [ ] skill 的"产物文件"（.decisions-yaml / .enriched-prd 等）必须在其他 skill 的 prompt/规则里有明确"读取指令"，否则不要写
- [ ] SKILL.md 行数审计：超过 50 行必检查哪些是给人看的文档（删）vs 给主 agent 的指令（留）
- [ ] autonomous-research-proxy 之类的"运行时规则文件"**必须**在 /dev SKILL.md 里明确指令读取（inline Tier 1 核心条款 + 指明 "按需 Read"），不能假设主 agent 会自己去读
- [ ] 每次 Engine PR merge 前跑 `wc -l` 审计自写文件总行数，对比 baseline，增长超 20% 必须讨论
- [ ] Phase X 升级是否该 major bump：删 skill / 改接力链 / 改跨命名空间硬规则 = major
- [ ] Phase 5 的 `Base directory for this skill:` stream-json 验证方法保留为标准验证法：`claude --output-format stream-json --disallowedTools "Bash Edit Write" -p "..."` 看 tool-use 轨迹连续 Skill 调用无 Read 中断

### 相关 PR

- Phase 4: #2419（14.17.11） — 瘦身 prompts/ 但未加 TERMINAL IMPERATIVE
- Phase 5: #2423（15.0.0） — 加 TERMINAL IMPERATIVE 接力链 9 棒；proxy 规则失联 + enrich/decision duplicate + ship 冗余
- Phase 6: 本 PR（16.0.0） — 删 enrich/decision；proxy 瘦身 + 加 Tier 1 两条；/dev inline 核心规则；接力链 9→7 棒；自写 748→228 行
