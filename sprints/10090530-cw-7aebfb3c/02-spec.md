---
task_id: 7aebfb3c-4349-415b-b535-fd474d26fdb3
step: spec
upstream: ["01-intent.md#I-1", "01-intent.md#I-2", "01-intent.md#I-3", "01-intent.md#I-4"]
---
# 实现规格：coding workflow 契约接入 spec_review

路径均相对 `packages/brain/scripts/coding-workflow/`，除非另行写明。`activities/spec-review.mjs` 已经实现，并且已有单测覆盖，本次不改它的逻辑。

### S-1
对应：I-1

修改文件：`contract.json`

- 在 spec 之后新增活动 `spec_review`：
  - `order: 3`
  - `runtime`：
    - `protocol: "json-stdio-v1"`
    - `phase: "source"`
    - `entry: "activities/spec-review.mjs"`
    - `on_failure: "stop_run"`
    - `max_attempts: 1`
  - `budget`：`max_duration_s: 1800`，`heartbeat_s: 30`
  - 不写 `input`，也不写 `per_item`
- 原来的 build、verify、chain_check、publish、report 的 order 依次改为 4、5、6、7、8。最终顺序是 intent、spec、spec_review、build、verify、chain_check、publish、report。
- `spec_review.failure` 声明 `spec-review.mjs` 实际会报出的全部 reason_code：
  - `empty_ok`：`[]`
  - `retryable`：`claude_failed`、`claude_timeout`、`review_invalid`、`spec_invalid`
  - `needs_human.cases`：`claude_auth`
  - `fatal`：`task_id_missing`、`sprint_dir_invalid`、`intent_ids_missing`、`intent_ids_invalid`、`chain_tampered`、`spec_missing`、`spec_review_out_of_scope_write`、`spec_review_unresolved`

验证：
- 运行 `cd packages/brain && node -e "const c=require('./scripts/coding-workflow/contract.json');console.log(c.activities.sort((a,b)=>a.order-b.order).map(a=>a.key).join(','))"`，输出应为 `intent,spec,spec_review,build,verify,chain_check,publish,report`。
- S-3 中 contract.test.mjs 的 `REPORTED` 与声明一致性断言通过。

### S-2
对应：I-2

修改文件：`lib/md-chain.mjs`、`activities/chain-check.mjs`、`__tests__/md-chain.test.mjs`、`__tests__/chain-check.test.mjs`

- `lib/md-chain.mjs`：在 `CHAIN` 中插入 `{ file: '02-review.md', step: 'spec_review', covers: '02-spec.md' }`，位置在 02-spec.md 与 03-build.md 之间。`DEFAULT_FILES` 不变。
- `activities/chain-check.mjs`：`CONTEXT_KEYS` 加入 `review_file`，放在 `spec_file` 之后，变为 `['intent_file', 'spec_file', 'review_file', 'build_file', 'evidence_file']`。上下文中有 review_file 时，02-review.md 纳入校验；`chain_files` 按 CHAIN 顺序输出。
- 补充 `__tests__/md-chain.test.mjs` 用例：
  - files 含 02-review.md，且 upstream 覆盖 02-spec.md 全部 S-n：没有错误。
  - upstream 漏掉某个 S-n：报 `02-review.md_not_covered:S-n`。
  - step 写错：报 step 不匹配错误。
- 补充 `__tests__/chain-check.test.mjs` 用例：
  - 上下文带 `review_file: '02-review.md'`，并且链合法：completed，`outputs.chain_files` 为 `['01-intent.md','02-spec.md','02-review.md', ...]`，顺序符合链定义。
  - 02-review.md 的 upstream 漏覆盖：failed，reason_code 为 `md_chain_invalid`。
  - 上下文不带 review_file：行为与现状一致，原有用例不改。

验证：`cd packages/brain && npx vitest run scripts/coding-workflow/__tests__/md-chain.test.mjs scripts/coding-workflow/__tests__/chain-check.test.mjs` 全部通过。

### S-3
对应：I-3

修改文件：`__tests__/contract.test.mjs`、`__tests__/e2e-contract.test.mjs`

- `contract.test.mjs`：
  - 两处活动 key 列表改为 8 个活动，加入 spec_review；order 序列改为 `[1..8]`。
  - `EXPECTED` 增加 `spec_review: { order: 3, phase: 'source', entry: 'activities/spec-review.mjs', max_duration_s: 1800, max_attempts: 1 }`，后续活动的 order 同步加 1。
  - `REPORTED` 增加 spec_review 条目，内容与 S-1 列出的 reason_code 一致。
- `e2e-contract.test.mjs`：
  - `ACTIVITY_KEYS` 改为 8 个活动。
  - `envFor` 增加 `FAKE_CLAUDE_MODE_REVIEW: 'review-approve'`。
  - `CHAIN_FILES` 改为 `['01-intent.md','02-spec.md','02-review.md','03-build.md','04-evidence.md']`。
  - 成功用例：断言八个活动全部 completed；Brain 收到的 chain_files 等于新的 `CHAIN_FILES`；PR 正文含 `- sprints/e2e/02-review.md`；origin 上推送的文件含 02-review.md。
  - verify 失败用例：活动序列改为 `['intent','spec','spec_review','build','verify','report']`。

验证：`cd packages/brain && npx vitest run scripts/coding-workflow/__tests__/contract.test.mjs scripts/coding-workflow/__tests__/e2e-contract.test.mjs` 全部通过。

### S-4
对应：I-4

修改文件：无新增改动，只做 S-1 到 S-3 的回归。如果 `__tests__/publish.test.mjs` 或其他用例因 CHAIN 变化失败，就在对应测试文件中按新链定义修正断言。

验证：`cd packages/brain && npx vitest run scripts/coding-workflow src/__tests__/activity-contract-sync.test.js` 全部通过，0 failed。
