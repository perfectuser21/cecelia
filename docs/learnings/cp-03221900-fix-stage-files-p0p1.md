---
branch: cp-03221900-fix-stage-files-p0p1
date: 2026-03-22
task: /dev pipeline P0/P1 修复 — stage 步骤文件 + verify-step.sh
---

# Learning: /dev pipeline 步骤文件 P0/P1 修复

## 根本原因

1. **verify-step.sh Gate 1 硬编码 packages/engine**: 其他 packages 有改动时跳过 npm test，导致漏测。
2. **verify-step.sh Gate 2 只处理 [BEHAVIOR]**: [ARTIFACT]/[GATE] 类型 DoD 条目被静默跳过，验收不完整。
3. **02-code.md 节标题重复**: 2.3.2 和 2.3.5 都叫"本地 CI 镜像检查"，实际是两个不同内容，引起混淆。
4. **02-code.md 含 codex-test-gen 悬空引用**: Codex 已迁移到 Agent subagent 模式，旧引用成为死链接。

## 修复内容

1. **verify-step.sh Gate 1**: 改为动态检测变更的 packages，按 `packages/<name>/` 模式提取，对每个有 test script 的 package 运行 npm test
2. **verify-step.sh Gate 2**: 同时处理 `[BEHAVIOR]`/`[ARTIFACT]`/`[GATE]` 三种 DoD 类型
3. **02-code.md**: 去除重复的 2.3.5 标题（原 2.3.5 内容已在 2.3.6 正确命名为"推送前完整验证"）
4. **02-code.md**: 删除 codex-test-gen 悬空引用，改为"补充测试 subagent"
5. **01-spec.md, 04-ship.md, SKILL.md**: P1 修复（重试上限、brain_task_id 兼容、说明澄清）

## 下次预防

- [ ] DoD 类型新增（如 [PERF]）时，同步更新 verify-step.sh Gate 2 类型列表
- [ ] 步骤文件节标题应唯一可区分，禁止相同名称出现在不同编号的节中
- [ ] 删除旧工具引用时，同步更新所有 changelog/注释中的提及
<!-- ci trigger -->
