# Learning: Phase 1 模式统一 — 删除 Standard + 孤儿 PR 兜底 Worker

### 根本原因

PR #2406 / #2408 两次 Stop Hook 过早 exit 的根因不是 agent 记性问题，而是 `/dev`
skill 有 **3 条分叉路径**（Standard / Autonomous / Harness）。每个 step 开头都要读
`.dev-mode` + task payload 再 switch-case 决定走哪条。`.dev-mode` 中的
`autonomous_mode: true/false` flag 和 payload 的 flag 不一致、hook 读错模式、standard
分支的"主 agent 直接写代码"与 autonomous 的"Subagent 三角色"行为差异大——所有这些
都让 Stop Hook 在 "未完成状态" 判断上容易出错。

一个真实的例子：`02-code.md` 用 `grep autonomous_mode:` 判断走 Section 2 还是 Section 3，
漏写 flag 就默认走 Section 3（standard），但 Section 3 不跑 subagent 验证环节，
导致 `step_2_code: done` 被过早写入，Stop Hook 看到"标志已 done"就 exit 0，整个
pipeline 中断。

### 下次预防

- [x] `SKILL.md` 删除 "流程（标准模式）" 章节；`autonomous` 为唯一默认流程。
- [x] `01-spec.md` / `02-code.md` 只保留两条分支：`harness_mode = true` vs 默认。
- [x] `.dev-mode` 不再写 `autonomous_mode` 字段。旧字段被 Stop Hook 忽略（向后兼容）。
- [x] Brain 加 `orphan-pr-worker`：扫 `cp-*` open > 2h 无 in_progress task 的 PR，CI
      绿 → 自动 merge；CI 失败 → 打 `needs-attention` 标签。这是**兜底**——即使单
      个 agent session 死了，PR 也不会永远卡 open。
- [x] `harness_mode` 保留（Phase 2 再把 Harness Evaluator 降级为 PR gate）。

### 侧带发现

- GitHub PR 的 `statusCheckRollup` 同时包含 `CheckRun`（有 `status` + `conclusion`）
  和 `StatusContext`（有 `state`）两种格式。CI 状态聚合要同时识别这两个字段名。
- `pg` pool 的 `db.query` 返回 `{rowCount, rows}`；测试 mock 用 `{rowCount:0, rows:[]}` 表示
  无匹配。`typeof q.rowCount === 'number' ? q.rowCount : q.rows?.length` 兼容两种形态，
  避免对单一字段过度依赖（某些 pg 兼容库不填 `rowCount`）。
- 孤儿 PR 兜底要**按最小操作面设计**：只 merge / 只打 label，不写任何业务状态。
  错打 label（冪等重试）比错 merge（不可逆）便宜一个量级。故本 worker 的失败路径
  默认是 "skip + 记 error"，不是 "升级/重试"。
- Read-only `/home/cecelia/.gitconfig` 环境下 `gh auth setup-git` 失败，但
  `git -c credential.helper='!gh auth git-credential' push` 可成功——per-command
  override 绕过 gitconfig 写入。
