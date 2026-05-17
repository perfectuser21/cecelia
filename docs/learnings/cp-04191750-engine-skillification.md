## Engine Skillification — Phase 5（14.17.11 → 15.0.0）（2026-04-19）

### 根本原因

Phase 4（PR #2419）把 /dev 瘦身到"Superpowers 自动化适配层"后期望主 agent 读 SKILL.md 里的 `/superpowers:*` 引用就自动接力。实测不工作 — 主 agent 读完 /dev SKILL.md 后只 `Read` 前置 step 文档，不会主动 `Skill({"skill":"superpowers:brainstorming"})`。

挖根因发现 Superpowers 真正的接力秘诀是**每个 SKILL.md 结尾都有 TERMINAL IMPERATIVE**（"Invoke writing-plans skill. Do NOT invoke any other skill. writing-plans is the next step."），主 agent 读到硬指令才会调下一个 Skill tool。

Engine 的 Step 0/0.5/0.7/3/4 只是 md 文档：
- 靠 `Read` / `cat` 加载，不是真 skill
- 结尾没有 terminal imperative
- 读完就散，没有"必须调 Skill tool"的硬指令

另外 `steps/03-integrate.md` 和 Superpowers `finishing-a-development-branch` 功能重叠（都做 push+PR 决策 + 执行），是 Phase 4 该删未删的冗余。

### 下次预防

- [ ] 新建任何 "skill chain 上的步骤" 时，必须做成真 skill（`<name>/SKILL.md` + 可被 `Skill({"skill":"<name>"})` 激活），不是 md 文档
- [ ] 每个 skill SKILL.md 结尾必须有 TERMINAL IMPERATIVE 块（明确告诉主 agent 下一个 tool call 必须是什么 Skill 调用，或者终棒"退出 assistant turn"）
- [ ] 拆分/合并"类似 Superpowers 现有 skill 的"功能前先做功能重叠检查（例：本 PR 发现 Stage 3 冗余于 finishing-a-development-branch）
- [ ] 验证 skill 接力链用 `claude --output-format stream-json`，看 tool-use 轨迹是否真连续 `Skill({"skill":"..."})` 调用（非 `Read`）
- [ ] Plugin/外部 skill 接驳回自家 skill 的跳转点（例：Superpowers finishing → engine-ship），在 Superpowers 不可改时，靠项目本地规则文件（autonomous-research-proxy）写硬规则
- [ ] Engine 版本 major bump（X.0.0）仅用于架构级变更（本 PR = 真 skill 化 + 删 Stage 3），跑 `bump-version.sh 15.0.0` 一键同步 6 处

### 相关 PR

- Phase 4: #2419（14.17.11） — 瘦身但未加 TERMINAL IMPERATIVE 导致接力断
- Phase 5: 本 PR（15.0.0） — 真 skill 化 + TERMINAL IMPERATIVE + 砍 Stage 3
