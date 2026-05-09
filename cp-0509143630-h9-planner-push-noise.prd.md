# PRD: H9 harness-planner SKILL push noise 静默

**Brain task**: 5fae603d-6f14-4f84-8838-5121a1b1dd97
**Spec**: docs/superpowers/specs/2026-05-09-h9-planner-push-noise-design.md
**Sprint**: langgraph-contract-enforcement / Stage 1

## 背景

planner 容器无 push creds。SKILL.md:151 `git push origin HEAD` 失败被 set -e 中断，Brain 把 planner 节点判为 fail，但 sprint-prd.md 已 commit 到共享 worktree，proposer 直接读文件即可。14h 5 次跑全被这条假错误误导。

## 修法

SKILL.md:151：`git push origin HEAD` → `git push origin HEAD 2>/dev/null || echo "[harness-planner] push skipped (no creds), commit retained on local branch"`。

push 失败 → echo fallback → 整体退出码 0 → SKILL 继续走完。

## 成功标准

- planner 容器 stdout 不再恒含 `fatal: could not read Username`
- planner 节点 status=success（不被 push 失败打挂）
- 有 creds 时 push 成功路径不变（fallback echo 不打）

## 不做

- 不引入 push creds
- 不改其他 SKILL push 行为
- 不重设计 sprint-prd.md 传递机制
