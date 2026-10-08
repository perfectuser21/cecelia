---
task_id: 7aebfb3c-4349-415b-b535-fd474d26fdb3
step: verify
upstream: ["01-intent.md#I-1","01-intent.md#I-2","01-intent.md#I-3","01-intent.md#I-4"]
---
# 验收证据

### E-1
对应: I-1
verdict: PASS

活动顺序为 intent→spec→spec_review→build→verify→chain_check→publish→report；spec_review 的 entry 是 activities/spec-review.mjs，phase 是 source，max_duration_s 为 1800，max_attempts 为 1。

```command
cd /Users/administrator/worktrees/cecelia-cw/cw-7aebfb3c && node -e 'const c=require("./packages/brain/scripts/coding-workflow/contract.json");const a=c.activities;const s=a.find(x=>x.order===3);console.log(Object.keys(c).join(","));console.log(a.map(x=>x.order+":"+(x.activity||x.name||x.key||x.id)).join(" "));const {failure,...rest}=s;console.log(JSON.stringify(rest))'
```

```output
workflow,activities
1:intent 2:spec 3:spec_review 4:build 5:verify 6:chain_check 7:publish 8:report
{"key":"spec_review","order":3,"budget":{"max_duration_s":1800,"heartbeat_s":30},"runtime":{"protocol":"json-stdio-v1","phase":"source","entry":"activities/spec-review.mjs","on_failure":"stop_run","max_attempts":1}}
```

### E-2
对应: I-1
verdict: PASS

order 3（spec_review）的 failure 声明：retryable 为 claude_failed/claude_timeout/review_invalid/spec_invalid；needs_human 为 claude_auth；fatal 为 task_id_missing/sprint_dir_invalid/intent_ids_missing/intent_ids_invalid/chain_tampered/spec_missing/spec_review_out_of_scope_write/spec_review_unresolved。

```command
cd /Users/administrator/worktrees/cecelia-cw/cw-7aebfb3c && node -e 'const c=require("./packages/brain/scripts/coding-workflow/contract.json");const a=c.activities||c;console.log(JSON.stringify(a.map?a.map(x=>({n:x.name||x.id,o:x.order,e:x.entry,p:x.phase,b:x.budget,f:x.failure})):Object.keys(c),null,1))'
```

```output
 {
  "o": 3,
  "b": {
   "max_duration_s": 1800,
   "heartbeat_s": 30
  },
  "f": {
   "empty_ok": [],
   "retryable": [
    "claude_failed",
    "claude_timeout",
    "review_invalid",
    "spec_invalid"
   ],
   "needs_human": {
    "cases": [
     "claude_auth"
    ]
   },
   "fatal": [
    "task_id_missing",
    "sprint_dir_invalid",
    "intent_ids_missing",
    "intent_ids_invalid",
    "chain_tampered",
    "spec_missing",
    "spec_review_out_of_scope_write",
    "spec_review_unresolved"
   ]
  }
 },
```

### E-3
对应: I-1
verdict: PASS

spec-review.mjs 直接报出的 reason_code：spec_review_out_of_scope_write、review_invalid、spec_missing、spec_review_unresolved、spec_invalid，以及 intentIdsError 的结果。

```command
cd /Users/administrator/worktrees/cecelia-cw/cw-7aebfb3c/packages/brain/scripts/coding-workflow && grep -ohE "reason_code: *'[a-z_]+'|'[a-z_]+'(?=)" activities/spec-review.mjs | grep -oE "[a-z_]{4,}" | sort -u > /tmp/sr_codes.txt; grep -nE "reason_code|fail\(|codes?\b" activities/spec-review.mjs | head -60
```

```output
42:    return fail('fatal', 'spec_review_out_of_scope_write', { evidence: [{ out_of_scope_changes: stray }] });
50:    return { failure: fail('retryable', 'review_invalid', { evidence: [{ review_errors: ['review_missing'] }] }) };
58:  if (errors.length > 0) return { failure: fail('retryable', 'review_invalid', { evidence: [{ review_errors: errors }] }) };
66:  if (idsError) return fail('fatal', idsError);
72:  if (!fs.existsSync(specPath)) return fail('fatal', 'spec_missing');
94:      return fail('fatal', 'spec_review_unresolved', { evidence: [{ unresolved_issues: review.issues.map((i) => i.id) }] });
99:    if (!fs.existsSync(specPath)) return fail('fatal', 'spec_missing');
101:    if (errors.length > 0) return fail('retryable', 'spec_invalid', { evidence: [{ spec_errors: errors }] });
```

### E-4
对应: I-1
verdict: PASS

spec-review.mjs 调用的辅助函数（validateBase/intentIdsError/claudeFailure/chainTamperFailure）会间接报出这些 reason_code：task_id_missing、sprint_dir_invalid、intent_ids_missing、intent_ids_invalid、claude_timeout、claude_failed、claude_auth、chain_tampered。E-3 与 E-4 合起来，正好等于 E-2 中 failure 声明的完整集合，没有遗漏。

```command
cd /Users/administrator/worktrees/cecelia-cw/cw-7aebfb3c/packages/brain/scripts/coding-workflow && grep -nE "'(task_id_missing|sprint_dir_invalid|intent_ids_missing|intent_ids_invalid|claude_failed|claude_timeout|claude_auth|chain_tampered)'" lib/protocol.mjs lib/intent.mjs lib/claude.mjs lib/guards.mjs
```

```output
lib/intent.mjs:12:/** 校验上下文里的 intent_ids：空/非数组 → 'intent_ids_missing'，元素格式不对 → 'intent_ids_invalid'，合法 → null。 */
lib/intent.mjs:14:  if (!Array.isArray(ids) || ids.length === 0) return 'intent_ids_missing';
lib/intent.mjs:15:  if (!ids.every((id) => typeof id === 'string' && INTENT_ID_RE.test(id))) return 'intent_ids_invalid';
lib/protocol.mjs:33: * worktree 非绝对路径字符串、sprintDir 为绝对路径或含 `..` 段时抛 Error('sprint_dir_invalid')。
lib/protocol.mjs:37:    throw new Error('sprint_dir_invalid');
lib/protocol.mjs:40:    throw new Error('sprint_dir_invalid');
lib/protocol.mjs:43:    throw new Error('sprint_dir_invalid');
lib/protocol.mjs:48:    throw new Error('sprint_dir_invalid');
lib/protocol.mjs:59:  if (typeof taskId !== 'string' || taskId === '') throw new Error('task_id_missing');
lib/claude.mjs:85:  if (timedOut) return fail('retryable', 'claude_timeout');
lib/claude.mjs:86:  if (terminated) return fail('retryable', 'claude_failed', { evidence: [{ terminated: true }] });
lib/claude.mjs:89:  if (AUTH_RE.test(authText)) return fail('needs_human', 'claude_auth');
lib/claude.mjs:90:  return fail('retryable', 'claude_failed');
lib/guards.mjs:35:  return tampered.length > 0 ? fail('fatal', 'chain_tampered', { evidence: [{ tampered_files: tampered }] }) : null;
```

### E-5
对应: I-2
verdict: PASS

md-chain 的 CHAIN 中已有 02-review.md（step 为 spec_review，covers 为 02-spec.md）；chain-check 的 CONTEXT_KEYS 包含 review_file。

```command
cd /Users/administrator/worktrees/cecelia-cw/cw-7aebfb3c/packages/brain/scripts/coding-workflow && grep -nE "02-review|spec_review|review_file" lib/md-chain.mjs activities/chain-check.mjs
```

```output
activities/chain-check.mjs:2:// 应存在的链文件取自上下文 intent_file/spec_file/review_file/build_file/evidence_file；都没有时按只有 01/02 的旧链校验。
activities/chain-check.mjs:6:const CONTEXT_KEYS = ['intent_file', 'spec_file', 'review_file', 'build_file', 'evidence_file'];
lib/md-chain.mjs:66:  { file: '02-review.md', step: 'spec_review', covers: '02-spec.md' },
```

### E-6
对应: I-2
verdict: PASS

实际调用 checkChain 验证：02-review.md 的 upstream 漏掉 S-2 时报 `02-review.md_not_covered:S-2`；覆盖全部 S-n 后结果为 ok。

```command
cd /Users/administrator/worktrees/cecelia-cw/cw-7aebfb3c/packages/brain/scripts/coding-workflow && D=$(mktemp -d) && printf -- '---\ntask_id: t1\nstep: intent\nupstream: []\n---\n### I-1\nx\n' > $D/01-intent.md && printf -- '---\ntask_id: t1\nstep: spec\nupstream: ["01-intent.md#I-1"]\n---\n### S-1\na\n### S-2\nb\n' > $D/02-spec.md && printf -- '---\ntask_id: t1\nstep: spec_review\nupstream: ["02-spec.md#S-1"]\n---\nbody\n' > $D/02-review.md && node --input-type=module -e "import {checkChain} from './lib/md-chain.mjs'; const f=['01-intent.md','02-spec.md','02-review.md']; console.log('partial:', JSON.stringify(checkChain({dir:'$D',taskId:'t1',files:f})));" && printf -- '---\ntask_id: t1\nstep: spec_review\nupstream: ["02-spec.md#S-1","02-spec.md#S-2"]\n---\nbody\n' > $D/02-review.md && node --input-type=module -e "import {checkChain} from './lib/md-chain.mjs'; const f=['01-intent.md','02-spec.md','02-review.md']; console.log('full:', JSON.stringify(checkChain({dir:'$D',taskId:'t1',files:f})));"
```

```output
partial: {"ok":false,"errors":["02-review.md_not_covered:S-2"],"files":["01-intent.md","02-spec.md","02-review.md"]}
full: {"ok":true,"errors":[],"files":["01-intent.md","02-spec.md","02-review.md"]}
```

### E-7
对应: I-2
verdict: PASS

chain_check 活动的测试覆盖两种情况：上下文带 review_file 时把 02-review 纳入校验；02-review 漏覆盖 S-n 时报 md_chain_invalid。这两个用例都在 E-10 的全量测试中通过。

```command
cd /Users/administrator/worktrees/cecelia-cw/cw-7aebfb3c/packages/brain && grep -nE "review_file|02-review" scripts/coding-workflow/__tests__/chain-check.test.mjs
```

```output
89:    fs.writeFileSync(path.join(sprintAbs, '02-review.md'), `${fm(TASK_ID, 'spec_review', reviewUpstream)}\nverdict: APPROVE\n`);
102:    review_file: '02-review.md',
107:  it('上下文带 review_file 且链合法 -> completed，chain_files 含 02-review 且按链顺序', async () => {
113:      chain_files: ['01-intent.md', '02-spec.md', '02-review.md', '03-build.md', '04-evidence.md'],
117:  it('02-review upstream 漏覆盖 S-n -> failed md_chain_invalid', async () => {
123:    expect(r.result.evidence[0].errors).toContain('02-review.md_not_covered:S-2');
```

### E-8
对应: I-3
verdict: PASS

contract.test.mjs 与 e2e-contract.test.mjs 共 2 个文件、44 个用例，全部通过。

```command
cd /Users/administrator/worktrees/cecelia-cw/cw-7aebfb3c/packages/brain && npx vitest run scripts/coding-workflow/__tests__/contract.test.mjs scripts/coding-workflow/__tests__/e2e-contract.test.mjs 2>&1 | tail -30
```

```output
 ✓ scripts/coding-workflow/__tests__/e2e-contract.test.mjs  (2 tests) 2010ms
 ✓ scripts/coding-workflow/__tests__/contract.test.mjs  (42 tests) 5ms

 Test Files  2 passed (2)
      Tests  44 passed (44)
```

### E-9
对应: I-3
verdict: PASS

端到端用例断言：活动数为 8、每个活动 status 都是 completed、PR 正文包含 sprints/e2e/02-review.md。这些断言已在 E-8 中通过。

```command
cd /Users/administrator/worktrees/cecelia-cw/cw-7aebfb3c/packages/brain && grep -nE "02-review|completed|toHaveLength\(8\)|spec_review" scripts/coding-workflow/__tests__/e2e-contract.test.mjs | head -30
```

```output
22:const ACTIVITY_KEYS = ['intent', 'spec', 'spec_review', 'build', 'verify', 'chain_check', 'publish', 'report'];
23:const CHAIN_FILES = ['01-intent.md', '02-spec.md', '02-review.md', '03-build.md', '04-evidence.md'];
141:  it('完整八活动 completed：build 真实提交、verify 全 PASS，PR 正文含验收摘要，Brain 恰好收到一次 PATCH', async () => {
146:    expect(r.result.status).toBe('completed');
149:    expect(r.result.activities).toHaveLength(8);
150:    for (const a of r.result.activities) expect(a.status, a.key).toBe('completed');
182:    expect(prBody).toContain('- sprints/e2e/02-review.md');
```

### E-10
对应: I-4
verdict: PASS

scripts/coding-workflow 全部测试加 activity-contract-sync 测试：32 个文件、584 个用例，全部通过。

```command
cd /Users/administrator/worktrees/cecelia-cw/cw-7aebfb3c/packages/brain && npx vitest run scripts/coding-workflow src/__tests__/activity-contract-sync.test.js 2>&1 | tail -15
```

```output
 Test Files  32 passed (32)
      Tests  584 passed (584)
```
