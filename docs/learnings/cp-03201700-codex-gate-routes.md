# Learning: Codex Gate 路由注册 + initiative_plan 路径清理

## 背景
Brain 有三条并存的派发路径（pr_plans / initiative_plan / area_stream），需要清理废弃路径并注册新的 Gate 审查类型。

### 根本原因
- initiative_plan 路径在 decomposition-checker.js 中自动创建任务，但 pr_plans 路径已能完全覆盖其功能
- 5 个旧审查类型（decomp_review / prd_coverage_audit / dod_verify / cto_review / code_quality_review）职责重叠，需要合并为 4 个 Gate 类型

### 下次预防
- [ ] 新增任务类型时必须同步更新所有注册点：task-router / executor / token-budget-planner / pre-flight-check / DEFINITION.md / brain-manifest
- [ ] 删除旧路径时先加新路径再删旧的（本次只加不删，后续 PR 统一清理）
- [ ] DevGate facts-check 会自动检测 DEFINITION.md 与代码不一致，改完代码后立即运行
- [ ] 删除函数时必须同步更新所有引用该函数的测试文件（包括同名和关联测试），否则 CI Unit Tests 会失败
