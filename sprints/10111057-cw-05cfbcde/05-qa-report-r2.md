---
task_id: 05cfbcde-1108-4018-93d6-a48464324b11
step: evaluate
upstream: ["02-spec.md#Q-1", "02-spec.md#Q-2", "02-spec.md#Q-3", "02-spec.md#Q-4", "02-spec.md#Q-5", "02-spec.md#Q-6", "02-spec.md#Q-7"]
---
# QA 报告（第 2 轮，环境 http://localhost:5301）

本轮开始时间：2026-10-11T04:43:31Z（UTC）。所有 run_id 都是本轮用 uuidgen 新造的，不依赖库里已有数据。

## 环境判定

- 预览环境（PR 6275，进程 commit `dc1eabd3e`，与本分支 HEAD 相同，库 `cecelia_preview_6275`）探测结果：`POST /api/brain/spans` 发 `[]` 返回 **400**（不是 401/503）。查预览进程环境变量：**没有配 `CECELIA_INTERNAL_TOKEN`，也没有 `NODE_ENV`**，所以鉴权中间件按「未配 token + 非 production + loopback」放行本机请求。
- 因此：Q-1、Q-2 第 1 步、Q-3～Q-6 直接打预览环境（本机 loopback，不需要 token）。
- Q-2 第 2 步（不带 token / 错 token 应 401）在没配 token 的预览里测不出来，按规格约定改用**本机分支 Brain**（5299，`CECELIA_INTERNAL_TOKEN` 设为本地 QA 专用测试 token，库 `cecelia_test`）。**预览未配 token，鉴权部分改本机分支 Brain。**
- Q-7 按规格要求两端都在本机起：本分支 → 5299，`git worktree add /tmp/qa-main-6275 origin/main`（main=`d332cf3f4`）→ 5298，环境变量逐项相同、同库 `cecelia_test`，两端都过了就绪门。测完已停掉两个进程并删除 worktree。
- 生产 Brain（localhost:5221）全程没碰过。本任务没有 UI，没有用浏览器，所以没有截图。

```command
cd /Users/administrator/worktrees/cecelia-cw/qa-6275-2; date -u +%FT%TZ; curl -s -o /dev/null -w '%{http_code}\n' -X POST "http://localhost:5301/api/brain/spans" -H 'content-type: application/json' -d '[]'; curl -s http://localhost:5301/ | head -c 300; echo; ls /tmp/preview-*.pid 2>/dev/null; git log --oneline -1; git status --short
```
```output
2026-10-11T04:43:31Z
400
{"service":"cecelia-brain","status":"running","port":"5301"}
/tmp/preview-6101.pid
/tmp/preview-6105.pid
/tmp/preview-6117.pid
/tmp/preview-6275.pid
dc1eabd3e fix(brain): runs-read-smoke 守卫拒绝时 exit 1，不再静默冒充通过
```

```command
for p in 5299 5298; do ok=0; for i in $(seq 1 60); do curl -s http://127.0.0.1:$p/ | grep -q '"status":"running"' && { ok=1; break; }; sleep 1; done; echo "$p ready=$ok $(curl -s http://127.0.0.1:$p/)"; [ $ok = 1 ] || tail -n 20 /tmp/qa-brain-$p.log; done
```
```output
5299 ready=1 {"service":"cecelia-brain","status":"running","port":"5299"}
5298 ready=1 {"service":"cecelia-brain","status":"running","port":"5298"}
```

### T-1
对应: Q-1
verdict: PASS
说明：写入前 404 → POST span 返回 inserted=1 → 立刻用 URL 编码地址 GET 拿到 200，字段齐全、数值正确、没有 spans 键（第 1 次）。
```command
B=http://localhost:5301; RID="coding-workflow:$(uuidgen | tr A-Z a-z)"; ENC=$(python3 -c 'import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1],safe=""))' "$RID"); echo "RID=$RID"; C1=$(curl -s -o /dev/null -w '%{http_code}' "$B/api/brain/runs/$ENC"); echo "step1=$C1"; P=$(curl -s -w '\n%{http_code}' -X POST "$B/api/brain/spans" -H 'content-type: application/json' -H 'x-session-id: coding-workflow-runner' -d '{"run_id":"'"$RID"'","activity_id":"c0de0000-0000-4000-8000-000000000102","occurrence_key":"qa/spec/1","started_at":"2026-10-10T10:00:00.000Z","ended_at":"2026-10-10T10:00:05.000Z","executor_kind":"agent","outcome":"pass","tokens_in":100,"tokens_out":20,"cost_usd":0.125}'); echo "step2=$P"; G=$(curl -s -w '\n%{http_code}' "$B/api/brain/runs/$ENC"); echo "step3=$G"; [ "$C1" = 404 ] && [ "$(echo "$P" | tail -1)" = 200 ] && echo "$P" | sed '$d' | jq -e '.inserted==1' >/dev/null && [ "$(echo "$G" | tail -1)" = 200 ] && echo "$G" | sed '$d' | jq -e --arg r "$RID" '(keys as $ks | ["run_id","workflow_id","trigger_kind","started_at","ended_at","outcome","header_source","tokens_in","tokens_out","cost_usd"] | all(. as $k | $ks | index($k))) and .run_id==$r and .trigger_kind=="external" and .header_source=="spans" and .outcome=="pass" and .started_at=="2026-10-10T10:00:00.000Z" and .ended_at=="2026-10-10T10:00:05.000Z" and ((.cost_usd|tonumber)==0.125) and ((.tokens_in|tonumber)==100) and ((.tokens_out|tonumber)==20) and (has("spans")|not)'
```
```output
RID=coding-workflow:ed0d28c8-f72b-4319-9427-ad7c88243534
step1=404
step2={"inserted":1,"skipped":0,"count":1,"ids":["81d64ead-a40d-43ab-9706-0caadf27774b"]}
200
step3={"id":"909b24ff-0a01-4a71-9a47-c8082d9ca4d3","run_id":"coding-workflow:ed0d28c8-f72b-4319-9427-ad7c88243534","workflow_id":null,"trigger_kind":"external","trigger_ref":null,"schedule_entry_id":null,"task_run_id":null,"executor_kind":null,"executor_id":null,"started_at":"2026-10-10T10:00:00.000Z","ended_at":"2026-10-10T10:00:05.000Z","duration_ms":5000,"outcome":"pass","error":null,"model":null,"tokens_in":"100","tokens_out":"20","cost_usd":"0.125000","detail":null,"header_source":"spans","created_at":"2026-10-11T04:43:55.702Z","updated_at":"2026-10-11T04:43:55.702Z","notion_id":null,"notion_synced_at":null,"notion_digest":null}
200
true
```

### T-2
对应: Q-1
verdict: PASS
说明：Q-1 是写入后立刻读，算依赖时序的场景，所以跑了两次。这一条其实先执行（换了另一个 run_id），断言和 T-1 等价，只是 jq 多了一个永远为真的冗余子句，日期用了前缀比较，T-1 是后来整理过的版本。两次结果一致，不 FLAKY。
```command
B=http://localhost:5301; RID="coding-workflow:$(uuidgen | tr A-Z a-z)"; ENC=$(python3 -c 'import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1],safe=""))' "$RID"); echo "RID=$RID"; C1=$(curl -s -o /dev/null -w '%{http_code}' "$B/api/brain/runs/$ENC"); echo "step1=$C1"; P=$(curl -s -w '\n%{http_code}' -X POST "$B/api/brain/spans" -H 'content-type: application/json' -H 'x-session-id: coding-workflow-runner' -d '{"run_id":"'"$RID"'","activity_id":"c0de0000-0000-4000-8000-000000000102","occurrence_key":"qa/spec/1","started_at":"2026-10-10T10:00:00.000Z","ended_at":"2026-10-10T10:00:05.000Z","executor_kind":"agent","outcome":"pass","tokens_in":100,"tokens_out":20,"cost_usd":0.125}'); echo "step2=$P"; G=$(curl -s -w '\n%{http_code}' "$B/api/brain/runs/$ENC"); echo "step3=$G"; [ "$C1" = 404 ] && [ "$(echo "$P" | tail -1)" = 200 ] && echo "$P" | sed '$d' | jq -e '.inserted==1' >/dev/null && [ "$(echo "$G" | tail -1)" = 200 ] && echo "$G" | sed '$d' | jq -e --arg r "$RID" 'all(("run_id","workflow_id","trigger_kind","started_at","ended_at","outcome","header_source","tokens_in","tokens_out","cost_usd"); . as $k | true) and (keys as $ks | ["run_id","workflow_id","trigger_kind","started_at","ended_at","outcome","header_source","tokens_in","tokens_out","cost_usd"] | all(. as $k | $ks | index($k))) and .run_id==$r and .trigger_kind=="external" and .header_source=="spans" and .outcome=="pass" and (.started_at|startswith("2026-10-10T10:00:00")) and (.ended_at|startswith("2026-10-10T10:00:05")) and ((.cost_usd|tonumber)==0.125) and ((.tokens_in|tonumber)==100) and ((.tokens_out|tonumber)==20) and (has("spans")|not)'
```
```output
RID=coding-workflow:89bc1ed5-3255-4040-9c22-c7868407e698
step1=404
step2={"inserted":1,"skipped":0,"count":1,"ids":["a7c7fbdd-f527-41f2-8ea0-53f24aeae1b3"]}
200
step3={"id":"8b0b626a-7054-4c78-9d6a-eb30fa1c5b0f","run_id":"coding-workflow:89bc1ed5-3255-4040-9c22-c7868407e698","workflow_id":null,"trigger_kind":"external","trigger_ref":null,"schedule_entry_id":null,"task_run_id":null,"executor_kind":null,"executor_id":null,"started_at":"2026-10-10T10:00:00.000Z","ended_at":"2026-10-10T10:00:05.000Z","duration_ms":5000,"outcome":"pass","error":null,"model":null,"tokens_in":"100","tokens_out":"20","cost_usd":"0.125000","detail":null,"header_source":"spans","created_at":"2026-10-11T04:43:47.783Z","updated_at":"2026-10-11T04:43:47.783Z","notion_id":null,"notion_synced_at":null,"notion_digest":null}
200
true
```

### T-3
对应: Q-2
verdict: PASS
说明：第 1 步（预览）：路径里直接用裸冒号 GET 返回 200，内容和 URL 编码地址拿到的是同一条记录（id 相同），各字段都一样。
```command
B=http://localhost:5301; RID="coding-workflow:$(uuidgen | tr A-Z a-z)"; ENC=$(python3 -c 'import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1],safe=""))' "$RID"); curl -s -o /dev/null -w 'post=%{http_code}\n' -X POST "$B/api/brain/spans" -H 'content-type: application/json' -H 'x-session-id: coding-workflow-runner' -d '{"run_id":"'"$RID"'","activity_id":"c0de0000-0000-4000-8000-000000000102","occurrence_key":"qa/spec/1","started_at":"2026-10-10T10:00:00.000Z","ended_at":"2026-10-10T10:00:05.000Z","executor_kind":"agent","outcome":"pass","tokens_in":100,"tokens_out":20,"cost_usd":0.125}'; RAW=$(curl -s -w '\n%{http_code}' "$B/api/brain/runs/$RID"); EN=$(curl -s "$B/api/brain/runs/$ENC"); echo "raw=$RAW"; [ "$(echo "$RAW" | tail -1)" = 200 ] && jq -e -n --arg r "$RID" --argjson a "$(echo "$RAW" | sed '$d')" --argjson b "$EN" '$a.run_id==$r and $a.trigger_kind==$b.trigger_kind and $a.outcome==$b.outcome and $a.cost_usd==$b.cost_usd and $a.tokens_in==$b.tokens_in and $a.tokens_out==$b.tokens_out and $a.started_at==$b.started_at and $a.ended_at==$b.ended_at and $a.header_source==$b.header_source and $a.id==$b.id'
```
```output
post=200
raw={"id":"0ca1bc17-8d70-4604-8488-74c67198c496","run_id":"coding-workflow:2b6f1297-fa5e-43de-b277-9705ef49e7a6","workflow_id":null,"trigger_kind":"external","trigger_ref":null,"schedule_entry_id":null,"task_run_id":null,"executor_kind":null,"executor_id":null,"started_at":"2026-10-10T10:00:00.000Z","ended_at":"2026-10-10T10:00:05.000Z","duration_ms":5000,"outcome":"pass","error":null,"model":null,"tokens_in":"100","tokens_out":"20","cost_usd":"0.125000","detail":null,"header_source":"spans","created_at":"2026-10-11T04:44:02.227Z","updated_at":"2026-10-11T04:44:02.227Z","notion_id":null,"notion_synced_at":null,"notion_digest":null}
200
true
```

### T-4
对应: Q-2
verdict: PASS
说明：第 2 步（鉴权）。预览没配 token，测不出 401，所以**改用本机分支 Brain（5299，配了本地 QA 测试 token）**。带正确 token、裸冒号路径 → 200；不带 token → 401 UNAUTHORIZED；错 token → 401 UNAUTHORIZED。两个 401 的返回里都没有 run_id、cost_usd 等记录字段，提示是中文，能看懂。
```command
B=http://127.0.0.1:5299; TOKEN=qa-local-token; RID="coding-workflow:$(uuidgen | tr A-Z a-z)"; ENC=$(python3 -c 'import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1],safe=""))' "$RID"); curl -s -o /dev/null -w 'post=%{http_code}\n' -X POST "$B/api/brain/spans" -H 'content-type: application/json' -H 'x-session-id: coding-workflow-runner' -H "x-internal-token: $TOKEN" -d '{"run_id":"'"$RID"'","activity_id":"c0de0000-0000-4000-8000-000000000102","occurrence_key":"qa/spec/1","started_at":"2026-10-10T10:00:00.000Z","ended_at":"2026-10-10T10:00:05.000Z","executor_kind":"agent","outcome":"pass","tokens_in":100,"tokens_out":20,"cost_usd":0.125}'; RAW=$(curl -s -w '\n%{http_code}' -H "x-internal-token: $TOKEN" "$B/api/brain/runs/$RID"); NT=$(curl -s -w '\n%{http_code}' "$B/api/brain/runs/$ENC"); WT=$(curl -s -w '\n%{http_code}' -H 'x-internal-token: wrong' "$B/api/brain/runs/$ENC"); echo "raw_with_token=$(echo "$RAW"|tail -1) $(echo "$RAW"|sed '$d'|jq -c '{run_id,outcome,cost_usd}')"; echo "no_token=$(echo "$NT"|tail -1) $(echo "$NT"|sed '$d')"; echo "wrong_token=$(echo "$WT"|tail -1) $(echo "$WT"|sed '$d')"; [ "$(echo "$RAW"|tail -1)" = 200 ] && echo "$RAW"|sed '$d'|jq -e --arg r "$RID" '.run_id==$r and .outcome=="pass" and (.cost_usd|tonumber)==0.125' >/dev/null && for X in "$NT" "$WT"; do [ "$(echo "$X"|tail -1)" = 401 ] && echo "$X"|sed '$d'|jq -e '.error.code=="UNAUTHORIZED" and (has("run_id")|not) and (has("cost_usd")|not)' >/dev/null || exit 1; done && echo ALL_OK
```
```output
post=200
raw_with_token=200 {"run_id":"coding-workflow:cc1e6bf9-15e2-4437-b984-b5485d840142","outcome":"pass","cost_usd":"0.125000"}
no_token=401 {"success":false,"data":null,"error":{"code":"UNAUTHORIZED","message":"缺少 internal token（Authorization: Bearer <token> 或 X-Internal-Token）"}}
wrong_token=401 {"success":false,"data":null,"error":{"code":"UNAUTHORIZED","message":"internal token 无效"}}
ALL_OK
```

### T-5
对应: Q-3
verdict: PASS
说明：一次 POST 两条 span，故意把晚的放前面。`include=spans` 返回的两条按 started_at 升序排好（qa/a 在前，qa/b 在后），6 个字段都有，activity_id 正确，总记录 cost_usd 汇总为 0.3；不带 include、`include=foo` 时都是 200，而且 body 里没有 spans 键。
```command
B=http://localhost:5301; RID2="coding-workflow:$(uuidgen | tr A-Z a-z)"; ENC=$(python3 -c 'import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1],safe=""))' "$RID2"); A=c0de0000-0000-4000-8000-000000000102; P=$(curl -s -X POST "$B/api/brain/spans" -H 'content-type: application/json' -H 'x-session-id: coding-workflow-runner' -d '[{"run_id":"'"$RID2"'","activity_id":"'$A'","occurrence_key":"qa/b","started_at":"2026-10-10T11:00:10.000Z","ended_at":"2026-10-10T11:00:20.000Z","executor_kind":"agent","outcome":"pass","cost_usd":0.2},{"run_id":"'"$RID2"'","activity_id":"'$A'","occurrence_key":"qa/a","started_at":"2026-10-10T11:00:00.000Z","ended_at":"2026-10-10T11:00:05.000Z","executor_kind":"agent","outcome":"pass","cost_usd":0.1}]'); echo "post=$P"; S=$(curl -s -w '\n%{http_code}' "$B/api/brain/runs/$ENC?include=spans"); N=$(curl -s -w '\n%{http_code}' "$B/api/brain/runs/$ENC"); F=$(curl -s -w '\n%{http_code}' "$B/api/brain/runs/$ENC?include=foo"); echo "spans=$(echo "$S" | sed '$d' | jq -c '{code:'"$(echo "$S"|tail -1)"',cost_usd,spans:[.spans[]|{occurrence_key,activity_id,outcome,cost_usd,started_at,ended_at}]}')"; echo "plain=$(echo "$N"|tail -1) has_spans=$(echo "$N"|sed '$d'|jq 'has("spans")')"; echo "foo=$(echo "$F"|tail -1) has_spans=$(echo "$F"|sed '$d'|jq 'has("spans")')"; echo "$P" | jq -e '.inserted==2' >/dev/null && [ "$(echo "$S"|tail -1)" = 200 ] && [ "$(echo "$N"|tail -1)" = 200 ] && [ "$(echo "$F"|tail -1)" = 200 ] && echo "$N"|sed '$d'|jq -e 'has("spans")|not' >/dev/null && echo "$F"|sed '$d'|jq -e 'has("spans")|not' >/dev/null && echo "$S" | sed '$d' | jq -e --arg a "$A" '(.spans|length)==2 and .spans[0].occurrence_key=="qa/a" and .spans[1].occurrence_key=="qa/b" and all(.spans[]; has("occurrence_key") and has("activity_id") and has("outcome") and has("cost_usd") and has("started_at") and has("ended_at") and .activity_id==$a) and ((.cost_usd|tonumber)==0.3)'
```
```output
post={"inserted":2,"skipped":0,"count":2,"ids":["62e9798f-f447-4525-b016-0af8e145f88d","134cb1e2-4890-4f34-a7b8-75c23e719d10"]}
spans={"code":200,"cost_usd":"0.300000","spans":[{"occurrence_key":"qa/a","activity_id":"c0de0000-0000-4000-8000-000000000102","outcome":"pass","cost_usd":"0.100000","started_at":"2026-10-10T11:00:00.000Z","ended_at":"2026-10-10T11:00:05.000Z"},{"occurrence_key":"qa/b","activity_id":"c0de0000-0000-4000-8000-000000000102","outcome":"pass","cost_usd":"0.200000","started_at":"2026-10-10T11:00:10.000Z","ended_at":"2026-10-10T11:00:20.000Z"}]}
plain=200 has_spans=false
foo=200 has_spans=false
true
```

### T-6
对应: Q-4
verdict: PASS
说明：第 1 次。每次 POST 完立刻 GET，读到的都是最新汇总值：pass/0.1/spans → fail/0.15 → 终态 span 后 pass/0.16/owner → 同一条 span 重复上报 inserted=0，cost 仍是 0.16，没有重复计费。
```command
B=http://localhost:5301; RID3="coding-workflow:$(uuidgen | tr A-Z a-z)"; ENC=$(python3 -c 'import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1],safe=""))' "$RID3"); A=c0de0000-0000-4000-8000-000000000102; post(){ curl -s -X POST "$B/api/brain/spans" -H 'content-type: application/json' -H 'x-session-id: coding-workflow-runner' -d "$1"; }; S2='{"run_id":"'"$RID3"'","activity_id":"'$A'","occurrence_key":"qa/2","started_at":"2026-10-10T12:00:00.000Z","ended_at":"2026-10-10T12:00:03.000Z","executor_kind":"agent","outcome":"fail","cost_usd":0.05}'; P0=$(post '{"run_id":"'"$RID3"'","activity_id":"'$A'","occurrence_key":"qa/1","started_at":"2026-10-10T11:50:00.000Z","ended_at":"2026-10-10T11:50:02.000Z","executor_kind":"agent","outcome":"pass","cost_usd":0.1}'); G1=$(curl -s "$B/api/brain/runs/$ENC"); P2=$(post "$S2"); G2=$(curl -s "$B/api/brain/runs/$ENC"); P3=$(post '{"run_id":"'"$RID3"'","activity_id":"'$A'","occurrence_key":"qa/3","started_at":"2026-10-10T12:10:00.000Z","ended_at":"2026-10-10T12:10:01.000Z","executor_kind":"agent","outcome":"pass","cost_usd":0.01,"evidence":{"run_terminal":true}}'); G3=$(curl -s "$B/api/brain/runs/$ENC"); P4=$(post "$S2"); G4=$(curl -s "$B/api/brain/runs/$ENC"); for i in 1 2 3 4; do eval "g=\$G$i"; echo "step$i get=$(echo "$g" | jq -c '{outcome,cost_usd,header_source}')"; done; echo "post1=$P0"; echo "post2=$P2"; echo "post3=$P3"; echo "post4(dup)=$P4"; echo "$P0" | jq -e '.inserted==1' >/dev/null && echo "$P2" | jq -e '.inserted==1' >/dev/null && echo "$P3" | jq -e '.inserted==1' >/dev/null && echo "$P4" | jq -e '.inserted==0' >/dev/null && echo "$G1" | jq -e '.outcome=="pass" and (.cost_usd|tonumber)==0.1 and .header_source=="spans"' >/dev/null && echo "$G2" | jq -e '.outcome=="fail" and (.cost_usd|tonumber)==0.15' >/dev/null && echo "$G3" | jq -e '.outcome=="pass" and .header_source=="owner" and (.cost_usd|tonumber)==0.16' >/dev/null && echo "$G4" | jq -e '.outcome=="pass" and (.cost_usd|tonumber)==0.16'
```
```output
step1 get={"outcome":"pass","cost_usd":"0.100000","header_source":"spans"}
step2 get={"outcome":"fail","cost_usd":"0.150000","header_source":"spans"}
step3 get={"outcome":"pass","cost_usd":"0.160000","header_source":"owner"}
step4 get={"outcome":"pass","cost_usd":"0.160000","header_source":"owner"}
post1={"inserted":1,"skipped":0,"count":1,"ids":["f7984906-90d8-4a33-85fe-172fdef6fbcf"]}
post2={"inserted":1,"skipped":0,"count":1,"ids":["1d12a0b0-c1a7-4d39-b5d8-38db8855a5e5"]}
post3={"inserted":1,"skipped":0,"count":1,"ids":["77b3196f-a7f4-48b6-8387-61fbfaa17cc5"]}
post4(dup)={"inserted":0,"skipped":1,"count":1,"ids":[]}
true
```

### T-7
对应: Q-4
verdict: PASS
说明：第 2 次（同一条命令，新 run_id），结果和 T-6 完全一致，不 FLAKY。
```command
B=http://localhost:5301; RID3="coding-workflow:$(uuidgen | tr A-Z a-z)"; ENC=$(python3 -c 'import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1],safe=""))' "$RID3"); A=c0de0000-0000-4000-8000-000000000102; post(){ curl -s -X POST "$B/api/brain/spans" -H 'content-type: application/json' -H 'x-session-id: coding-workflow-runner' -d "$1"; }; S2='{"run_id":"'"$RID3"'","activity_id":"'$A'","occurrence_key":"qa/2","started_at":"2026-10-10T12:00:00.000Z","ended_at":"2026-10-10T12:00:03.000Z","executor_kind":"agent","outcome":"fail","cost_usd":0.05}'; P0=$(post '{"run_id":"'"$RID3"'","activity_id":"'$A'","occurrence_key":"qa/1","started_at":"2026-10-10T11:50:00.000Z","ended_at":"2026-10-10T11:50:02.000Z","executor_kind":"agent","outcome":"pass","cost_usd":0.1}'); G1=$(curl -s "$B/api/brain/runs/$ENC"); P2=$(post "$S2"); G2=$(curl -s "$B/api/brain/runs/$ENC"); P3=$(post '{"run_id":"'"$RID3"'","activity_id":"'$A'","occurrence_key":"qa/3","started_at":"2026-10-10T12:10:00.000Z","ended_at":"2026-10-10T12:10:01.000Z","executor_kind":"agent","outcome":"pass","cost_usd":0.01,"evidence":{"run_terminal":true}}'); G3=$(curl -s "$B/api/brain/runs/$ENC"); P4=$(post "$S2"); G4=$(curl -s "$B/api/brain/runs/$ENC"); for i in 1 2 3 4; do eval "g=\$G$i"; echo "step$i get=$(echo "$g" | jq -c '{outcome,cost_usd,header_source}')"; done; echo "post1=$P0"; echo "post2=$P2"; echo "post3=$P3"; echo "post4(dup)=$P4"; echo "$P0" | jq -e '.inserted==1' >/dev/null && echo "$P2" | jq -e '.inserted==1' >/dev/null && echo "$P3" | jq -e '.inserted==1' >/dev/null && echo "$P4" | jq -e '.inserted==0' >/dev/null && echo "$G1" | jq -e '.outcome=="pass" and (.cost_usd|tonumber)==0.1 and .header_source=="spans"' >/dev/null && echo "$G2" | jq -e '.outcome=="fail" and (.cost_usd|tonumber)==0.15' >/dev/null && echo "$G3" | jq -e '.outcome=="pass" and .header_source=="owner" and (.cost_usd|tonumber)==0.16' >/dev/null && echo "$G4" | jq -e '.outcome=="pass" and (.cost_usd|tonumber)==0.16'
```
```output
step1 get={"outcome":"pass","cost_usd":"0.100000","header_source":"spans"}
step2 get={"outcome":"fail","cost_usd":"0.150000","header_source":"spans"}
step3 get={"outcome":"pass","cost_usd":"0.160000","header_source":"owner"}
step4 get={"outcome":"pass","cost_usd":"0.160000","header_source":"owner"}
post1={"inserted":1,"skipped":0,"count":1,"ids":["d04bba8a-f05d-4817-bbbd-dcb7fc155fc2"]}
post2={"inserted":1,"skipped":0,"count":1,"ids":["66e86d5a-4b13-4c8d-97f8-71ca3ef97597"]}
post3={"inserted":1,"skipped":0,"count":1,"ids":["e0c64687-622f-4d17-874f-f6d6acac8479"]}
post4(dup)={"inserted":0,"skipped":1,"count":1,"ids":[]}
true
```

### T-8
对应: Q-5
verdict: PASS
说明：不存在的 run_id（带不带 include=spans）和 SQL 注入式输入都返回 404 和看得懂的 `run not found: ...`，没有 spans 键，没有 500。注入串被当成普通字符串原样查。
```command
B=http://localhost:5301; NORID="coding-workflow:$(uuidgen | tr A-Z a-z)"; ENC=$(python3 -c 'import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1],safe=""))' "$NORID"); ok=1; for u in "$B/api/brain/runs/$ENC" "$B/api/brain/runs/$ENC?include=spans" "$B/api/brain/runs/x%27%20OR%20%271%27%3D%271"; do R=$(curl -s -w '\n%{http_code}' "$u"); echo "$(echo "$R"|tail -1) $(echo "$R"|sed '$d')"; [ "$(echo "$R"|tail -1)" = 404 ] && echo "$R"|sed '$d'|jq -e '(.error|type=="string") and (.error|test("not found")) and (has("spans")|not)' >/dev/null || ok=0; done; [ $ok = 1 ]
```
```output
404 {"error":"run not found: coding-workflow:e38bab5f-d1d9-4e92-b857-2695e9a42e3e"}
404 {"error":"run not found: coding-workflow:e38bab5f-d1d9-4e92-b857-2695e9a42e3e"}
404 {"error":"run not found: x' OR '1'='1"}
```

### T-9
对应: Q-6
verdict: PASS
说明：空白、`/runs/`、`/runs`、201 个字符、非法编码都返回 400，提示分别是「必填」「最多 200 字符」「URL 编码不合法」；恰好 200 个字符返回 404。没有一个是 500。（输出每行截到 200 字符，所以 200 字符那行被截断了。）
```command
B=http://localhost:5301; ok=1; chk(){ R=$(curl -s -w '\n%{http_code}' "$1"); C=$(echo "$R"|tail -1); J=$(echo "$R"|sed '$d'); echo "$C $J" | cut -c1-200; [ "$C" = "$2" ] && echo "$J" | jq -e --arg p "$3" '(.error|type=="string") and (.error|test($p))' >/dev/null || ok=0; }; chk "$B/api/brain/runs/%20%20" 400 required; chk "$B/api/brain/runs/" 400 required; chk "$B/api/brain/runs" 400 required; chk "$B/api/brain/runs/$(printf 'a%.0s' $(seq 1 201))" 400 "200 characters"; chk "$B/api/brain/runs/$(printf 'a%.0s' $(seq 1 200))" 404 "not found"; chk "$B/api/brain/runs/%E0%A4%A" 400 "URL encoding"; [ $ok = 1 ]
```
```output
400 {"error":"run_id is required"}
400 {"error":"run_id is required"}
400 {"error":"run_id is required"}
400 {"error":"run_id must be at most 200 characters"}
404 {"error":"run not found: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
400 {"error":"run_id is not valid URL encoding"}
```

### T-10
对应: Q-7
verdict: PASS
说明：本机两端对比（5299 = 本分支，5298 = origin/main `d332cf3f4`，环境变量逐项相同、同一个库）。原有两段接口 6 个请求，两端的状态码和 error.code 完全相同：不带 token 3 个都是 401 UNAUTHORIZED；带 token 时 GET definition 是 404 RUN_DEFINITION_UNKNOWN，GET reconciliation 是 200 且有 evidence_status，POST definition（空 body）两端都是 422 RELEASE_INPUT_INVALID。新接口在本分支 200 且 run_id 正确，main 上是 Express 默认的 404「Cannot GET」，说明这是新接口，而且它没有把原来的两段接口吞掉。（输出里「-」表示没有 error.code。另外：同场景我先跑过一版脚本，那版 curl 参数拼错了，两端都回 400，作为脚本错误作废，不算产品结果。）
```command
TOKEN=qa-local-token; RID4="coding-workflow:$(uuidgen | tr A-Z a-z)"; ENC=$(python3 -c 'import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1],safe=""))' "$RID4"); curl -s -o /dev/null -w 'post=%{http_code}\n' -X POST "http://127.0.0.1:5299/api/brain/spans" -H 'content-type: application/json' -H 'x-session-id: coding-workflow-runner' -H "x-internal-token: $TOKEN" -d '{"run_id":"'"$RID4"'","activity_id":"c0de0000-0000-4000-8000-000000000102","occurrence_key":"qa/spec/1","started_at":"2026-10-10T10:00:00.000Z","ended_at":"2026-10-10T10:00:05.000Z","executor_kind":"agent","outcome":"pass","tokens_in":100,"tokens_out":20,"cost_usd":0.125}'; ok=1; for port in 5299 5298; do U="http://127.0.0.1:$port/api/brain/runs/$ENC"; r1=$(curl -s -w ' %{http_code}' "$U/definition"); r2=$(curl -s -w ' %{http_code}' "$U/reconciliation"); r3=$(curl -s -w ' %{http_code}' -X POST -H 'content-type: application/json' -d '{}' "$U/definition"); t1=$(curl -s -w ' %{http_code}' -H "x-internal-token: $TOKEN" "$U/definition"); t2=$(curl -s -w ' %{http_code}' -H "x-internal-token: $TOKEN" "$U/reconciliation"); t3=$(curl -s -w ' %{http_code}' -X POST -H 'content-type: application/json' -H "x-internal-token: $TOKEN" -d '{}' "$U/definition"); S=""; for v in "$r1" "$r2" "$r3" "$t1" "$t2" "$t3"; do c=${v##* }; j=${v% *}; S="$S|$c:$(echo "$j" | jq -r '(.error.code? // "-") + (if ([..|objects|has("evidence_status")]|any) then "+evidence_status" else "" end)')"; done; echo "$port $S"; eval "SIG_$port='$S'"; done; [ "$SIG_5299" = "$SIG_5298" ] || ok=0; echo "$SIG_5299" | grep -q '^|401:UNAUTHORIZED|401:UNAUTHORIZED|401:UNAUTHORIZED|404:RUN_DEFINITION_UNKNOWN|200:-+evidence_status|' || ok=0; NB=$(curl -s -w ' %{http_code}' -H "x-internal-token: $TOKEN" "http://127.0.0.1:5299/api/brain/runs/$ENC"); NM=$(curl -s -o /dev/null -w '%{http_code}' -H "x-internal-token: $TOKEN" "http://127.0.0.1:5298/api/brain/runs/$ENC"); echo "new GET branch=${NB##* } $(echo "${NB% *}" | jq -c '{run_id}') ; main=$NM $(curl -s -H "x-internal-token: $TOKEN" "http://127.0.0.1:5298/api/brain/runs/$ENC" | grep -o 'Cannot GET[^<]*')"; [ $ok = 1 ] && [ "${NB##* }" = 200 ] && echo "${NB% *}" | jq -e --arg r "$RID4" '.run_id==$r' >/dev/null && [ "$NM" = 404 ] && echo ALL_OK
```
```output
post=200
5299 |401:UNAUTHORIZED|401:UNAUTHORIZED|401:UNAUTHORIZED|404:RUN_DEFINITION_UNKNOWN|200:-+evidence_status|422:RELEASE_INPUT_INVALID
5298 |401:UNAUTHORIZED|401:UNAUTHORIZED|401:UNAUTHORIZED|404:RUN_DEFINITION_UNKNOWN|200:-+evidence_status|422:RELEASE_INPUT_INVALID
new GET branch=200 {"run_id":"coding-workflow:71315f93-ba60-403d-899c-3e6747739afe"} ; main=404 Cannot GET /api/brain/runs/coding-workflow%3A71315f93-ba60-403d-899c-3e6747739afe
ALL_OK
```

### X-1
对应: Q-3, Q-1, I-2
verdict: PASS
场景：多种 include 写法、run_id 前后带空格、20 个并发 GET 同时读同一条记录。`include=foo,spans` 和 `include=a&include=spans` 都正常附上 spans；前后带空格的 run_id 被 trim 后能查到；20 个并发读结果完全一致。
```command
B=http://localhost:5301; RID="coding-workflow:$(uuidgen | tr A-Z a-z)"; ENC=$(python3 -c 'import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1],safe=""))' "$RID"); curl -s -o /dev/null -w 'post=%{http_code}\n' -X POST "$B/api/brain/spans" -H 'content-type: application/json' -H 'x-session-id: coding-workflow-runner' -d '{"run_id":"'"$RID"'","activity_id":"c0de0000-0000-4000-8000-000000000102","occurrence_key":"qa/x/1","started_at":"2026-10-10T10:00:00.000Z","ended_at":"2026-10-10T10:00:05.000Z","executor_kind":"agent","outcome":"pass","cost_usd":0.125}'; A=$(curl -s "$B/api/brain/runs/$ENC?include=foo,spans" | jq -c '{n:(.spans|length)}'); Bx=$(curl -s "$B/api/brain/runs/$ENC?include=a&include=spans" | jq -c '{n:(.spans|length)}'); C=$(curl -s "$B/api/brain/runs/%20$ENC%20" | jq -c '{run_id}'); echo "include=foo,spans -> $A"; echo "include=a&include=spans -> $Bx"; echo "padded-with-spaces -> $C"; seq 1 20 | xargs -P 20 -I{} curl -s "$B/api/brain/runs/$ENC" | jq -c '{run_id,cost_usd,outcome}' | sort | uniq -c; [ "$A" = '{"n":1}' ] && [ "$Bx" = '{"n":1}' ] && [ "$(seq 1 20 | xargs -P 20 -I{} curl -s "$B/api/brain/runs/$ENC" | jq -c '{run_id,cost_usd,outcome}' | sort -u | wc -l | tr -d ' ')" = 1 ] && echo "$C" | jq -e --arg r "$RID" '.run_id==$r'
```
```output
post=200
include=foo,spans -> {"n":1}
include=a&include=spans -> {"n":1}
padded-with-spaces -> {"run_id":"coding-workflow:70b4c7a6-030a-49d9-a625-932414b146e9"}
  20 {"run_id":"coding-workflow:70b4c7a6-030a-49d9-a625-932414b146e9","cost_usd":"0.125000","outcome":"pass"}
true
```

### X-2
对应: I-3
verdict: PASS
场景：各种奇怪的 run_id 和请求方式一起扫一遍。编码斜杠 `a%2Fb`、emoji 都按普通值查，返回 404 和看得懂的提示；POST 到新路径是 Express 默认 404（新接口只读，正常）；201 个多字节字符「é」返回 400。`stats` 和 `a%00b` 两个 500 分别记在 X-3、X-4。
```command
B=http://localhost:5301; for p in "a%2Fb" "stats" "%F0%9F%98%80" "a%00b" ; do echo "$p -> $(curl -s -w ' [%{http_code}]' "$B/api/brain/runs/$p" | head -c 220)"; done; echo "POST /runs/x -> $(curl -s -w ' [%{http_code}]' -X POST -H 'content-type: application/json' -d '{}' "$B/api/brain/runs/x" | head -c 200)"; echo "201 emoji-chars -> $(curl -s -o /dev/null -w '%{http_code}' "$B/api/brain/runs/$(python3 -c 'import urllib.parse;print(urllib.parse.quote("é"*201))')")"
```
```output
a%2Fb -> {"error":"run not found: a/b"} [404]
stats -> {"error":"invalid input syntax for type uuid: \"runs\""} [500]
%F0%9F%98%80 -> {"error":"run not found: 😀"} [404]
a%00b -> {"error":"invalid byte sequence for encoding \"UTF8\": 0x00"} [500]
POST /runs/x -> <!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Error</title>
</head>
<body>
<pre>Cannot POST /api/brain/runs/x</pre>
</body>
</html>
 [404]
201 emoji-chars -> 400
```

### X-3
对应: I-3
严重度: 建议
场景：调用方查一个含 NUL 字节的 run_id（`a%00b`，URL 编码本身合法）。返回 **500**，并直接把 Postgres 原始报错 `invalid byte sequence for encoding "UTF8": 0x00` 暴露给用户，而不是 400/404。I-3 要求的是「不存在 → 404，不返回 500」。真实 run_id（`coding-workflow:<uuid>`）不会有 NUL，所以只算体验/健壮性问题，但入口校验漏了这一类输入。
verdict: FAIL
```command
B=http://localhost:5301; R=$(curl -s -w '\n%{http_code}' "$B/api/brain/runs/a%00b"); echo "$R"; [ "$(echo "$R"|tail -1)" != 500 ]
```
```output
{"error":"invalid byte sequence for encoding \"UTF8\": 0x00"}
500
```

### X-4
对应: I-3
严重度: 建议
场景：run_id 正好是 `stats` 时，`GET /api/brain/runs/stats` 返回 500 `invalid input syntax for type uuid: "runs"`。原因是请求被更早挂载的 contentPipelineRoutes 接走了。规格「未覆盖真实链路」里已经把这个列为已知遮蔽、本次不处理；真实 run_id 格式不受影响。这里如实记录用户实际会看到的结果。
verdict: FAIL
```command
B=http://localhost:5301; R=$(curl -s -w '\n%{http_code}' "$B/api/brain/runs/stats"); echo "$R"; [ "$(echo "$R"|tail -1)" != 500 ]
```
```output
{"error":"invalid input syntax for type uuid: \"runs\""}
500
```

## 小结

| 项 | 结果 |
|---|---|
| Q-1～Q-7（T-1～T-10） | 全部 PASS（Q-1、Q-4 各跑两次，结果一致） |
| 环境说明 | 预览未配 token：Q-2 鉴权部分改用本机分支 Brain；Q-7 按规格在本机 main 与分支两端对比 |
| 探索 | X-1、X-2 PASS；X-3（NUL 字节 → 500）、X-4（`stats` 被遮蔽 → 500，已知）为「建议」级 FAIL |
| 阻断 / 重要 | 无 |
