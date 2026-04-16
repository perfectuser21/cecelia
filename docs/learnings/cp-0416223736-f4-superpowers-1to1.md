# Learning: F4 — 1:1 复刻 Superpowers 交互点

## 根本原因
用户问两个具体问题：
1. Superpowers 7-8 轮交互点我们是不是 1:1 复刻了？
2. 我们用的所有 skill 都是 superpowers 的吗？

两轮 Explore agent 审计给出答案：**78% 替代 + 50% skill 覆盖**——两个都没达到 1:1。

**根因一致**：漏引 5 个核心 superpowers skill，导致 4 个交互点没 1:1 复刻。

漏引清单：
- receiving-code-review — 导致架构问题升级没出口
- requesting-code-review — 导致 Reviewer 请求格式松散
- executing-plans — 导致 plan 疑虑无 abort + BLOCKED 升级链设计错位
- finishing-a-development-branch — 导致 discard 无 typed-confirm

## 修复
一个 PR 5 个子改动：
1. 02-code.md Reviewer 加 ARCHITECTURE_ISSUE 分支（receiving-code-review）
2. 02-code.md Review 派遣加 5 项规范化（requesting-code-review）
3. 02-code.md BLOCKED 升级链 v2（executing-plans + 改正 systematic-debugging 时机）
4. 01-spec.md Self-Review 补 Step 5 Critical Gap Abort（executing-plans）
5. 04-ship.md 补 Discard 安全确认（finishing-a-development-branch）

autonomous-research-proxy.md 加交互点替代矩阵 v2 作为持久化记录。

Engine 14.16.0 → 14.17.0（minor）。

## 下次预防
- [ ] **"优化不替代"原则**：遇到 Superpowers 有等价 skill 时，**先引再改**，不要自造。自造可能漏掉官方边界 case（如 discard confirm）
- [ ] **每季度跑一次一比一审计**：Explore agent 读 `~/.claude-account3/plugins/cache/superpowers-marketplace/superpowers/<version>/skills/` 全目录 vs 我们的 `packages/engine/skills/dev/`，找新漂移
- [ ] **autonomous-research-proxy 的矩阵要持久化**：每次改 superpowers 对齐 PR 都要更新这张表，让下次审计从矩阵开始而不是从零跑
- [ ] **meta skill 不引但不算缺口**：`using-superpowers` / `writing-skills` 是写 skill 的 skill，我们的 /dev 是被写的对象，不适用。算覆盖率要扣除
