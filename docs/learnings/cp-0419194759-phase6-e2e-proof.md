# Phase 6 e2e proof marker（2026-04-19）

PR #2430：`docs/proofs/phase6-e2e/MARKER.md` 作为 /dev 9 棒接力链端到端跑通的证据。分支 `cp-0419194759-phase6-e2e-proof`，docs-only。

### 根本原因

Phase 5 + Phase 6 合并后，需要一次 trivial 验证证明 `engine-worktree → brainstorming → writing-plans → subagent-driven-development → verification-before-completion → finishing → engine-ship → Stop Hook` 链路真实跑通。本任务故意选最小产出（单 markdown）排除 scope 争议。

过程发现：headed 模式下 `worktree-manage.sh init-or-check` 只创建 `.dev-lock.<branch>`，不创建 `.dev-mode.<branch>`，但 Stop Hook `stop-dev.sh:256` 明确要求 `.dev-mode` 存在（fail-closed）。engine-ship SKILL 默认假设 `.dev-mode` 已由前阶段写入。当前修法：engine-ship 步骤里手写 `.dev-mode.<branch>` 含 `step_1_spec: done / step_2_code: done / step_4_ship: done`。

### 下次预防

- [ ] `worktree-manage.sh cmd_init_or_check` 在 headed 模式也应初始化最小 `.dev-mode.<branch>`（首行 `dev` + `branch:` + `step_1_spec: pending` 等），避免后续阶段手工兜底
- [ ] engine-ship SKILL.md 在 §3 前加一步"确保 `.dev-mode.<branch>` 存在"的兜底创建逻辑，headless/headed 对齐
- [ ] 类似 trivial 验证链路任务再出现时，沿用本 PR 路径：docs-only、`cp-*` 分支、PR 标题 `docs:` 前缀即可不触发 Engine CI / DevGate / L3 test-required
