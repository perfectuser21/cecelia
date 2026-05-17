# Learning: Stop Hook 跨 session orphan 隔离不对称

## 问题现象

headless / nested Claude Code 环境（`CLAUDE_SESSION_ID` 为空）下，只要本机另有一个 Brain 派发的 autonomous /dev 活跃 worktree（含自己的 `session_id`），主 session 的 Stop Hook 就会反复 block 退出，报 "dev-lock 丢失但发现未完成 session（分支: cp-...）"。本次实测 30+ 次 block。

## 根本原因

`packages/engine/hooks/stop-dev.sh:194` 的跨 session 隔离判断是一条**不对称**的"与"逻辑：

```bash
if [[ -n "$_current_sid" && -n "$_orphan_sid" && "$_current_sid" != "$_orphan_sid" ]]; then
    continue   # skip orphan, not mine
fi
```

它要求 current_sid 和 orphan_sid 同时非空才跳过。当 current_sid 空时，该条件恒为 false —— 即使 orphan 明明带了自己的 session_id，也会被当作"自己的孤儿"并触发 block。

设计 intent 是"两侧都有 sid → 用 sid 判别"，但漏了"只有一侧有 sid"的情况。orphan_sid 非空本身就是"属于别人"的充分证据，不应该要求 current_sid 也有值。

同一块还有个孪生 bug：line 53 的 self-heal 整个代码块用 `if [[ -n "${CLAUDE_SESSION_ID:-}" ]]` 门控，current_sid 空时直接跳过自愈路径 —— 留给后续 PR 修。

## 修复

- 条件改为 `if [[ -n "$_orphan_sid" && "$_orphan_sid" != "$_current_sid" ]]`
- orphan 有 sid 且不等于 current_sid（当 current_sid 空时，任何 orphan_sid 都 "不等于" 空串）即 skip
- 补 3 个 vitest 覆盖三态：current 空/orphan 有 sid、current 有/orphan 有不同 sid、两边都空（保守 block）
- Engine 版本 14.14.0 → 14.14.1（fix 级 bump，不动主版本）

## 下次预防

- [ ] **对称性自检**：涉及跨主体隔离的布尔判断，列"真值表"逐格走一遍，不能只覆盖 happy path
- [ ] **hook 测试要用真实 worktree**：`_session_matches` 的第三分支会在 lock_tty="not a tty" 或 cur_tty/cur_session 都空时走 branch fallback；如果测试用 `git checkout -b` 让 cur_branch == lock_branch，就无法触发 orphan 路径。必须用 `git worktree add` 把 peer 放到独立目录并从主目录跑 hook
- [ ] **stderr 合流**：hook 的 skip 日志走 `>&2`，execSync 默认只捕 stdout；测试命令必须加 `2>&1` 再断言日志
- [ ] **self-heal 同一代码路径 line 53 的 `-n CLAUDE_SESSION_ID` 门控也得放开**：当 dev-mode 里的 `owner_session` 与当前 session 匹配（即使 current sid 空），也应允许自愈 —— 留 follow-up PR
