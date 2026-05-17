# Learning: 动态产能模型 — 写死产能数字的系统性风险

分支: cp-03211704-dynamic-capacity-model
日期: 2026-03-21

## 变更内容

- Brain 新增 `GET /api/brain/capacity-budget` API，动态计算 `pr_per_slot_per_day`
- /decomp SKILL.md 产能模型从写死数字改为动态查询
- /decomp-check SKILL.md 新增 PR 数量校验（基于 capacity-budget 动态值）

### 根本原因

产能模型写死在 SKILL.md 里（12 slots、287 PR/day、8600 PR/month），但实际已有 3 台 Mac Mini（26 slots）。导致：
1. /decomp 拆解时用错误的产能假设，PR 数量估算偏低 5-7 倍
2. /decomp-check 没有 PR 数量校验项，无法发现粒度错配
3. /plan 判断层级时没有查校准表，凭感觉判断

更深层问题：校准表同时绑定了 PR 数量和时间跨度，当产能变化时两个维度脱钩。正确做法是时间框架固定（KR=月、Project=周），PR 数量由当前产能动态计算。

### 下次预防

- [ ] 所有涉及产能的数字必须从 capacity-budget API 获取，禁止在 SKILL.md 中写死
- [ ] 新增机器或账号后，确认 capacity-budget API 能感知到变化（通过 fleet-resource-cache）
- [ ] 产能模型变更时，同步检查 decomp、decomp-check、plan 三个 skill 是否需要更新
