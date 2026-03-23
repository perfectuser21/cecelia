# Learning: 02-code.md 本地测试改为精准测试

**Branch**: cp-03231606-targeted-local-test
**Date**: 2026-03-23

## 变更摘要

将 `packages/engine/skills/dev/steps/02-code.md` 的两处全量 `npm test` 合并为一处精准测试（`vitest run <changed-files>`），防止 Mac mini 本地 OOM 崩溃。

### 根本原因

Brain 派发的 dev 任务在本地跑全量 `npm test`（100+ 个测试），导致 Mac mini 内存不足（OOM）崩溃重启。传统做法是本地只跑与改动相关的测试文件，全量回归交给 CI（GitHub Actions ubuntu-latest）。

### 下次预防

- [ ] 新增 dev skill 步骤中的测试命令时，优先考虑精准测试而非全量测试
- [ ] 全量回归测试仅在 CI 环境（ubuntu-latest）运行，避免本地 OOM
- [ ] verify-step.sh Gate 1 已有精准测试机制，不要重复全量

## 附：测试 cwd 隔离教训

`check-dod-mapping.cjs` Phase 3 traceback 检查通过 `process.cwd()` 向上找 `.git` 确定 `projectRoot`，再读 `<projectRoot>/.prd.md`。当测试用 `cwd: PROJECT_ROOT`（`packages/engine`）运行时，会找到 worktree 根目录的 `.prd.md`（另一个任务的 PRD），导致 traceback 误判。

修复：将 `should accept valid contract IDs` 测试的 `cwd` 改为 `TEST_DIR`，后者有独立的 `.git`，`projectRoot` 不会泄漏到 worktree 根目录。
