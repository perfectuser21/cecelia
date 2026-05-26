## 移除 harness fix-round 上限（2026-05-18）

### 根本原因

`harness-initiative.graph.js` 中设有 `MAX_FIX_ROUNDS = 3` 常量，被两处逻辑引用：

1. `finalEvaluateDispatchNode`（active 路径）：Final E2E FAIL 且 `fix_count >= 3` → 自动终止，写 error
2. `routeAfterEvaluate`（dead code）：per-task FAIL 且 `fix_count >= 3` → 返回 `terminal_fail`

设计初衷是防止无限循环，但 GAN 对抗轮次本身无上限（有意设计），fix-round 加硬上限是多余且有害的约束——agent 一定能修好，人为截断只会浪费 pipeline。

### 下次预防

- [ ] fix-round 上限类约束在 spec 设计阶段必须明确标注为"临时/可移除"，否则容易被误认为是系统保护
- [ ] integration test（`harness-interrupt-resume.test.ts`）中有 `fix_count >= MAX` 期望 error 的测试，改代码时要同步找所有期望旧终止行为的测试一并更新
- [ ] worktree 切换时注意 subagent 可能意外调用 `worktree-manage.sh` 创建新 worktree，导致当前 worktree 分支漂移——跑 subagent 前锁定 worktree 路径
- [ ] `cp-0518213639-*` 孤儿分支需事后清理
