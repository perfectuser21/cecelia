# Learning: Gate 状态防伪 — seal 文件机制

## 根本原因

spec_review_status 和 code_review_gate_status 可被主 AI 直接写入 .dev-mode，
完全绕过 subagent 审查流程。bash-guard 和 branch-protect 仅验证 step_N: done 状态，
未对 gate status 做任何机械验证。devloop-check 的"不存在 → pass-through"语义
无法区分"subagent 尚未运行"和"subagent 已通过"。

## 修复方案

三层纵深防御（seal 文件机制）：
1. bash-guard.sh 规则 5b：拦截 Bash 工具写入 gate status（无 seal 文件时 exit 2）
2. branch-protect.sh：拦截 Write/Edit 工具写入 gate status（无 seal 文件时 exit 2）
3. devloop-check.sh 条件 1.5/2.5：自认证检测（有 pass 但无 seal → blocked）

subagent 负责写入 seal 文件（.dev-gate-spec.<branch> / .dev-gate-crg.<branch>），
主 AI 只能在 seal 文件存在且 verdict=PASS 后才能标记 gate status。

## 下次预防

- [ ] spec_review / code_review_gate subagent prompt 必须包含 seal 文件写入指令
- [ ] 任何新 Gate 机制都应遵循同样的 seal 文件模式
- [ ] devloop-check.sh 新增任何状态字段时，考虑是否需要外部验证证据
