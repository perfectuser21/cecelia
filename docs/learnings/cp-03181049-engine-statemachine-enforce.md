# Learning: Engine 状态机代码层强制（Step 验证门禁）

**Branch**: cp-03181049-engine-statemachine-enforce
**Date**: 2026-03-18

---

### 根本原因

/dev Verifier Subagent 状态机从 PR #962 起只存在于 `02-code.md` 提示词里，从未在代码（Shell 脚本）层实现。

具体表现：
- `devloop-check.sh` 只检查 Step 10/11（PR 创建、CI 通过、Learning），对 Step 1-9 完全盲目
- AI 可以自报 `step_2_code: done` 而不接受任何脚本验证
- `branch-protect.sh` 的 PreToolUse Hook 拦截了写操作，但对 `.dev-mode` 文件没有任何业务逻辑验证
- 工程师们误以为 PR #962/#967 实现了状态机，实际上那两个 PR 只改了提示词（SKILL.md）

### 下次预防

- [ ] 新增"状态机强制"类功能时，必须分清两层：
  - **提示词层**（02-code.md）：AI 看到但可以忽略
  - **代码层**（branch-protect.sh / stop.sh）：Shell 强制，AI 无法绕过
  - 只有代码层才是真正的强制，提示词层只是建议
- [ ] `branch-protect.sh` 版本号规则：每次加新拦截逻辑时升 v 号并在顶部注释说明
- [ ] DoD Test 字段不能用 `echo exit:$?` 格式，CI check-dod-mapping.cjs 会拒绝含 `echo` 的 `manual:` 命令；改用 `bash -c "... 2>/dev/null"` 或 `node -e "..."` 形式
- [ ] `verify-step.sh` 内部不能用 `grep -c ... || echo 0` 模式（与 `set -euo pipefail` 不兼容），改用 `grep -q` 或 `if grep -q ... then` 形式
