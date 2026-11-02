---
task_id: 800eef4e-14b4-4532-a545-5c2d5cee53c6
step: verify
upstream: ["01-intent.md#I-1", "01-intent.md#I-2", "01-intent.md#I-3", "01-intent.md#I-4", "01-intent.md#I-5"]
---

### E-1
对应: I-1
verdict: PASS
```command
node --input-type=module -e 'import {managedSpecFixture,specText,TASK} from "./packages/brain/scripts/coding-workflow/__tests__/helpers/managed-spec.mjs"; import {loadBaselineContext} from "./packages/brain/scripts/coding-workflow/lib/baseline-context.mjs"; import {specErrors} from "./packages/brain/scripts/coding-workflow/lib/spec-check.mjs"; const f=managedSpecFixture({items:["批准修改 rule#cw-safe；批准更新 sample。"]}); try { const b=loadBaselineContext(f.input); const check=p=>specErrors(specText(p),TASK,["I-1"],{baseline:b}); console.log("baseline",b.status,b.rules[0].rule_id,b.refs.length,b.approvals.map(a=>`${a.ref_id}:${a.action}:${a.intent_id}`).join(",")); console.log("keep",JSON.stringify(check(f.plan))); const p=structuredClone(f.plan); p.rules[0].action="modify";p.rules[0].approval_refs=["I-1"];p.materials.find(x=>x.ref_id==="sample").action="update";p.materials.find(x=>x.ref_id==="sample").approval_refs=["I-1"];console.log("approved",JSON.stringify(check(p))); p.rules[0].rule_id="invented";console.log("forged",JSON.stringify(check(p))); } finally {f.clean();}'
```
```output
baseline managed cw-safe 4 rule:modify:I-1,sample:update:I-1
keep []
approved []
forged ["rule_unknown:rule#invented","approval_missing:rule#invented","rule_missing:rule#cw-safe"]
```

### E-2
对应: I-1
verdict: PASS
```command
rg -n 'loadBaselineContext|renderBaselineContext|specErrors\(|BASELINE_POLICY|BASELINE_CONTEXT|spec_revise|FORCED|MAX_ROUNDS|CODING_WF_GAN_BUDGET_USD' packages/brain/scripts/coding-workflow/activities/spec.mjs packages/brain/scripts/coding-workflow/activities/spec-review.mjs
```
```output
packages/brain/scripts/coding-workflow/activities/spec.mjs:29:  try { baseline = loadBaselineContext(input); }
packages/brain/scripts/coding-workflow/activities/spec.mjs:39:    BASELINE_CONTEXT: renderBaselineContext(baseline),
packages/brain/scripts/coding-workflow/activities/spec-review.mjs:122:  try { baseline = loadBaselineContext(input); }
packages/brain/scripts/coding-workflow/activities/spec-review.mjs:130:    BASELINE_CONTEXT: renderBaselineContext(baseline),
packages/brain/scripts/coding-workflow/activities/spec-review.mjs:223:    const revised = await runSession(ctx, 'spec_revise', {
packages/brain/scripts/coding-workflow/activities/spec-review.mjs:233:    const specErr = specErrors(fs.readFileSync(specPath, 'utf8'), taskId, intentIds, { invariantIds, baseline });
```

### E-3
对应: I-2
verdict: PASS
```command
node --input-type=module -e 'import {managedSpecFixture,specText,TASK} from "./packages/brain/scripts/coding-workflow/__tests__/helpers/managed-spec.mjs"; import {loadBaselineContext} from "./packages/brain/scripts/coding-workflow/lib/baseline-context.mjs"; import {specErrors} from "./packages/brain/scripts/coding-workflow/lib/spec-check.mjs"; const f=managedSpecFixture(); try {const b=loadBaselineContext(f.input),check=p=>specErrors(specText(p),TASK,["I-1"],{baseline:b}); const cases={missing_plan:null,missing_rule:{...f.plan,rules:[]},unknown_spec:structuredClone(f.plan),unknown_qa:structuredClone(f.plan),unapproved_modify:structuredClone(f.plan),unapproved_retire:structuredClone(f.plan),conflict:structuredClone(f.plan),no_verification:structuredClone(f.plan),not_applicable:structuredClone(f.plan)};cases.unknown_spec.rules[0].spec_ids=["S-99"];cases.unknown_qa.materials[0].qa_ids=["Q-99"];cases.unapproved_modify.rules[0].action="modify";cases.unapproved_retire.materials[0].action="retire";cases.conflict.rules[0].action="conflict";cases.no_verification.materials[0].verification="";cases.not_applicable.materials[0].action="not_applicable";for(const [name,plan] of Object.entries(cases))console.log(name,JSON.stringify(check(plan)));console.log("legacy",JSON.stringify(specErrors(specText(null),TASK,["I-1"])));}finally{f.clean();}'
```
```output
missing_plan ["material_plan_missing"]
missing_rule ["rule_missing:rule#cw-safe"]
unknown_spec ["spec_unknown:S-99"]
unknown_qa ["qa_unknown:Q-99"]
unapproved_modify ["approval_missing:rule#cw-safe"]
unapproved_retire ["approval_missing:spec"]
conflict ["rule_conflict:rule#cw-safe"]
no_verification ["material_verification_missing:spec"]
not_applicable []
legacy []
```

### E-4
对应: I-2
verdict: PASS
```command
rg -n '固定旧资料与规则上下文|对照旧原文|字段齐全|规则 action|材料为|verification|不新增 plan.md|未决冲突不能进入 build' packages/brain/scripts/coding-workflow/prompts/baseline-policy.md
```
```output
1:## 固定旧资料与规则上下文
9:逐条覆盖上下文 rules 和全部 refs，稳定 rule_id 与 I-n 独立，不得创造/漏列。规则 action 为 keep/modify/retire/conflict/not_applicable；材料为 keep/update/retire/conflict/not_applicable。reason 说明与当前需求的关系；每行关联真实 I/S/Q；not_applicable 必须解释，不能拿它隐藏冲突。额外实现/测试文件写入对应材料 additional_changes，每项包含 path/action/reason/verification，路径明确且不越界。实际 diff 的每个额外改动路径都必须登记，不能只列四个主材料；未映射改动属于未决，chain-check 将阻止继续。保留 spec/implementation/sample 也要说明理由与验证，不新增 plan.md。
13:对照旧原文、当前 I-n 和 02 的具体改动逐条语义审查：字段齐全仅代表结构合格，不代表行为保持；保留条目不得被其他 S-n 间接破坏，修改必须核对真实授权语义，冲突必须揭示，不得为评分通过降低规则。审查与改写均保留同一固定基线及所有原有 invariants、I/S/Q 合同；未决冲突不能进入 build。
```

### E-5
对应: I-3
verdict: PASS
```command
node --input-type=module -e 'import {managedSpecFixture,specText,TASK} from "./packages/brain/scripts/coding-workflow/__tests__/helpers/managed-spec.mjs"; import {loadBaselineContext} from "./packages/brain/scripts/coding-workflow/lib/baseline-context.mjs"; import {specErrors} from "./packages/brain/scripts/coding-workflow/lib/spec-check.mjs"; const f=managedSpecFixture({items:["批准修改 rule#cw-safe；批准更新 sample。"]}); try { const b=loadBaselineContext(f.input); const check=p=>specErrors(specText(p),TASK,["I-1"],{baseline:b}); console.log("baseline",b.status,b.rules[0].rule_id,b.refs.length,b.approvals.map(a=>`${a.ref_id}:${a.action}:${a.intent_id}`).join(",")); console.log("keep",JSON.stringify(check(f.plan))); const p=structuredClone(f.plan); p.rules[0].action="modify";p.rules[0].approval_refs=["I-1"];p.materials.find(x=>x.ref_id==="sample").action="update";p.materials.find(x=>x.ref_id==="sample").approval_refs=["I-1"];console.log("approved",JSON.stringify(check(p))); p.rules[0].rule_id="invented";console.log("forged",JSON.stringify(check(p))); } finally {f.clean();}'
```
```output
baseline managed cw-safe 4 rule:modify:I-1,sample:update:I-1
keep []
approved []
forged ["rule_unknown:rule#invented","approval_missing:rule#invented","rule_missing:rule#cw-safe"]
```

### E-6
对应: I-4
verdict: PASS
```command
rg -n '固定旧资料与规则上下文|对照旧原文|字段齐全|规则 action|材料为|verification|不新增 plan.md|未决冲突不能进入 build' packages/brain/scripts/coding-workflow/prompts/baseline-policy.md
```
```output
7:{"version":1,"rules":[{"ref_id":"rule","rule_id":"原文稳定ID","action":"keep","reason":"保留理由","intent_ids":["I-1"],"spec_ids":["S-1"],"qa_ids":["Q-1"],"approval_refs":[]}],"materials":[{"ref_id":"spec","path":"固定原路径","action":"update","reason":"更新理由","intent_ids":["I-1"],"spec_ids":["S-1"],"qa_ids":["Q-1"],"approval_refs":[],"verification":"实际验证方法","additional_changes":[]}]}
9:逐条覆盖上下文 rules 和全部 refs，稳定 rule_id 与 I-n 独立，不得创造/漏列。规则 action 为 keep/modify/retire/conflict/not_applicable；材料为 keep/update/retire/conflict/not_applicable。reason 说明与当前需求的关系；每行关联真实 I/S/Q；not_applicable 必须解释，不能拿它隐藏冲突。额外实现/测试文件写入对应材料 additional_changes，每项包含 path/action/reason/verification，路径明确且不越界。实际 diff 的每个额外改动路径都必须登记，不能只列四个主材料；未映射改动属于未决，chain-check 将阻止继续。保留 spec/implementation/sample 也要说明理由与验证，不新增 plan.md。
```

### E-7
对应: I-5
verdict: PASS
```command
CODING_WF_TEST_TRANSPORT=ipc npm exec --workspace cecelia-brain -- vitest run scripts/coding-workflow/__tests__/baseline-context.test.mjs scripts/coding-workflow/__tests__/spec-materials.test.mjs scripts/coding-workflow/__tests__/managed-spec-activity.test.mjs scripts/coding-workflow/__tests__/baseline-prompt.test.mjs scripts/coding-workflow/__tests__/spec.test.mjs scripts/coding-workflow/__tests__/spec-review.test.mjs scripts/coding-workflow/__tests__/spec-check.test.mjs scripts/coding-workflow/__tests__/claude.test.mjs --maxWorkers=1 --minWorkers=1
```
```output
 ✓ scripts/coding-workflow/__tests__/managed-spec-activity.test.mjs  (8 tests) 6455ms
 ✓ scripts/coding-workflow/__tests__/spec-materials.test.mjs  (19 tests) 6130ms
 ✓ scripts/coding-workflow/__tests__/baseline-context.test.mjs  (6 tests) 4474ms
 ✓ scripts/coding-workflow/__tests__/baseline-prompt.test.mjs  (1 test)

 Test Files  8 passed (8)
      Tests  172 passed (172)
   Start at  14:38:15
   Duration  42.42s (transform 72ms, setup 189ms, collect 145ms, tests 41.31s, environment 0ms, prepare 167ms)
```

### E-8
对应: I-5
verdict: PASS
```command
node --input-type=module -e 'import {managedSpecFixture,specText,TASK} from "./packages/brain/scripts/coding-workflow/__tests__/helpers/managed-spec.mjs"; import {loadBaselineContext} from "./packages/brain/scripts/coding-workflow/lib/baseline-context.mjs"; import {specErrors} from "./packages/brain/scripts/coding-workflow/lib/spec-check.mjs"; const f=managedSpecFixture(); try {const b=loadBaselineContext(f.input),check=p=>specErrors(specText(p),TASK,["I-1"],{baseline:b}); const cases={missing_plan:null,missing_rule:{...f.plan,rules:[]},unknown_spec:structuredClone(f.plan),unknown_qa:structuredClone(f.plan),unapproved_modify:structuredClone(f.plan),unapproved_retire:structuredClone(f.plan),conflict:structuredClone(f.plan),no_verification:structuredClone(f.plan),not_applicable:structuredClone(f.plan)};cases.unknown_spec.rules[0].spec_ids=["S-99"];cases.unknown_qa.materials[0].qa_ids=["Q-99"];cases.unapproved_modify.rules[0].action="modify";cases.unapproved_retire.materials[0].action="retire";cases.conflict.rules[0].action="conflict";cases.no_verification.materials[0].verification="";cases.not_applicable.materials[0].action="not_applicable";for(const [name,plan] of Object.entries(cases))console.log(name,JSON.stringify(check(plan)));console.log("legacy",JSON.stringify(specErrors(specText(null),TASK,["I-1"])));}finally{f.clean();}'
```
```output
missing_plan ["material_plan_missing"]
missing_rule ["rule_missing:rule#cw-safe"]
unknown_spec ["spec_unknown:S-99"]
unknown_qa ["qa_unknown:Q-99"]
unapproved_modify ["approval_missing:rule#cw-safe"]
unapproved_retire ["approval_missing:spec"]
conflict ["rule_conflict:rule#cw-safe"]
no_verification ["material_verification_missing:spec"]
not_applicable []
legacy []
```
