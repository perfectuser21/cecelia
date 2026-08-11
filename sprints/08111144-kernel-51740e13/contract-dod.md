---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: 合并权收归单一裁决闸（harness-judge required check）

**范围**: 新增 Brain `GET /harness/pr-ownership` 归属端点（凭 initiative_runs.pr_url）；通道 1 `should-auto-merge.sh` 判据从标题正则换 Brain 求证（fail-closed）+ ci.yml 实参改 `$PR_NUMBER`；kernel `merge_pr` 合并前置 `harness-judge` status=success；产出通道 3 改造说明。**不改** mergeGate/evaluator/judge/gear。
**大小**: M

## ARTIFACT 条目

- [ ] [ARTIFACT] Brain 归属端点已注册于 harness 路由
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/harness.js','utf8');if(!c.includes('pr-ownership'))process.exit(1)"

- [ ] [ARTIFACT] should-auto-merge.sh 已改为 Brain 求证（curl pr-ownership 归属端点）
  Test: node -e "const c=require('fs').readFileSync('.github/workflows/scripts/should-auto-merge.sh','utf8');if(!c.includes('pr-ownership')||!c.includes('--max-time'))process.exit(1)"

- [ ] [ARTIFACT] ci.yml auto-merge step 以 $PR_NUMBER（非 $PR_TITLE）调脚本
  Test: grep -Fq 'should-auto-merge.sh "$HEAD_BRANCH" "$PR_NUMBER"' .github/workflows/ci.yml

- [ ] [ARTIFACT] kernel merge_pr 置 harness-judge status
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/orchestrator/kernel-handlers.js','utf8');if(!c.includes('harness-judge')||!c.includes('statuses'))process.exit(1)"

- [ ] [ARTIFACT] 通道 3 engine-pr-watchdog 改造说明 + Brain 端点契约文档
  Test: node -e "const c=require('fs').readFileSync('sprints/08111144-kernel-51740e13/engine-pr-watchdog-retrofit.md','utf8');if(!c.includes('pr-ownership')||!c.includes('gh pr merge'))process.exit(1)"

## Invariant 覆盖（铁律逐条映射）

- [ ] [BEHAVIOR] [L2] INV-1 裁判前不可合并：无 judge PASS 时 mergeGate 拒绝（kernel 不置 success）
  动作: 以 judgeVerdict=null 调用 mergeGate 纯函数
  预期观察: allow=false，reason=judge_verdict_missing
  等待预算: 0s
  留证: node 断言输出
  Test: manual:bash -c 'node --input-type=module -e "import {mergeGate} from \"./packages/brain/src/orchestrator/gates.js\"; const g=mergeGate({evaluateVerdict:{verdict:\"PASS\",pr_head_sha:\"s\"},judgeVerdict:null,prHeadSha:\"s\",reviewRequired:false,reviewApproved:false}); process.exit(g.allow===false&&g.reason===\"judge_verdict_missing\"?0:1)"'

- [ ] [BEHAVIOR] [L2] INV-5 不动裁决内核：kernel-handlers 既有 CLEAN/BEHIND/CONFLICTING 全部断言仍绿（mergeGate 条件不改）
  动作: 真跑 kernel-handlers 全量单测
  预期观察: 既有 merge 处理断言 + 新增置闸断言全过
  等待预算: 120s
  留证: vitest 末 20 行
  Test: manual:bash -c 'cd packages/brain && npx vitest run src/orchestrator/__tests__/kernel-handlers.test.js 2>&1 | tail -20 | grep -qE "passed|✓"'

> INV-2（fail-closed）→ B-04；INV-3（不误拦 /dev）→ B-05/B-02；INV-4（归属只信 pr_url）→ B-01；INV-6（judge FAIL 先辨证据）→ N/A：本 sprint 不触及 judge 判定/证据流程。

## BEHAVIOR 条目（五行剧本 + 内嵌 manual:bash 单行命令）

- [ ] [BEHAVIOR] [L2] B-01: 归属端点对已写入 pr_url 的 harness PR 返回 owned:true（归属只信 pr_url）
  动作: 向 $DB_URL 空库 seed 一条 initiative_runs（pr_url=.../pull/4755），curl 归属端点 pr_number=4755
  预期观察: HTTP 200，owned=true，run_id 为 UUID 字符串，pr_number 回显 4755
  等待预算: 0s
  留证: curl 响应 JSON 进 evidence
  Test: manual:bash -c 'psql "$DB_URL" -c "INSERT INTO initiative_runs (initiative_id, pr_url) VALUES (gen_random_uuid(), '"'"'https://github.com/perfectuser21/cecelia/pull/4755'"'"')" >/dev/null; curl -sf "localhost:5221/api/brain/harness/pr-ownership?pr_number=4755" | jq -e ".owned==true and (.run_id|type==\"string\") and .pr_number==4755"'

- [ ] [BEHAVIOR] [L2] B-02: 未写入 pr_url 的 cp-* PR 返回 owned:false（真手动 /dev 不误拦）
  动作: curl 归属端点一个从未 seed 的高位 pr_number
  预期观察: HTTP 200，owned=false，run_id=null
  等待预算: 0s
  留证: curl 响应 JSON
  Test: manual:bash -c 'curl -sf "localhost:5221/api/brain/harness/pr-ownership?pr_number=99900001" | jq -e ".owned==false and .run_id==null"'

- [ ] [BEHAVIOR] [L2] B-03: error path — pr_number 非法返回 400 + error 字段
  动作: curl 归属端点 pr_number=abc
  预期观察: HTTP 400，body 含 error 字符串
  等待预算: 0s
  留证: http_code + body
  Test: manual:bash -c 'CODE=$(curl -s -o /tmp/o.json -w "%{http_code}" "localhost:5221/api/brain/harness/pr-ownership?pr_number=abc"); [ "$CODE" = "400" ] && jq -e ".error|type==\"string\"" /tmp/o.json'

- [ ] [BEHAVIOR] [L1] B-04: 脚本 fail-closed 三态（Brain 5xx / 非法 JSON / 超时）均 SKIP（任一 MERGE 即失败）
  动作: PATH 注入 fake curl 制造三种故障，跑 should-auto-merge.sh
  预期观察: 三态 stdout 均以 SKIP 开头
  等待预算: 0s
  留证: failclosed-check.sh 逐态 PASS 行
  Test: manual:bash -c 'bash sprints/08111144-kernel-51740e13/tests/failclosed-check.sh'

- [ ] [BEHAVIOR] [L1] B-05: 脚本决策三态 owned→SKIP / not_owned→MERGE / 非cp-*→SKIP（不看标题）
  动作: PATH 注入 fake curl 控制 Brain 应答，跑 should-auto-merge.sh 三种输入
  预期观察: owned→SKIP、not_owned→MERGE、非cp-*→SKIP
  等待预算: 0s
  留证: decision-check.sh 逐条 PASS 行
  Test: manual:bash -c 'bash sprints/08111144-kernel-51740e13/tests/decision-check.sh'

- [ ] [BEHAVIOR] [L2] B-06: 回归红线——#4755/#4759 两分支经真 Brain 均判 owned → 脚本 SKIP（当天事故不重演）[接缝×2]
  动作: seed 两条 run（pr_url→/pull/4755、/pull/4759），以两 PR 号经真 Brain 跑脚本
  预期观察: 4755、4759 两次 stdout 均以 SKIP 开头
  等待预算: 0s
  留证: 两次脚本 stdout
  Test: manual:bash -c 'psql "$DB_URL" -c "INSERT INTO initiative_runs (initiative_id, pr_url) VALUES (gen_random_uuid(),'"'"'https://github.com/perfectuser21/cecelia/pull/4759'"'"')" >/dev/null; A=$(BRAIN_URL=http://localhost:5221 bash .github/workflows/scripts/should-auto-merge.sh cp-08101107-04e4690d 4755); B=$(BRAIN_URL=http://localhost:5221 bash .github/workflows/scripts/should-auto-merge.sh cp-08101246-643b5302 4759); echo "$A"|grep -q "^SKIP" && echo "$B"|grep -q "^SKIP"'

- [ ] [BEHAVIOR] [L2] B-07: kernel merge_pr 在 gh pr merge 之前置 harness-judge status=success（CLEAN 路径）
  动作: 真跑 kernel-handlers 单测（含新增置闸顺序断言）
  预期观察: execCmd 被以 statuses/<sha> state=success context=harness-judge 调用，且序号 < gh pr merge；全量单测绿
  等待预算: 120s
  留证: vitest 末 20 行含 passed
  Test: manual:bash -c 'cd packages/brain && npx vitest run src/orchestrator/__tests__/kernel-handlers.test.js 2>&1 | tail -20 | grep -qE "passed|✓"'
