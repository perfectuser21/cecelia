# Learning: /decomp skill 拆解粒度校准表 + Initiative 技术调研规则

分支: cp-20260321-decomp-calibration-table
日期: 2026-03-21

## 变更内容

- /decomp SKILL.md 新增拆解粒度校准表（Task/Initiative/Scope/Project 各层级 PR 数量/周期/判断标准）
- 新增 3 条反例说明，防止层级错配
- 新增 Initiative 技术调研规则：每个 Initiative 第一个 Task 为 WebSearch 技术调研

### 根本原因

/decomp skill 缺乏明确的粒度校准标准，导致拆解结果容易出现层级错配（如把 Scope 级别的工作量错误标记为 Initiative）。同时 Initiative 执行缺少技术调研前置步骤，agent 容易直接开干而踩坑。

### 下次预防

- [ ] 新增 /decomp 规则时，确认 F 模板（Initiative 模板）同步更新
- [ ] 校准表数据基于实际产能模型，如果产能模型变化需同步更新校准表
- [ ] Engine 版本 bump 时记住检查 engine 目录自身的 package-lock.json（不只是根目录的）
