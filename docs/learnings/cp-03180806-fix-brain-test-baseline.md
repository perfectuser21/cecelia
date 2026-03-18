# Learning: fix-brain-test-baseline

**Branch**: cp-03180806-fix-brain-test-baseline
**Date**: 2026-03-18

## 根本原因

#1039 修复了 Brain L3 测试（startup-sync + blocks），但只改了测试代码，未同步更新 `packages/brain/ci/brain-test-baseline.txt`。该文件值仍为 `3`，等于 CI 容忍最多 3 个测试失败，造成虚假宽松。

并行 agent 的孪生 PR #1042 包含了 baseline 修复，但因 #1039 先合入而变成僵尸 PR，导致 baseline 修复一直悬空。

## 下次预防

- [ ] 修复测试时，同步检查 `packages/brain/ci/brain-test-baseline.txt` 是否需要更新
- [ ] 关闭孪生僵尸 PR 时，检查是否有遗漏的差异点（如本次的 baseline.txt）未被主线覆盖
- [ ] arch-review 审计僵尸 PR 时，应比对 diff 而不只看文件列表
