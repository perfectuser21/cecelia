# Learning: Stop Hook Ralph 模式测试补全 (cp-0504200437)

**PR**: #2754
**分支**: cp-0504200437-ralph-tests
**合并时间**: 2026-05-04

## 背景

Stop Hook v19.0.0 引入 Ralph Loop 模式后，现有 E2E 测试仍基于旧协议写法，未覆盖 Ralph 特有的三个阶段（Phase A 完成路径 / Phase B verify_dev_complete / Phase C 真环境 smoke）。

## 做了什么

- `docs/superpowers/specs/2026-05-04-ralph-tests-design.md`：Phase A/B/C 完整测试规格（132 行）
- `packages/engine/tests/e2e/stop-hook-full-lifecycle.test.ts`：Phase A 重写 12 场景 E2E，适配 Ralph 协议，重点覆盖完成路径
- Phase B `verify_dev_complete` 10 case unit test
- Phase C `ralph-loop-smoke.sh` 端到端真环境验证
- 四层测试金字塔全覆盖

### 根本原因

Ralph Loop 模式（Stop Hook v19.0.0）改变了完成路径的状态机（cwd-as-key + verify_dev_complete），但测试规格未同步更新，导致新模式缺乏测试覆盖，回归风险高。

### 下次预防

- [ ] 每次改 Stop Hook 协议时，在同一 PR 内同步更新 `tests/e2e/stop-hook-full-lifecycle.test.ts`
- [ ] `lint-test-pairing` 应覆盖 `hooks/stop-dev.sh` → `tests/e2e/stop-hook-*.test.ts` 的配对检查
- [ ] 新模式上线前，Phase C smoke 脚本必须在真环境跑通后才能合并
