# Learning: Ralph Loop 模式三 Phase 测试全覆盖 (cp-0504201242)

**PR**: #2757
**分支**: cp-0504201242-ralph-tests-redo
**合并时间**: 2026-05-04

## 背景

PR #2752（Ralph Loop 模式）引入 Stop Hook v21.0.0 后，遗留重大测试 gap：Phase A E2E 全为 describe.skip、verify_dev_complete 零单测、无 smoke 验证。本 PR 补全三层测试金字塔。

## 做了什么

- `packages/engine/tests/e2e/stop-hook-full-lifecycle.test.ts`：12 场景 E2E 重写，适配 cwd-as-key + Ralph 协议，unskip 所有场景
- `packages/engine/tests/unit/verify-dev-complete.test.sh`：21 case unit test，覆盖 Happy Path（三守门全过）+ 各种 blocked 路径
- `packages/engine/scripts/smoke/ralph-loop-smoke.sh`：Phase C 端到端 smoke（12 步），验证真实 git repo 下状态文件生命周期
- `packages/engine/features/feature-registry.yml`：补录 18.19.1 changelog 条目
- 总计 50 case，含既有 ralph-loop-mode integration 5 case

## 根本原因

Ralph Loop 模式（Stop Hook v21.0.0）改变了完成路径的状态机（cwd-as-key + verify_dev_complete 三守门），但 PR #2752 在引入新模式时未同步重写测试，导致：
1. Phase A E2E 全部 describe.skip — 无测试覆盖
2. verify_dev_complete 零单测 — 核心守门逻辑完全未测
3. 无 smoke — 端到端链路未验证

同时 feature-registry.yml 未随 skills/ 改动同步更新，导致 CI Feature Registry 同步检查失败。

## 下次预防

- [ ] 每次改 Stop Hook 协议时，在同一 PR 内同步更新 `tests/e2e/stop-hook-full-lifecycle.test.ts`（不能留 describe.skip）
- [ ] `lint-test-pairing` 应覆盖 `hooks/stop-dev.sh` → `tests/e2e/stop-hook-*.test.ts` 的配对检查
- [ ] 修改 `packages/engine/skills/` 下任何文件时，必须同步更新 `feature-registry.yml`（CI Feature Registry 同步检查会失败）
- [ ] verify_dev_complete 是 Stop Hook 核心，任何改动都应有对应 unit test 覆盖三守门（PR merged + Learning + cleanup）
