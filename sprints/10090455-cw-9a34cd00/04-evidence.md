---
task_id: 9a34cd00-1c43-4847-b455-2f90f3809083
step: verify
upstream: ["01-intent.md#I-1", "01-intent.md#I-2", "01-intent.md#I-3", "01-intent.md#I-4", "01-intent.md#I-5", "01-intent.md#I-6"]
---
# 验收证据

### E-1
对应: I-1
verdict: PASS

评审活动以全新会话（isolateRemote:true、禁 Bash）运行，写 02-review.md 并按 lib/review.mjs 解析、按 step spec_review 与 02-spec.md 覆盖校验；评审 prompt 只给 01/02 路径，要求逐条检查三项内容。

```command
cd /Users/administrator/worktrees/cecelia-cw/cw-9a34cd00/packages/brain/scripts/coding-workflow && grep -n "isolateRemote\|disallowedTools\|REVIEW_FILE = \|step: 'spec_review'\|coversFile\|parseReview(" activities/spec-review.mjs && grep -n "INTENT_PATH\|SPEC_PATH\|REVIEW_PATH\|逐条检查\|真实运行\|缩小或改写\|歧义\|step: spec_review\|upstream" prompts/spec-review.md
```

```output
16:const REVIEW_FILE = '02-review.md';
35:  const args = ['-p', prompt, '--permission-mode', 'acceptEdits', '--disallowedTools', 'Bash'];
37:  const run = await runClaude({ args, cwd: worktree, timeoutMs, tag: role, isolateRemote: true });
53:  const review = parseReview(text, { specIds: ids, intentIds });
55:    ...reportErrors(text, { taskId, step: 'spec_review', coversFile: SPEC_FILE, ids }),
6:INTENT_PATH: {{INTENT_PATH}}
7:SPEC_PATH: {{SPEC_PATH}}
8:REVIEW_PATH: {{REVIEW_PATH}}
12:1. 读取 INTENT_PATH（验收条目，锚点 `### I-n`）与 SPEC_PATH（实现规格，锚点 `### S-n`）。必要时阅读仓库相关代码核实规格可行。
13:2. 逐条检查：
14:   1. 每条 I-n 是否有 S-n 给出能真实运行的验证方式（具体命令或断言，不是"测试通过"之类的空话）；
15:   2. 规格是否缩小或改写了验收条目（漏掉要求、放宽标准、换了验收对象）；
16:   3. 是否有歧义与遗漏的边界情况。
17:3. 只写 REVIEW_PATH 这一个文件。
19:REVIEW_PATH 文件格式要求：
20:- 以 frontmatter 开头，三个键各占一行，写法如下（upstream 为单行 JSON 数组，必须列出 SPEC_IDS 中的全部 S-n，每项形如 `02-spec.md#S-1`）：
25:step: spec_review
26:upstream: ["02-spec.md#S-1"]
35:- 只写 REVIEW_PATH；不修改 INTENT_PATH 与 SPEC_PATH，不修改任何其他文件。
```

### E-2
对应: I-2, I-3, I-4
verdict: PASS

APPROVE 分支输出 review_file/review_rounds/spec_sha256；REVISE 起 spec_revise 会话、用 specErrors 自检 02、最多 2 轮后 spec_review_unresolved 带 R-n；review_invalid 为 retryable；会话后查越界写与 01 哈希（chainTamperFailure）。改写 prompt 给 01/02/02-review 路径、按 R-n 改且不得改 01。

```command
cd /Users/administrator/worktrees/cecelia-cw/cw-9a34cd00/packages/brain/scripts/coding-workflow && grep -n "APPROVE\|review_rounds\|spec_sha256\|MAX_REVISIONS\|spec_review_unresolved\|unresolved_issues\|review_invalid\|spec_revise\|specErrors\|chainTamperFailure\|spec_review_out_of_scope_write" activities/spec-review.mjs && grep -n "INTENT_PATH\|SPEC_PATH\|REVIEW_PATH\|R-n\|不得修改" prompts/spec-revise.md
```

```output
11:import { sha256File, chainTamperFailure } from '../lib/guards.mjs';
14:import { SPEC_FILE, INTENT_FILE, specErrors, specIds } from '../lib/spec-check.mjs';
19:const MAX_REVISIONS = 2;
20:const PROMPTS = { spec_review: 'spec-review', spec_revise: 'spec-revise' };
42:    return fail('fatal', 'spec_review_out_of_scope_write', { evidence: [{ out_of_scope_changes: stray }] });
44:  return chainTamperFailure(dir, { intent_sha256: input.intent_sha256 });
50:    return { failure: fail('retryable', 'review_invalid', { evidence: [{ review_errors: ['review_missing'] }] }) };
58:  if (errors.length > 0) return { failure: fail('retryable', 'review_invalid', { evidence: [{ review_errors: errors }] }) };
67:  const tamperedBefore = chainTamperFailure(dir, { intent_sha256: input.intent_sha256 });
86:    if (review.verdict === 'APPROVE') {
89:        outputs: { review_file: REVIEW_FILE, review_rounds: round, spec_sha256: sha256File(specPath) },
90:        evidence: [`${REVIEW_FILE}：第 ${round} 次评审 APPROVE`],
93:    if (round > MAX_REVISIONS) {
94:      return fail('fatal', 'spec_review_unresolved', { evidence: [{ unresolved_issues: review.issues.map((i) => i.id) }] });
97:    const reviseFailure = await runSession(ctx, 'spec_revise', { ...paths, INTENT_IDS: intentIds.join(',') });
100:    const errors = specErrors(fs.readFileSync(specPath, 'utf8'), taskId, intentIds);
6:INTENT_PATH: {{INTENT_PATH}}
7:SPEC_PATH: {{SPEC_PATH}}
8:REVIEW_PATH: {{REVIEW_PATH}}
12:1. 读取 REVIEW_PATH，理解每个问题小节 `### R-n`（`针对:` 行指出涉及的 S-n/I-n）。
13:2. 读取 INTENT_PATH 与 SPEC_PATH，必要时阅读仓库相关代码。
14:3. 按每个 R-n 修改 SPEC_PATH，逐条解决评审提出的问题。
16:SPEC_PATH 修改后仍须保持原格式：
22:- 只修改 SPEC_PATH；不得修改 INTENT_PATH 与 REVIEW_PATH，不修改任何其他文件。
```

### E-3
对应: I-3
verdict: PASS

02 自检与 spec 活动共用 lib/spec-check.mjs 的 specErrors（同一规则）。

```command
cd /Users/administrator/worktrees/cecelia-cw/cw-9a34cd00/packages/brain/scripts/coding-workflow && grep -n "spec-check\|specErrors" activities/spec.mjs activities/spec-review.mjs lib/spec-check.mjs
```

```output
lib/spec-check.mjs:15:export function specErrors(text, taskId, intentIds) {
activities/spec-review.mjs:14:import { SPEC_FILE, INTENT_FILE, specErrors, specIds } from '../lib/spec-check.mjs';
activities/spec-review.mjs:100:    const errors = specErrors(fs.readFileSync(specPath, 'utf8'), taskId, intentIds);
activities/spec.mjs:11:import { SPEC_FILE, INTENT_FILE, specErrors } from '../lib/spec-check.mjs';
activities/spec.mjs:50:  const errors = specErrors(fs.readFileSync(specPath, 'utf8'), input.task_id, intentIds);
```

### E-4
对应: I-5, I-1, I-2, I-3, I-4
verdict: PASS

spec-review 单测 16 条全部通过，覆盖一次通过、改写一轮后通过（spec_sha256=新哈希）、两轮仍 REVISE → spec_review_unresolved、改 01 → chain_tampered、越界写 → spec_review_out_of_scope_write、review_invalid 等。

```command
cd /Users/administrator/worktrees/cecelia-cw/cw-9a34cd00/packages/brain && npx vitest run scripts/coding-workflow/__tests__/spec-review.test.mjs --reporter=verbose 2>&1 | grep -E "✓|×|FAIL|Tests"
```

```output
 ✓ scripts/coding-workflow/__tests__/spec-review.test.mjs > spec_review 活动（子进程 + 假 claude） > 一次通过：completed，outputs 记录评审文件/轮数/02 哈希，只起一次评审会话
 ✓ scripts/coding-workflow/__tests__/spec-review.test.mjs > spec_review 活动（子进程 + 假 claude） > 改写一轮后通过：review_rounds=2，spec_sha256 为改写后 02 的哈希
 ✓ scripts/coding-workflow/__tests__/spec-review.test.mjs > spec_review 活动（子进程 + 假 claude） > 两轮改写后仍 REVISE -> fatal spec_review_unresolved，列出最后一次评审的问题
 ✓ scripts/coding-workflow/__tests__/spec-review.test.mjs > spec_review 活动（子进程 + 假 claude） > 评审会话改了 01-intent.md -> fatal chain_tampered
 ✓ scripts/coding-workflow/__tests__/spec-review.test.mjs > spec_review 活动（子进程 + 假 claude） > REVISE 评审会话改了 01-intent.md -> chain_tampered，不再起改写会话
 ✓ scripts/coding-workflow/__tests__/spec-review.test.mjs > spec_review 活动（子进程 + 假 claude） > 入参 intent_sha256 与现存 01 不符 -> chain_tampered，不启动 claude
 ✓ scripts/coding-workflow/__tests__/spec-review.test.mjs > spec_review 活动（子进程 + 假 claude） > 评审会话越界写 -> fatal spec_review_out_of_scope_write
 ✓ scripts/coding-workflow/__tests__/spec-review.test.mjs > spec_review 活动（子进程 + 假 claude） > 评审文档无 verdict 行 -> retryable review_invalid
 ✓ scripts/coding-workflow/__tests__/spec-review.test.mjs > spec_review 活动（子进程 + 假 claude） > 评审会话退出 0 但没写评审文档 -> retryable review_invalid
 ✓ scripts/coding-workflow/__tests__/spec-review.test.mjs > spec_review 活动（子进程 + 假 claude） > 旧 02-review.md 残留 + 评审会话没写新文件 -> 不把旧文档当新结论
 ✓ scripts/coding-workflow/__tests__/spec-review.test.mjs > spec_review 活动（子进程 + 假 claude） > 改写后 02 不合格（删了 S-n）-> retryable spec_invalid
 ✓ scripts/coding-workflow/__tests__/spec-review.test.mjs > spec_review 活动（子进程 + 假 claude） > 改写会话删了 02 -> fatal spec_missing
 ✓ scripts/coding-workflow/__tests__/spec-review.test.mjs > spec_review 活动（子进程 + 假 claude） > 02-spec.md 不存在 -> fatal spec_missing，不启动 claude
 ✓ scripts/coding-workflow/__tests__/spec-review.test.mjs > spec_review 活动（子进程 + 假 claude） > intent_ids 非法 -> fatal intent_ids_invalid，不启动 claude
 ✓ scripts/coding-workflow/__tests__/spec-review.test.mjs > spec_review 活动（子进程 + 假 claude） > 认证失败 -> needs_human claude_auth
 ✓ scripts/coding-workflow/__tests__/spec-review.test.mjs > spec_review 活动（子进程 + 假 claude） > 评审会话卡死 -> retryable claude_timeout（CODING_WF_SPEC_REVIEW_TIMEOUT_MS 生效） 1561ms
      Tests  16 passed (16)
```

### E-5
对应: I-5
verdict: PASS

按 I-5 原命令运行，测试文件通过。

```command
cd packages/brain && npx vitest run scripts/coding-workflow/__tests__/spec-review.test.mjs 2>&1 | tail -40
```

```output
 ✓ scripts/coding-workflow/__tests__/spec-review.test.mjs  (16 tests) 3118ms

 Test Files  1 passed (1)
      Tests  16 passed (16)
```

### E-6
对应: I-6
verdict: PASS

coding-workflow 全量测试 31 个文件 563 条全部通过。

```command
cd /Users/administrator/worktrees/cecelia-cw/cw-9a34cd00/packages/brain && npx vitest run scripts/coding-workflow 2>&1 | tail -40
```

```output
 ✓ scripts/coding-workflow/__tests__/spec-review.test.mjs  (16 tests) 3142ms
 Test Files  31 passed (31)
      Tests  563 passed (563)
```
