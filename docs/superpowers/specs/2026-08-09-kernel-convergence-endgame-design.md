# 设计：kernel 收敛终局修理（投影器分支死结 + 账号解析 + claude 单链挂载）

任务：aae92bfc ｜ 决策：de28e21f ｜ PrepPRD：docs/superpowers/specs/2026-08-09-kernel-convergence-endgame-prep-prd.md
案卷：run b4ac3396（generator 修好 CI 全绿但 PR 被拒收→no_progress 死循环）/ run c06b79af（account=null 零探针）/ attempt d80312c0（claude Not logged in）

## F1 投影器分支验证容错（harness-callback.js）

现状：`branchMatches = expectedBranch ? headRef === expectedBranch : headRef.includes(taskShort)`。
服务端 workspace 分支 `cp-fleet-generator-<attempt8>` 与 generator SKILL 惯例分支 `cp-<MMDDHHNN>-<task8>` 必然不等 → 合法 PR 永远 branch_mismatch。

改法：`branchMatches = headRef === expectedBranch || headRef.toLowerCase().includes(taskShort)`。
安全性论证：taskShort 包含匹配与"无 expectedBranch 时"的既有放行条件等强（证明 PR 归属本 task）；repo 校验、head_sha 解析、frozen lineage 校验全部保持不动。frozen_baseline 场景（多候选隔离）依旧走 lineage 验证兜底。

## F2 dispatcher 账号展开（dispatcher.js）

现状：preferredTarget.account = roleAssignment.account ?? payload.executor_account ?? null；null 不在 VERIFIED_TARGETS → isVerifiedExecutionTarget 直接跳过 → 零探针 exhausted。

改法：构造完 preferredTarget/candidateTargets 后增加展开步——凡候选 account 为 null/undefined，按 (provider, machine) 从 `listVerifiedExecutionTargets()` 展开为具体账号候选（保持白名单顺序：claude→account1,account2；codex→team1..5；grok→grok），去重后替换原候选；显式指定 account 的行为完全不变。preferred 取展开后的第一个。

## F3 fleet claude 单链挂载（worker 侧脚本，Brain/镜像零改动）

现状：remote-bridge 只为 codex 签发凭据 envelope；attempt-runner 只为 codex 建 FIFO；claude 容器无任何凭据来源 → "Not logged in"。
**否决 broker loader 方案**：给 claude 走 envelope=复制凭据快照=同账号多 OAuth 链互踢，正是 #4720 根除掉的病。

改法（对齐 #4720 单链决策与 relay 先例）：
- fleet-worker.cjs：prepare 请求 target.provider==='claude' 时，由 `target.account`（校验 `^account[1-9]$`）解析宿主账号目录 `<accountsRoot>/.claude-account<N>`；accountsRoot 取 `CECELIA_ORBSTACK_HOME`（installer 渲染进 plist 的 administrator home）。目录不存在 → 明确拒绝 `claude_account_home_unavailable`（fail loud，不静默）。
- attempt-runner.cjs：新增输入 `claudeConfigMount:{source}`（canonical 路径校验，仅 provider===claude 且非 evaluator 时接受），docker create 增加 `--mount type=bind,src=<source>,dst=/host-claude-config`（**rw**，凭据软链写回需要）。
- entrypoint（镜像 08c904ff 内现成逻辑）自动完成 复制副本+.credentials.json 软链单链，无需镜像改动。
- 安全面：claude 目标经 VERIFIED_TARGETS 已限 us-mac-m4；其它机器目录不存在即拒。

## 测试策略

- unit（vitest，先红后绿）：
  - harness-attempt-callback.test.js：headRef=惯例分支≠expectedBranch 但含 taskShort → verified；含无关分支名 → 仍 branch_mismatch
  - dispatcher.test.js（或 capability-gate.test.js 既有模式）：account=null 的 claude/codex preferred 展开出白名单账号候选；显式 account 不变
- unit（shell/cjs，先红后绿）：fleet-worker.test.js / attempt-runner.test.cjs：claude prepare 生成 claudeConfigMount 且 docker args 含 /host-claude-config rw 挂载；目录缺失拒绝；codex 路径回归不变
- 回归：orchestrator vitest 全套 + fleet-worker shell 全套
- E2E（合并后）：rollout us-mac 更新 worker → 重跑 kernel 验证（先 codex 后 claude），run 推进过 generator 且 PR verified

## 不做
- 不动 credential-broker.js / credential-envelope.cjs（codex 链现状正确）
- 不重建 runner 镜像（entrypoint 逻辑已在 canonical 08c904ff 内）
- no_progress 守卫本体不改（F1 断根后该场景消失；守卫防的是真无进展，保留）
- check-test-coverage.cjs 引号截断 bug 属 engine 包，另立任务（本 PR 不跨包）
