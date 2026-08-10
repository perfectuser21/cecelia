contract_branch: cp-harness-propose-r2-9806d99a-r7c5bcc5d-a15
sprint_dir: sprints/08112000-merge-authority-single-gate

---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: 合并权收归单一裁决闸（harness-judge required check）

**范围**: 新增 Brain PR 归属求证端点 + 通道1 should-auto-merge.sh 判据换 Brain 求证(fail-closed) + kernel mergeGate 放行后置 harness-judge=success + 通道3 改造说明（不改 zenithjoy-skills）。不改 mergeGate 判定/evaluator/judge/gear。
**大小**: M

## Invariant 映射（铁律逐条 → BEHAVIOR）

- INV-1 [裁决唯一闸] harness-owned PR judge PASS 前物理不可合并 → **B-05**（kernel 仅在 mergeGate 全过后置 check=success；required check 平台阻断真验并入未覆盖清单 fixture）
- INV-2 [fail-closed] Brain 异常一律 SKIP 绝不 MERGE → **B-04**（连接被拒 exit7）+ **B-07**（超时 exit28，R1-1 补齐 PRD 明列的『超时』分支）
- INV-3 [不回归/dev] Brain 明确 not-owned 的 cp-* 必 MERGE → **B-06**（+ 端点侧 B-02 owned:false）+ **A-05**（ci.yml 对 not-owned 置 harness-judge=success，防 required check 卡死 /dev，R1-2）
- INV-4 [归属凭 Brain 非标题] 只凭 initiative_runs 记录 → **B-01**（owned 判定来自 seed 的 initiative_runs 行，非标题/分支正则）

## ARTIFACT 条目

- [x] [ARTIFACT] should-auto-merge.sh 判据改为 Brain 求证（含 fail-closed），不再以 feat(harness): 标题决定
  Test: node -e "const c=require('fs').readFileSync('.github/workflows/scripts/should-auto-merge.sh','utf8');if(!/pr-ownership/.test(c)||!/BRAIN_URL/.test(c))process.exit(1)"

- [x] [ARTIFACT] Brain 归属求证端点 pr-ownership 已挂载
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/harness.js','utf8');if(!/pr-ownership/.test(c))process.exit(1)"

- [x] [ARTIFACT] kernel merge_pr 置 harness-judge commit status
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/orchestrator/kernel-handlers.js','utf8');if(!/harness-judge/.test(c))process.exit(1)"

- [x] [ARTIFACT] 通道3 engine-pr-watchdog 改造说明产出
  Test: node -e "const c=require('fs').readFileSync('sprints/08112000-merge-authority-single-gate/engine-pr-watchdog-改造说明.md','utf8');if(!/pr-ownership/.test(c))process.exit(1)"

- [x] [ARTIFACT] A-05: ci.yml auto-merge job 对 not-owned(MERGE) PR 置 harness-judge=success（防 required check 永久卡死 /dev 红线兜底，R1-2）
  Test: node -e "const c=require('fs').readFileSync('.github/workflows/ci.yml','utf8');if(!/context=harness-judge/.test(c)||!/state=success/.test(c))process.exit(1)"

## BEHAVIOR 条目（内嵌 manual:bash 单行命令）

- [x] [BEHAVIOR] [L2] B-01: seed 的 harness run 被归属端点判为 owned:true（归属凭 initiative_runs，非标题）
  动作: psql 向 initiative_runs(v2)+tasks 插一条 pr_branch=$BR 的 run，再 GET /pr-ownership?branch=$BR
  预期观察: 响应 owned==true 且 run_id 为字符串、pr_url 命中 seed 的 pull URL
  等待预算: 0s
  留证: curl 响应 JSON + psql seed 的 run id（进 evidence）
  Test: manual:bash -c 'D="${DB_URL:-postgresql://localhost/cecelia}"; BR="cp-dodb01-$$-$RANDOM"; RID=$(psql "$D" -tAc "WITH t AS (INSERT INTO tasks(id,title,task_type,status,payload) VALUES(gen_random_uuid(),'"'"'dod-b01'"'"','"'"'harness_generate'"'"','"'"'in_progress'"'"',jsonb_build_object('"'"'pr_branch'"'"','"'"'$BR'"'"')) RETURNING id) INSERT INTO initiative_runs(id,initiative_id,phase,orchestrator_version,current_task_id,created_source,pr_url,started_at) SELECT t.id,gen_random_uuid(),'"'"'evaluate'"'"','"'"'v2'"'"',t.id,'"'"'kernel_dispatch'"'"','"'"'https://github.com/perfectuser21/cecelia/pull/999999'"'"',NOW() FROM t RETURNING id" | tr -d " "); trap "psql \"$D\" -q -c \"DELETE FROM initiative_runs WHERE id='"'"'$RID'"'"'\"; psql \"$D\" -q -c \"DELETE FROM tasks WHERE id='"'"'$RID'"'"'\"" EXIT; curl -sf "localhost:5221/api/brain/harness/pr-ownership?branch=$BR" | jq -e ".owned==true and (.run_id|type==\"string\") and (.pr_url|test(\"pull/999999\"))"'
  期望: exit 0

- [x] [BEHAVIOR] [L2] B-02: 不存在的 /dev 分支被判 owned:false（不回归 /dev 的端点侧信号）
  动作: GET /pr-ownership?branch=<随机不存在分支>
  预期观察: 响应 owned==false（run_id/matched_by 为 null）
  等待预算: 0s
  留证: curl 响应 JSON 进 evidence
  Test: manual:bash -c 'curl -sf "localhost:5221/api/brain/harness/pr-ownership?branch=cp-dev-not-a-real-run-$RANDOM" | jq -e ".owned==false and .run_id==null"'
  期望: exit 0

- [x] [BEHAVIOR] [L2] B-03: branch/pr_url 均缺失时端点返回 HTTP 400（error path）
  动作: GET /pr-ownership 不带任何参数
  预期观察: HTTP 状态码 400
  等待预算: 0s
  留证: http_code 输出进 evidence
  Test: manual:bash -c 'curl -s -o /dev/null -w "%{http_code}" "localhost:5221/api/brain/harness/pr-ownership" | grep -qx 400'
  期望: exit 0

- [x] [BEHAVIOR] [L2] B-04: 通道1 fail-closed——Brain 不可达时 should-auto-merge.sh 输出 SKIP 且绝不 MERGE（红线）[接缝×2]
  动作: 以指向未监听端口的 BRAIN_URL 运行 should-auto-merge.sh cp-* 分支
  预期观察: stdout 以 SKIP 开头，且全程不含 MERGE
  等待预算: 0s
  留证: 脚本 stdout 进 log_tail
  Test: manual:bash -c 'O=$(BRAIN_URL="http://127.0.0.1:1" bash .github/workflows/scripts/should-auto-merge.sh "cp-x-abc" "fix(brain): x" || true); printf "%s" "$O" | grep -q "^SKIP" && ! printf "%s" "$O" | grep -q "MERGE"'
  期望: exit 0

- [x] [BEHAVIOR] [L1] B-05: kernel merge_pr 在 gh pr merge 之前先置 harness-judge=success（裁决唯一闸执行点）
  动作: node 调真实 createKernelHandlers().merge_pr（spy execCmd），检查发出的命令序
  预期观察: 存在 statuses/<head_sha>+harness-judge+state=success 命令，且其序号早于 pr merge 命令
  等待预算: 0s
  留证: node 打印 kernel-check OK 进 log_tail
  Test: manual:bash -c 'node --input-type=module -e "import {createKernelHandlers} from \"./packages/brain/src/orchestrator/kernel-handlers.js\"; const calls=[]; const h=createKernelHandlers({execCmd:c=>{calls.push(String(c));return {status:0};}}); await h.merge_pr({observed:{pr:{url:\"https://github.com/o/r/pull/9\",head_sha:\"deadbeef\",mergeStateStatus:\"CLEAN\"}}}); const si=calls.findIndex(c=>c.includes(\"statuses/deadbeef\")&&c.includes(\"harness-judge\")&&c.includes(\"state=success\")); const mi=calls.findIndex(c=>c.includes(\"pr merge\")); if(si<0){process.exit(1)} if(mi>=0&&si>mi){process.exit(1)} console.log(\"kernel-check OK\")"'
  期望: 输出 kernel-check OK

- [x] [BEHAVIOR] [L2] B-06: 通道1 owned=true → SKIP（用真实 stub Brain server，禁 mock HTTP 边）[接缝×2]
  动作: 起真实 node http stub 返回 owned:true，指向它运行 should-auto-merge.sh
  预期观察: 脚本 stdout 以 SKIP 开头（不抢跑 auto-merge，交 harness gate）
  等待预算: 0s
  留证: 脚本 stdout 进 log_tail
  Test: manual:bash -c 'node -e "const s=require(\"http\").createServer((q,r)=>{r.writeHead(200,{\"content-type\":\"application/json\"});r.end(JSON.stringify({owned:true,run_id:\"r1\",pr_url:\"https://x/pull/1\",matched_by:\"branch\"}))});s.listen(0,\"127.0.0.1\",()=>{const p=s.address().port;const o=require(\"child_process\").execFileSync(\"bash\",[\".github/workflows/scripts/should-auto-merge.sh\",\"cp-x-abc\",\"fix(brain): x\"],{env:{...process.env,BRAIN_URL:\"http://127.0.0.1:\"+p},encoding:\"utf8\"});s.close();if(!/^SKIP/.test(o.trim()))process.exit(1);console.log(\"stub-skip OK\")})"'
  期望: 输出 stub-skip OK

- [x] [BEHAVIOR] [L2] B-07: 通道1 fail-closed——Brain 接受连接后超时无响应时脚本走 curl --max-time 超时路径输出 SKIP 且绝不 MERGE（红线，R1-1；与 B-04 连接被拒 exit7 是不同代码路径）[接缝×2]
  动作: 起真实 node http stub（接受连接后永不 res.end，永不响应），以 BRAIN_TIMEOUT=2 指向它运行 should-auto-merge.sh cp-* 分支
  预期观察: 脚本在有限超时内经 curl --max-time 触发 exit28（非 exit7），输出以 SKIP 开头，且全程不含 MERGE；若脚本漏配 --max-time 则 node 驱动会挂满评估预算（即缺 -m 逼出信号）
  等待预算: 5s
  留证: node 打印 timeout-skip OK 进 log_tail
  Test: manual:bash -c 'node -e "const s=require(\"http\").createServer(()=>{});s.listen(0,\"127.0.0.1\",()=>{const p=s.address().port;let o=\"\";try{o=require(\"child_process\").execFileSync(\"bash\",[\".github/workflows/scripts/should-auto-merge.sh\",\"cp-x-abc\",\"fix(brain): x\"],{env:{...process.env,BRAIN_URL:\"http://127.0.0.1:\"+p,BRAIN_TIMEOUT:\"2\"},encoding:\"utf8\"})}catch(e){o=String(e.stdout||\"\")}s.close();if(!/^SKIP/.test(o.trim())||/MERGE/.test(o)){process.exit(1)}console.log(\"timeout-skip OK\")})"'
  期望: 输出 timeout-skip OK
