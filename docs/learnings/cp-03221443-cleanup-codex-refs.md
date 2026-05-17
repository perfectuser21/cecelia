---
branch: cp-03221443-cleanup-codex-refs
task: 清理 pipeline 过时 Codex 引用 + 修复误导注释
date: 2026-03-22
---

## 总结

清理了 pipeline 文档中遗留的 Codex 异步协作时代的误导性引用，使文档与实际同步 subagent 行为保持一致。

### 根本原因

pipeline 从 Codex 异步派发模型迁移到本机 subagent 同步调用后，多处文档未同步更新：
1. `devloop-check.sh` 残留 "3次重审耗尽" 逻辑描述和 `runners/codex/runner.sh` 路径引用
2. `code-review-gate/SKILL.md` 描述触发时机为 "CI 通过后、PR 合并之前"（实际是 push 前 Stage 2）
3. `/dev SKILL.md` 仍引用 "查 Brain API"、"等 Codex" 的异步等待语义

这些过时描述不影响运行逻辑，但会误导阅读者对 pipeline 工作机制的理解，也会导致新的修改参照错误前提。

### 修复清单

- [x] `devloop-check.sh`：删除 "3次重审" 文字，替换 `runners/codex/runner.sh` 为实际机制说明
- [x] `code-review-gate/SKILL.md`：修正触发时机描述 + 删除 "Codex Gate 3/4" 旧编号引用
- [x] `/dev SKILL.md`：删除 "等 Codex" / "查 Brain API" 行，改为 "读 .dev-mode" / "subagent 同步审查"

### 下次预防

- [ ] 每次更改 pipeline 运行机制时，同步更新对应的 SKILL.md 和 devloop-check.sh 注释
- [ ] DoD 中对文档类改动使用 `! grep -q` 负向检查，确保过时文字已删除
- [ ] 深度诊断后统一建 cleanup task，避免误导性内容长期积累
