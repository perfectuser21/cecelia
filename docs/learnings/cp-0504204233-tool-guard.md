# Learning: PreToolUse 拦截 — 行为 bug 终结 (cp-0504204233)

**PR**: #2759
**分支**: cp-0504204233-tool-guard
**合并时间**: 2026-05-04

## 背景

Stop Hook 7 段重构（PR #2752）完成后，Alex 发现最深层 bug：assistant 可以主动调用 `ScheduleWakeup` 或 `Bash run_in_background:true` 让 turn 提前退出，stop hook 即使输出 `decision:block` 也无法阻止——因为 hook 只在 turn 退出时触发，而 turn 已经退出了。

## 做了什么

新增 `packages/engine/hooks/dev-mode-tool-guard.sh`，作为 PreToolUse hook，比 stop hook 更早触发：

- 检测 `.cecelia/dev-active-*.json` 存在（即在 /dev 流程中）
- tool=ScheduleWakeup → exit 2 + decision:block
- tool=Bash + input 含 `run_in_background:true` → exit 2 + decision:block

三层防御叠加：PreToolUse（本 PR）+ Stop Hook（#2752）+ CI 守护

## 根本原因

Stop Hook 是"事后拦截"——turn 结束后才触发。但 assistant 可以用 `ScheduleWakeup` 或 `run_in_background` 主动让 turn 退出，绕过 stop hook 的 block。机制的不对称性导致 stop hook 对这类退出无效。

根本修法：在工具调用前（PreToolUse）就阻断，让 assistant 在 /dev 流程中根本调不动这些"逃逸工具"。

## 下次预防

- [ ] 新增任何能让 turn 提前退出的工具时，检查是否需要在 `dev-mode-tool-guard.sh` 里加拦截
- [ ] Stop Hook 机制设计时，要考虑"事前拦截"和"事后拦截"两层：事后拦截无法阻止主动退出类工具
- [ ] `/dev` 流程中出现"明明 block 了但还是退出"的问题，优先排查 PreToolUse 层是否覆盖了该工具
