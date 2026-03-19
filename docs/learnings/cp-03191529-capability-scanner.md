# Learning: 能力孤岛扫描器

## 分支
`cp-03191529-capability-scanner`

## 变更摘要
新增 capability-scanner.js，每 6 小时扫描 capabilities 表 vs 实际使用数据，标记孤岛/休眠/活跃/失败能力。

### 根本原因

Cecelia 累积了 37 个已注册 capability，但从未验证过哪些能力真的在被使用。之前做过一次性孤岛分析（2026-02），但没有持续机制。

能力孤岛的危害：
1. 维护成本：代码在那里但没人用，增加认知负担
2. 误判能力：Brain 以为自己会做 X，但 X 从未成功过
3. 进化方向偏差：不知道哪些能力退化了

### 下次预防

- [ ] 新注册 capability 时，同时定义其"活跃判定条件"（哪些 task_type/skill 算使用过）
- [ ] capability 的 related_skills 字段必须准确维护，否则 scanner 判断不准
- [ ] 每月检查一次孤岛列表，决定是清理还是激活
