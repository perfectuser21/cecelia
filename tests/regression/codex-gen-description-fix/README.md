# Sprint 07180825 测试结构

## 主测试文件（进 CI）

- `packages/brain/src/__tests__/codex-test-gen-description.test.js`
  - TDD Red/Green 测试（B-1 到 B-4 + vitest 关键词）
  - 由 brain-ci.yml 自动捡起

## 回归测试文件（既有）

- `packages/brain/src/__tests__/codex-test-gen.test.js`
  - 黑名单过滤、去重逻辑（INV-7、INV-8）

- `tests/regression/07172225-codex-pool-activation/codex-test-gen.test.ts`
  - codex 池激活回归

## 修补脚本

- `sprints/07180825-codex-gen-description-fix/repair-blocked-tasks.js`
  - 修复 5 个历史 blocked 任务（一次性，幂等）
