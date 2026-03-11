---
id: learning-ci-fix-three-gates
version: 1.0.0
created: 2026-03-11
updated: 2026-03-11
changelog:
  - 1.0.0: 初始版本
---

# Learning: CI 三处门禁漏洞修复

## 背景

本次 PR 修复了三处 CI 配置漏洞：
1. `ci-l3-code.yml` l3-passed gate 对 `workflows-l3` 的 skipped 豁免
2. `ci-l4-runtime.yml` 将 DEFINITION.md 改动错误地触发 L4 集成测试
3. `ci-l2-consistency.yml` Impact Check 路径缺少 devgate 脚本目录

### 根本原因

- **漏洞1**：l3-passed gate 其他所有 job 检查均已移除 skipped 豁免，唯独 workflows-l3 遗留了 `|| skipped`，导致 workflows-l3 被 skipped 时 gate 仍然通过，CI 严格性不一致
- **漏洞2**：DEFINITION.md 是文档文件，其改动不应触发需要 PostgreSQL 的 L4 集成测试，但 changes 检测的 grep 模式误将其包含，导致纯文档 PR 触发重量级测试
- **漏洞3**：`devgate/` 目录下的脚本是 engine core capability，但 Impact Check 的 CORE_PATHS 只列了 hooks/、skills/ 和 qa-with-gate.sh，devgate 脚本改动不会触发 feature-registry.yml 更新检查

### 下次预防

- [ ] 添加新的 gate job 时，检查 l3-passed/l4-passed 等汇总 gate 是否同步移除 skipped 豁免
- [ ] L4/L3 等重量级测试的触发条件应只包含 **代码文件**，文档（.md）和版本标记文件（.brain-versions）中，.brain-versions 是代码标记（版本号），DEFINITION.md 是文档（应移除）
- [ ] 修改 CORE_PATHS 时，对照 `packages/engine/scripts/` 目录列表检查是否遗漏重要脚本目录
- [ ] PRD 成功标准必须用 `## 成功标准` 二级标题，不能用粗体 `**成功标准**:`（check-prd.sh 按标题匹配）
- [ ] Learning 文件必须在第一次 push **前**写好并加入 commit，否则 Learning Format Gate 在 CI 第一次运行时就失败
