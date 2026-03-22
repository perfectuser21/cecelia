# Learning: skill-code-review-gate v1.1 升级

**分支**: cp-03221426-skill-crg-v11
**日期**: 2026-03-22

## 背景

升级 code-review-gate SKILL.md，将 Simplify 维度（C/E）升级为 blocker，新增维度 G（PRD/DoD 对齐验证），修复时机描述。

### 根本原因

SKILL.md 原始版本中维度 C/E 的检查项仅为 warning，导致重复代码和低效循环不被强制修复。时机描述与实际执行时机（Stage 2）不符，造成误解。

### 关键变更

- A1：维度 C「重复代码」和维度 E「不必要的循环」升级为 blocker，与维度 A/B 的安全性/正确性一致
- A2：新增维度 G（PRD/DoD 对齐验证），确保代码实现与 DoD 条目完全对应
- A3：统一时机描述为 Stage 2（push 前），消除与实际流程的矛盾

### 下次预防

- [ ] 新增 Skill 维度时，明确区分「建议性（info/warning）」与「强制性（blocker）」
- [ ] SKILL.md 触发时机描述必须与 /dev 流程文档保持一致
- [ ] 新增维度后同步更新输出格式的 dimension 枚举值
