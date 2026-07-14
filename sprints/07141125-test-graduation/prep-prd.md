# 小改动 PrepPRD：刀1 — merge 后测试自动入册 + 清偿 42 孤儿

> 来源：docs/prd/2026-07-14-ops-half-loop.prd.md 刀1节（Brain task 0a606f51）

## 改什么
1. **毕业机制**：新增 `scripts/graduate-sprint-tests.mjs`
   - 输入 sprint 目录 → 把 `tests/**/*.test.*` 搬到 `tests/regression/<sprint-slug>/`、
     `e2e-verify.sh` 搬到 `scripts/smoke/e2e/<sprint-slug>.sh`，并提示下调 baseline orphans
   - 供后续 harness-report / engine-ship（zenithjoy-skills repo，另立 PR 接线）调用；本 PR 内先手动用它清欠账
2. **跑道**：`packages/brain/vitest.config.js` include 增加 `'../../tests/regression/**'`（毕业测试进 brain-unit/nightly 全量）
3. **清偿 42 孤儿（三分法）**：
   - 07-10 后真欠账（6 测试+4 e2e）→ 毕业；红的修绿再入册
   - 07-10 前遗留（~32 个，当时判定脚手架该删没删）→ 移入 `sprints/archive/`（守活逻辑当时已升格 src/__tests__，不复活僵尸；archive 可逆）
   - 修不绿且属废弃功能的 → 同 archive 并在 PR 描述列明
4. **棘轮下调**：`scripts/test-pyramid-baseline.json` orphans 42→0，permanent 相应上调
5. scripts/smoke/e2e/ 子目录不进 PR CI glob（`scripts/smoke/*-smoke.sh` 顶层不递归），nightly 接线归刀3——A2 顶层判据不受影响

## 为什么改
PRD 刀1：修枢纽——"写好了就进池子"从此不需要任何人记得任何事；刀0 面板孤儿数从 42 归 0。

## 影响范围
- 不动 harness 编排；vitest.config.js 属 brain 包配置 → 跑 DevGate 三件套
- 毕业测试可能 import 相对路径需修（红修绿）；与 src/__tests__ 重复的删重

## 验收标准
- [ ] graduate 脚本有单元测试（TDD 先红后绿）
- [ ] `node scripts/test-pyramid-guard.mjs` 全绿且孤儿=0（棘轮锁死在 0）
- [ ] 毕业进 tests/regression/ 的测试 vitest 全绿
- [ ] CI 全绿
