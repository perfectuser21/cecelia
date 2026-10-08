---
task_id: 9a34cd00-1c43-4847-b455-2f90f3809083
step: spec
upstream: ["01-intent.md#I-1", "01-intent.md#I-2", "01-intent.md#I-3", "01-intent.md#I-4", "01-intent.md#I-5", "01-intent.md#I-6"]
---
# 实现规格：spec_review 活动

路径均相对 `packages/brain/scripts/coding-workflow/`（下称 CW）。本步不改 `contract.json`。

### S-1 抽出 02 自检到 lib，spec 活动行为不变
对应：I-3（改写后自检与 spec 活动同规则）、I-6

改动文件：
- 新增 `CW/lib/spec-check.mjs`：导出 `SPEC_FILE = '02-spec.md'`、`INTENT_FILE = '01-intent.md'`、`specErrors(text, taskId, intentIds)`（原 `activities/spec.mjs` 中的实现原样迁移：`reportErrors(..., { step: 'spec', coversFile: INTENT_FILE, ids })` + 正文无 `### S-n` 时追加 `spec_ids_missing`）、`specIds(text)`（返回 02 正文中按顺序出现的 `S-n` 锚点，复用 `parseFrontmatter` + `extractAnchors`）。
- 修改 `CW/activities/spec.mjs`：删除本地 `specErrors`/常量，改为从 `../lib/spec-check.mjs` 导入，其余逻辑不变。

验证：
- `cd packages/brain && npx vitest run scripts/coding-workflow/__tests__/spec.test.mjs` 全部通过（输出、reason_code 与重构前一致）。

### S-2 评审 prompt 与改写 prompt
对应：I-1、I-3

改动文件：
- 新增 `CW/prompts/spec-review.md`，机器可读行（每行 `KEY: {{KEY}}`，原样保留）：`ROLE: spec_review`、`TASK_ID`、`INTENT_PATH`、`SPEC_PATH`、`REVIEW_PATH`、`SPEC_IDS`（逗号分隔）。只给 01/02 路径与输出路径，不附任何 spec 会话上下文。要求逐条检查：
  1. 每条 I-n 是否有 S-n 给出能真实运行的验证方式（具体命令/断言，不是"测试通过"空话）；
  2. 规格是否缩小或改写了验收条目；
  3. 是否有歧义与遗漏的边界情况。
  输出格式按 `lib/review.mjs`：frontmatter（`task_id`、`step: spec_review`、`upstream` 单行 JSON 数组列出 02 全部 `02-spec.md#S-n`）；正文一行 `verdict: APPROVE|REVISE`；REVISE 时每个问题一节 `### R-n`，首行 `针对: <S-n/I-n 列表>`，下接非空问题描述。约束：只写 REVIEW_PATH，不改 01/02，不 commit/push。
- 新增 `CW/prompts/spec-revise.md`，机器可读行：`ROLE: spec_revise`、`TASK_ID`、`INTENT_PATH`、`SPEC_PATH`、`REVIEW_PATH`、`INTENT_IDS`。要求按 REVIEW_PATH 中每个 `R-n` 修改 SPEC_PATH；保持 02 格式（frontmatter `step: spec`、upstream 覆盖全部 I-n、`### S-n` 标题）；不得修改 INTENT_PATH 与 REVIEW_PATH；只改 SPEC_PATH；不 commit/push。

验证：
- `grep -c '^ROLE: spec_review$' CW/prompts/spec-review.md` 为 1；`grep -c '^ROLE: spec_revise$' CW/prompts/spec-revise.md` 为 1。
- S-6 的测试经假 claude 按 `ROLE:` 行识别会话种类并能解析出上述各路径字段（ok 用例写出的 02-review.md 位于 `<sprint_dir>/02-review.md`）。

### S-3 spec-review 活动：评审会话与 APPROVE 出口
对应：I-1、I-2

改动文件：新增 `CW/activities/spec-review.mjs`（`runActivity` 包裹，风格同 `activities/spec.mjs`）。

行为：
- 入参校验：`validateBase(input)`、`intentIdsError(input.intent_ids)`（非法 → 同 spec 活动的 fatal）；02-spec.md 不存在 → fatal `spec_missing`。
- 每次评审会话：先 `fs.rmSync(<dir>/02-review.md, {force:true})`，`snapshotChanges` 取快照，用 `loadPrompt('spec-review', …)` 渲染，`runClaude({ args: ['-p', prompt, '--permission-mode', 'acceptEdits', '--disallowedTools', 'Bash'], cwd: worktree, timeoutMs, tag: 'spec_review', isolateRemote: true })`；每次都是新进程（全新会话，不带 `--resume/--continue`）。
- 超时：每个会话 `claudeTimeoutMs(input.budget, { envVar: 'CODING_WF_SPEC_REVIEW_TIMEOUT_MS', defaultMs: 600000 })`，再与 budget 剩余时间（`budget.max_duration_s*1000 - 15000 - 已耗时`，下限 1000ms）取小；无 budget 时只用默认/覆盖值。
- 会话结束依次检查：`claudeFailure(run)` → 越界写（S-5）→ 01 哈希（S-5）→ 02-review.md 存在且合格（S-4）。
- 解析：`parseReview(text, { specIds: specIds(02), intentIds })`。`verdict === 'APPROVE'` → 返回
  `{ status: 'completed', outputs: { review_file: '02-review.md', review_rounds: <第几次评审通过，从 1 计>, spec_sha256: sha256File(<dir>/02-spec.md) }, evidence: [...] }`。

验证（均在 S-6 测试中断言）：
- 一次通过：`result.status === 'completed'`，`outputs` 严格等于 `{ review_file: '02-review.md', review_rounds: 1, spec_sha256: <测试自算的 02 sha256> }`；stderr 中 `FAKE_ROLE: spec_review` 恰出现 1 次、`FAKE_ROLE: spec_revise` 0 次。
- stderr 含 `FAKE_ARGS: -p --permission-mode acceptEdits --disallowedTools Bash --model opus`，且 `FAKE_GH_CONFIG_DIR` 不为 `<unset>`（证明 isolateRemote 生效）。
- `<sprint_dir>/02-review.md` 的 frontmatter `step` 为 `spec_review`，upstream 覆盖 02 全部 S-n。

### S-4 REVISE 改写循环、轮数上限与评审文档格式校验
对应：I-3

改动文件：`CW/activities/spec-review.mjs`

行为：
- 评审格式校验：02-review.md 不存在，或 `reportErrors(text, { taskId, step: 'spec_review', coversFile: '02-spec.md', ids: specIds(02) })` 与 `parseReview(...).errors` 合并后非空 → `fail('retryable', 'review_invalid', { evidence: [{ review_errors: [...] }] })`。
- REVISE 且已改写次数 < 2：起改写会话（`loadPrompt('spec-revise', …)`，参数、isolateRemote、超时、越界/01 哈希检查同评审会话；不删 02）。改写后 02 不存在 → fatal `spec_missing`；`specErrors(02, taskId, intentIds)` 非空 → `fail('retryable', 'spec_invalid', { evidence: [{ spec_errors }] })`。通过后起新的评审会话（新进程）。
- 轮数：最多 2 次改写，即最多 3 次评审：评审1 REVISE → 改写1 → 评审2 REVISE → 改写2 → 评审3 仍 REVISE → `fail('fatal', 'spec_review_unresolved', { evidence: [{ unresolved_issues: [<最后一次评审的全部 R-n id>] }] })`。
- 改写后通过时 `review_rounds` 为通过那次评审的序号（改写一轮后通过 = 2），`spec_sha256` 为改写后 02 的当前哈希。

验证（S-6 测试）：
- 改写一轮后通过：`status === 'completed'`，`outputs.review_rounds === 2`，02-spec.md 内容与运行前不同，`outputs.spec_sha256 === sha256(当前 02-spec.md)` 且 ≠ 运行前哈希；stderr 中 `FAKE_ROLE: spec_review` 2 次、`FAKE_ROLE: spec_revise` 1 次。
- 始终 REVISE：`failure_class === 'fatal'`，`reason_code === 'spec_review_unresolved'`，`evidence` 等于 `[{ unresolved_issues: ['R-1'] }]`；stderr 中 `FAKE_ROLE: spec_review` 3 次、`FAKE_ROLE: spec_revise` 2 次。
- 评审文档无 verdict 行：`failure_class === 'retryable'`，`reason_code === 'review_invalid'`，`JSON.stringify(evidence)` 含 `verdict_missing`。

### S-5 防线：01 被改与越界写
对应：I-4

改动文件：`CW/activities/spec-review.mjs`

行为：
- 启动任何会话前、以及每个会话结束后，调用 `chainTamperFailure(dir, { intent_sha256: input.intent_sha256 })`（只传 intent 哈希；02 在改写中合法变化，不纳入）→ 不一致返回 fatal `chain_tampered`，evidence `[{ tampered_files: ['01-intent.md'] }]`。启动前已不一致时不启动 claude。
- 每个评审/改写会话前 `snapshotChanges(worktree)`，会话后 `outOfScopeChanges(worktree, sprintDir, before, 'spec_review')` 非空 → `fail('fatal', 'spec_review_out_of_scope_write', { evidence: [{ out_of_scope_changes: [...] }] })`。越界检查先于 01 哈希检查与产物检查。

验证（S-6 测试）：
- 评审会话追加改写 01（`FAKE_TAMPER_FILE=sprints/s1/01-intent.md`，入参带运行前 01 的 sha256）→ `exitCode === 2`，`failure_class === 'fatal'`，`reason_code === 'chain_tampered'`，`evidence` 等于 `[{ tampered_files: ['01-intent.md'] }]`。
- 入参 `intent_sha256` 与现存 01 不符 → `chain_tampered`，且 stderr 不含 `FAKE_CWD`（未启动 claude）。
- 评审会话在 worktree 根写 `stray.txt` → `reason_code === 'spec_review_out_of_scope_write'`，`evidence` 等于 `[{ out_of_scope_changes: ['stray.txt'] }]`。

### S-6 假 claude 新增模式与 spec-review 测试
对应：I-5

改动文件：
- 修改 `CW/__tests__/fixtures/fake-claude.mjs`（只增不改既有模式行为）：
  - 按 prompt 中 `^ROLE: spec_review$` / `^ROLE: spec_revise$` 识别步骤为 `REVIEW` / `REVISE`，可用 `FAKE_CLAUDE_MODE_REVIEW` / `FAKE_CLAUDE_MODE_REVISE` 单独指定该步模式；输出 `FAKE_ROLE: <spec_review|spec_revise>` 一行供计数。
  - 评审模式（写 `REVIEW_PATH`，frontmatter `step: spec_review`、upstream 为 `SPEC_IDS` 全部 `02-spec.md#S-n`）：`review-approve`（`verdict: APPROVE`）；`review-revise`（始终 `verdict: REVISE` + `### R-1` / `针对: S-1` / 问题描述）；`review-until-fixed`（02 含标记 `已按评审修改` 时 APPROVE，否则同 review-revise）；`review-badformat`（无 verdict 行）；`review-outside`（同 review-approve，另在 worktree 根写 `stray.txt`）。
  - 改写模式：`revise-ok`（读 `SPEC_PATH`，保留 frontmatter 与全部 S-n，在末尾 S-n 正文追加一行 `已按评审修改 R-1`）。
  - 头部注释补充新模式说明；`FAKE_TAMPER_FILE` 等越轨副作用对新模式同样生效。
- 新增 `CW/__tests__/spec-review.test.mjs`：结构仿 `spec.test.mjs`（`runActivityProcess` 子进程运行 `activities/spec-review.mjs`，`CODING_WF_CLAUDE_BIN` 指向假 claude，`gitPlain('init')` 临时 worktree）；`beforeEach` 在 `sprints/s1/` 预置合法 01-intent.md（I-1、I-2）与 02-spec.md（S-1、S-2，upstream 覆盖 I-1、I-2），入参带 `intent_sha256`。用例至少包含：
  1. 一次通过（S-3 的断言）；
  2. 改写一轮后通过（REVIEW=`review-until-fixed`，REVISE=`revise-ok`；S-4 断言）；
  3. 两轮改写后仍 REVISE → `spec_review_unresolved`（REVIEW=`review-revise`，REVISE=`revise-ok`；S-4 断言）；
  4. 会话改 01 → `chain_tampered`（S-5 断言）；
  5. 越界写 → `spec_review_out_of_scope_write`（REVIEW=`review-outside`；S-5 断言）；
  6. 评审文档格式不合格 → retryable `review_invalid`（REVIEW=`review-badformat`）。

验证：
- `cd packages/brain && npx vitest run scripts/coding-workflow/__tests__/spec-review.test.mjs` 全部通过，且上述 6 个用例均出现在输出中、无 skip。

### S-7 coding-workflow 全量回归
对应：I-6

改动文件：无新增（覆盖 S-1 ~ S-6 的全部改动；`contract.json` 与 `__tests__/contract.test.mjs` 不动）。

验证：
- `cd packages/brain && npx vitest run scripts/coding-workflow` 全部通过（含 spec、build、verify、claude、review、contract 及 runner 子目录测试），无失败用例。
