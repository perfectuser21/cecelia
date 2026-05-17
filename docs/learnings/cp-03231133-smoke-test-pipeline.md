# Learning: smoke test /dev pipeline 端到端冒烟验证

**branch**: cp-03231133-smoke-test-pipeline
**date**: 2026-03-23

## 背景

PR #1415 修复了 verify-step.sh seal key 命名不一致（P0 死循环根因）。本次冒烟测试通过实际跑完整 /dev pipeline 来验证修复确实生效，不再出现 stop hook 死循环。

### 根本原因

seal key 命名不一致：`_pass()` 函数写入的是 `${STEP}_seal`（如 `step1_seal`），而 stop-dev.sh 的 `_SEALED_STEPS` 数组检查的是 `step_1_spec_seal` 格式，导致永远匹配失败，stop hook 无法退出。

### 下次预防

- [ ] verify-step.sh 的 `_pass()` 函数现在使用 case 语句明确映射：`step1→step_1_spec_seal`、`step2→step_2_code_seal`、`step4→step_4_ship_seal`
- [ ] stop-dev-seal.test.ts 有 14 个测试覆盖 seal key 格式，确保格式一致性
- [ ] 冒烟测试是验证 pipeline 整体健康的最直接方式，P0 修复后应立即跑冒烟
