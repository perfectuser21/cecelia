---
task_id: 7aebfb3c-4349-415b-b535-fd474d26fdb3
step: build
upstream: ["02-spec.md#S-1", "02-spec.md#S-2", "02-spec.md#S-3", "02-spec.md#S-4"]
---
# 构建总结

路径均相对 `packages/brain/scripts/coding-workflow/`。

### B-1
- 对应：S-2
- 改动文件：`lib/md-chain.mjs`（CHAIN 在 02-spec.md 与 03-build.md 之间插入 `{ file: '02-review.md', step: 'spec_review', covers: '02-spec.md' }`，DEFAULT_FILES 不变）、`activities/chain-check.mjs`（CONTEXT_KEYS 在 spec_file 后加 review_file）
- 新增测试：
  - `__tests__/md-chain.test.mjs` 新 describe「md-chain 含 02-review」3 条：覆盖全部 S-n 无错误且 files 按链顺序；漏 S-2 报 `02-review.md_not_covered:S-2`；step 写错报 `step_mismatch:02-review.md`
  - `__tests__/chain-check.test.mjs` 2 条：带 review_file 合法链 completed，chain_files 为 `['01-intent.md','02-spec.md','02-review.md','03-build.md','04-evidence.md']`；02-review 漏覆盖 failed `md_chain_invalid`。原有用例（不带 review_file）未改动
- 测试命令：`cd packages/brain && npx vitest run scripts/coding-workflow/__tests__/md-chain.test.mjs scripts/coding-workflow/__tests__/chain-check.test.mjs`
  - 实现前：`Test Files 2 failed (2)`，`Tests 5 failed | 28 passed (33)`（5 条新用例失败）
  - 实现后：`Test Files 2 passed (2)`，`Tests 33 passed (33)`
- 提交 SHA：1e097bc59

### B-2
- 对应：S-1
- 改动文件：`contract.json`：新增 `spec_review` 活动（order 3，phase source，entry `activities/spec-review.mjs`，on_failure stop_run，max_attempts 1，budget 1800/30，未写 input/per_item）；failure 声明 retryable `claude_failed/claude_timeout/review_invalid/spec_invalid`，needs_human `claude_auth`，fatal `task_id_missing/sprint_dir_invalid/intent_ids_missing/intent_ids_invalid/chain_tampered/spec_missing/spec_review_out_of_scope_write/spec_review_unresolved`；build/verify/chain_check/publish/report 的 order 改为 4..8
- 新增测试：见 B-3（contract.test.mjs 的 EXPECTED/REPORTED 断言）
- 测试命令：`cd packages/brain && node -e "const c=require('./scripts/coding-workflow/contract.json');console.log(c.activities.sort((a,b)=>a.order-b.order).map(a=>a.key).join(','))"`
  - 输出：`intent,spec,spec_review,build,verify,chain_check,publish,report`
- 提交 SHA：c0ddb2c6e

### B-3
- 对应：S-3
- 改动文件：`__tests__/contract.test.mjs`（两处活动 key 列表改为 8 个；order 序列 `[1..8]`；EXPECTED 加 spec_review，后续 order +1；REPORTED 加 spec_review 条目）、`__tests__/e2e-contract.test.mjs`（ACTIVITY_KEYS 8 个；envFor 加 `FAKE_CLAUDE_MODE_REVIEW: 'review-approve'`；CHAIN_FILES 含 02-review.md；成功用例断言 8 个活动全部 completed、Brain 收到的 chain_files 等于新 CHAIN_FILES、PR 正文含 `- sprints/e2e/02-review.md`、origin 推送文件含 02-review.md；verify 失败用例活动序列改为 `['intent','spec','spec_review','build','verify','report']`）
- 测试命令：`cd packages/brain && npx vitest run scripts/coding-workflow/__tests__/contract.test.mjs scripts/coding-workflow/__tests__/e2e-contract.test.mjs`
  - 改 contract.json 前：`Test Files 2 failed (2)`，`Tests 13 failed | 31 passed (44)`
  - 改 contract.json 后：`Test Files 2 passed (2)`，`Tests 44 passed (44)`
- 提交 SHA：c0ddb2c6e（与 B-2 同一提交）

### B-4
- 对应：S-4
- 改动文件：`runner/__tests__/run-once.test.mjs`（第 185 行 `contract_activities` 断言按新链加入 spec_review）
- 新增测试：无（只修正既有断言）
- 测试命令：`cd packages/brain && npx vitest run scripts/coding-workflow src/__tests__/activity-contract-sync.test.js`
  - 修正前：`Test Files 1 failed | 31 passed (32)`，`Tests 1 failed | 583 passed (584)`（run-once 成功路径断言仍是七活动）
  - 修正后：`Test Files 32 passed (32)`，`Tests 584 passed (584)`，0 failed
- 提交 SHA：327874b30
