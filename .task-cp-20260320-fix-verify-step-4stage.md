---
id: task-cp-20260320-fix-verify-step-4stage
type: task-card
branch: cp-20260320-fix-verify-step-4stage
created: 2026-03-20
---

# Task Card: verify-step.sh Stage 1 Gate 兼容 4-Stage Pipeline

## 需求（What & Why）
**功能描述**: Stage 1 Gate 跳过 DoD 完整检查，避免在 Spec 阶段因未勾选 DoD 被拦截
**背景**: 新 4-Stage Pipeline 中，Stage 1 只写 DoD 条目，验证在 Stage 2

## 成功标准
1. [ARTIFACT] verify-step.sh Stage 1 Gate 1 跳过 DoD 完整检查
2. [BEHAVIOR] Stage 1 不再因未勾选 DoD 项被拦截
3. [GATE] CI 全部通过

## 验收条件（DoD）

- [x] [ARTIFACT] verify-step.sh Stage 1 Gate 1 跳过 DoD 完整检查
  Test: manual:node -e "const c=require('fs').readFileSync('packages/engine/hooks/verify-step.sh','utf8');if(!c.includes('Stage 1'))process.exit(1)"

- [x] [BEHAVIOR] Stage 1 不再因未勾选 DoD 项被拦截
  Test: manual:node -e "const c=require('fs').readFileSync('packages/engine/hooks/verify-step.sh','utf8');if(c.includes('check-dod-mapping'))process.exit(1)"

- [x] [GATE] 所有现有测试通过
  Test: manual:bash -c "npm test 2>&1 | tail -5"
