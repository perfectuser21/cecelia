---
id: learning-cp-03140812-branch-date-warn-cleanup-fix
version: 1.0.0
created: 2026-03-14
updated: 2026-03-14
branch: cp-03140812-branch-date-warn-cleanup-fix
pr: "936"
changelog:
  - 1.0.0: 初始版本
---

# Learning - branch-protect 分支日期警告 + cleanup.sh step_* 非阻塞（2026-03-14）

**Branch**: cp-03140812-branch-date-warn-cleanup-fix
**PR**: #936

### 根本原因

两个独立问题：

1. `branch-protect.sh` 只用正则验证 `cp-YYYYMMDD-*` 格式，但从未验证日期值是否合理。AI 在长任务后重新开始时可能复用旧日期，无任何提示。

2. `devloop-check.sh` 已升级为检查实际 PR/CI 状态，`step_*` flag 降级为纯展示标记。但 `cleanup.sh` 的 step 7.6 仍依赖这些 flag 做流程控制，导致合法清理操作被 FAILED 计数阻塞。

### 下次预防

- [ ] DoD Test 字段禁止使用 `echo` 命令（CI 判定为假测试）。PR 配置类条件需用 `grep -c '[CONFIG]' .prd-*.md` 间接验证
- [ ] Learning 文件必须包含 `### 根本原因` 和 `### 下次预防`（含 `- [ ]` checkbox），否则 CI Learning Format Gate 失败
- [ ] macOS/Linux 日期命令差异：`date -v-2d`（BSD）和 `date -d "2 days ago"`（GNU）需用 `||` 链接并对结果做非空检查
- [ ] 修改 step_* 相关逻辑时，检查所有依赖 step_* 做流程控制的脚本（当前只有 cleanup.sh），避免已过时的强制门禁影响正常流程
