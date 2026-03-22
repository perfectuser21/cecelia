# Learning: 清理废弃 Skills

## 根本原因

随着系统演进，部分 skill 已被更好的替代方案覆盖（review/audit/assurance 被 code-review 覆盖），
或从未被 Brain 实际派发使用（versioning, sync-hk, brain-register），
或自身 changelog 已标记废弃（repo-lead）。

## 下次预防

- [ ] 新建 skill 时在 feature-registry.yml 注册，方便追踪使用状态
- [ ] 每季度审计 skill 使用频率（通过 Brain tasks 表统计），及时清理僵尸 skill
- [ ] skill 废弃前先在 SKILL.md 加 deprecated 标记，下次清理时可批量识别
