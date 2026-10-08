---
task_id: 9a34cd00-1c43-4847-b455-2f90f3809083
step: build
upstream: ["02-spec.md#S-1", "02-spec.md#S-2", "02-spec.md#S-3", "02-spec.md#S-4", "02-spec.md#S-5", "02-spec.md#S-6", "02-spec.md#S-7"]
---
# 构建记录：spec_review 活动

路径均相对 `packages/brain/scripts/coding-workflow/`（CW）。

### B-1
- 对应：S-1
- 改动文件：新增 `CW/lib/spec-check.mjs`（导出 `SPEC_FILE`、`INTENT_FILE`、`specErrors`、`specIds`）；`CW/activities/spec.mjs` 删除本地实现，改为从 lib 导入。
- 新增测试：`CW/__tests__/spec-check.test.mjs`（6 例：常量、合法 02、not_covered + spec_ids_missing、step_mismatch、specIds 顺序/过滤、无 frontmatter）。
- TDD：先运行确认失败——`Failed to load url ../lib/spec-check.mjs ... Does the file exist?`（Test Files 1 failed）。
- 测试命令：`cd packages/brain && npx vitest run scripts/coding-workflow/__tests__/spec-check.test.mjs scripts/coding-workflow/__tests__/spec.test.mjs`
- 输出摘要：`spec.test.mjs (42 tests) ✓`、`spec-check.test.mjs (6 tests) ✓`，`Tests 48 passed (48)`。
- 提交：9b005e431

### B-2
- 对应：S-2
- 改动文件：新增 `CW/prompts/spec-review.md`（机器可读行 ROLE/TASK_ID/INTENT_PATH/SPEC_PATH/REVIEW_PATH/SPEC_IDS；三项检查；frontmatter `step: spec_review` + verdict 行 + `### R-n`/`针对:` 格式；只写 REVIEW_PATH，不 commit/push）、`CW/prompts/spec-revise.md`（ROLE/TASK_ID/INTENT_PATH/SPEC_PATH/REVIEW_PATH/INTENT_IDS；按 R-n 改 02、保持 02 格式、只改 SPEC_PATH）。
- 新增测试：由 B-3 的 `spec-review.test.mjs` 经假 claude 按 `ROLE:` 行识别会话并解析路径字段覆盖（一次通过用例断言 `<sprint_dir>/02-review.md` 的 frontmatter）。
- 测试命令：`grep -c '^ROLE: spec_review$' prompts/spec-review.md; grep -c '^ROLE: spec_revise$' prompts/spec-revise.md`
- 输出摘要：`1` / `1`。
- 提交：7864e857b

### B-3
- 对应：S-3、S-4、S-5、S-6
- 改动文件：
  - 新增 `CW/activities/spec-review.mjs`：入参校验（validateBase / intentIdsError）→ 启动前 01 哈希检查 → 02 不存在 fatal `spec_missing`；循环中每次评审先删 02-review.md、快照、`loadPrompt('spec-review')`、`runClaude(... isolateRemote: true)`（每次新进程）；会话后依次 claudeFailure → 越界写 `spec_review_out_of_scope_write` → `chainTamperFailure(只传 intent_sha256)` → 评审文档校验（reportErrors + parseReview 合并，不合格 retryable `review_invalid`）；APPROVE 返回 `{review_file, review_rounds, spec_sha256}`；REVISE 且改写次数 < 2 起改写会话（同样检查），改写后 02 缺失 fatal `spec_missing`、`specErrors` 非空 retryable `spec_invalid`；第 3 次评审仍 REVISE → fatal `spec_review_unresolved`（evidence 列最后一次评审的 R-n）。超时 = `claudeTimeoutMs(budget, {CODING_WF_SPEC_REVIEW_TIMEOUT_MS, 600000})` 再与 budget 剩余（max_duration_s*1000 - 15000 - 已耗时，下限 1000ms）取小。
  - 修改 `CW/__tests__/fixtures/fake-claude.mjs`（只增）：按 `ROLE: spec_review|spec_revise` 识别 REVIEW/REVISE 步、支持 `FAKE_CLAUDE_MODE_REVIEW/REVISE`、输出 `FAKE_ROLE:` 行；新增 `review-approve / review-revise / review-until-fixed / review-badformat / review-outside`、`revise-ok`，另加 `revise-delete`（删 02，用于"改写后 02 缺失"用例，因 `nofile` 会在越轨副作用前退出）；头部注释已补充。
- 新增测试：`CW/__tests__/spec-review.test.mjs`（16 例）：一次通过（outputs 严格相等、FAKE_ROLE 计数 1/0、FAKE_ARGS 含 `--model opus`、FAKE_GH_CONFIG_DIR 非 `<unset>`、02-review.md frontmatter）；改写一轮后通过（rounds=2、哈希为改写后 02、计数 2/1）；两轮改写仍 REVISE（`spec_review_unresolved`、evidence `[{unresolved_issues:['R-1']}]`、计数 3/2）；评审会话改 01 → `chain_tampered`（evidence `[{tampered_files:['01-intent.md']}]`）；REVISE 评审改 01 不再起改写；入参哈希不符不启动 claude；越界写（evidence `[{out_of_scope_changes:['stray.txt']}]`）；无 verdict → retryable `review_invalid` 含 `verdict_missing`；未写评审文档；旧 02-review.md 残留；改写后 02 无 S-n → `spec_invalid`；改写删 02 → `spec_missing`；初始无 02；intent_ids 非法；认证失败；超时。
- TDD：先运行确认失败——活动文件不存在时 `Tests 16 failed (16)`。
- 测试命令：`cd packages/brain && npx vitest run scripts/coding-workflow/__tests__/spec-review.test.mjs --reporter=verbose`
- 输出摘要：16 个用例逐条 ✓（含规格要求的 6 个场景，无 skip），`Tests 16 passed (16)`。
- 提交：cf50fcead

### B-4
- 对应：S-7
- 改动文件：无新增（覆盖 B-1 ~ B-3；`contract.json` 与 `__tests__/contract.test.mjs` 未改动）。
- 测试命令：`cd packages/brain && npx vitest run scripts/coding-workflow`
- 输出摘要：`Test Files 31 passed (31)`、`Tests 563 passed (563)`，无失败用例。
- 提交：9b005e431、7864e857b、cf50fcead
