---
id: learning-cp-03301433-pipeline-security-fix
created: 2026-03-30
branch: cp-03301433-pipeline-security-fix
task_id: b18a39d9-5a76-4fc0-942c-677b06b6c325
---

# Learning: Pipeline Seal 验证安全加固

## 根本原因

devloop-check.sh 对 seal 文件的验证只检查文件存在性（`[[ -f "$seal_file" ]]`），
未验证内容的有效性，导致 AI 可以通过 `echo '{}' > .dev-gate-spec.branch` 伪造通过。
同时 stop-dev.sh 的 fallback 路径在 devloop-check.sh 不可用时降级到缺少 seal 验证的旧逻辑，
形成双重绕过面。

## 下次预防

- [ ] 凡是安全门禁的文件存在性检查，必须同时验证关键字段内容（verdict/status/result）
- [ ] fail-closed 原则：关键依赖加载失败时 exit 2 而不是降级到旧路径
- [ ] 锁机制缺失时必须硬错误（return 1），禁止静默成功（return 0）
- [ ] 每次状态检查到执行操作之间存在窗口期，高风险操作前应重新确认状态

## 修复概述

1. **devloop-check.sh spec seal 验证**：添加 verdict 字段大小写不敏感比较（`tr '[:upper:]' '[:lower:]'`），非 pass 则 blocked；添加 divergence_count 字段存在性验证（`// empty` + 空值检查）
2. **devloop-check.sh code_review_gate seal 验证**：同 spec seal，添加 verdict 内容验证
3. **stop-dev.sh fallback 路径**：else 分支改为输出 FATAL 错误并 exit 2，旧内联逻辑保留为注释（fail-closed）
4. **lock-utils.sh flock 不可用**：`return 0` 改为输出 FATAL 错误 + `return 1`
5. **devloop-check.sh PR 合并前检查**：在 `gh pr merge` 前增加 `gh pr view --json mergeable,state` 二次确认，CONFLICTING 或非 OPEN 状态时 return 2
