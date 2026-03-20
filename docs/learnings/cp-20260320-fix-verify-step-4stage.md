# Learning: verify-step.sh 4-Stage Pipeline 兼容性修复

## 背景
端到端验证发现 bash-guard/verify-step.sh 的旧逻辑和新 4-Stage Pipeline 不兼容。

### 根本原因
check-dod-mapping.cjs 在 Stage 1 阶段要求 DoD 条目已勾选 [x]，但新 Pipeline 中 Stage 1 只写 Spec，DoD 验证在 Stage 2 才做。verify-step.sh 的 verify_step1() 调用 check-dod-mapping.cjs 时没有区分"格式检查"和"完成检查"。

### 下次预防
- [ ] 改 Pipeline 阶段时同步检查所有 Gate/Hook 的兼容性
- [ ] 端到端验证应在合并前跑，不是合并后
- [ ] check-dod-mapping.cjs 的检查模式应参数化，避免一刀切
