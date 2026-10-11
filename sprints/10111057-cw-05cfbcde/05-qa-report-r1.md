---
task_id: 05cfbcde-1108-4018-93d6-a48464324b11
step: evaluate
upstream: ["02-spec.md#Q-1", "02-spec.md#Q-2", "02-spec.md#Q-3", "02-spec.md#Q-4", "02-spec.md#Q-5", "02-spec.md#Q-6", "02-spec.md#Q-7"]
---
# QA 报告（第 1 轮，环境 http://localhost:5301）

环境判定：对预览环境 `POST /api/brain/spans` 发 `[]` 返回 400（`body must be a span or a non-empty array of spans`），既非 401 也非 503——预览进程未配 `CECELIA_INTERNAL_TOKEN`、未设 `NODE_ENV`，loopback 请求免 token 直接放行。因此 Q-1、Q-2 第 1 步、Q-3～Q-6 直接打预览环境（不带 token）；Q-2 第 2 步（鉴权 401）在预览上无法构造，按规格约定改用本机分支 Brain（`127.0.0.1:5299`，`CECELIA_INTERNAL_TOKEN=qa-local-token`，库 `cecelia_test`）；Q-7 按规格在本机起分支 5299 与 `origin/main` 临时 worktree 5298，两端环境变量逐项相同、同库。全程未访问 localhost:5221 或任何生产地址。

| 场景 | 条目 | 结论 |
|---|---|---|
| Q-1 | T-1 | PASS |
| Q-2 | T-2、T-3 | PASS |
| Q-3 | T-4 | PASS |
| Q-4 | T-5、T-6（两次一致） | PASS |
| Q-5 | T-7 | PASS |
| Q-6 | T-8 | PASS |
| Q-7 | T-9 | PASS |
| 探索 | X-1、X-2 | PASS |

### T-1
对应: Q-1
verdict: PASS
说明：写入前 404；POST span 后立即 GET（URL 编码冒号），200，十个字段齐全，trigger_kind=external、header_source=spans、outcome=pass、cost_usd=0.125、tokens 100/20，无 spans 键。
```command
set -e
B=http://localhost:5301
RID="coding-workflow:$(uuidgen | tr A-Z a-z)"
ENC=$(python3 -c 'import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1],safe=""))' "$RID")
echo "RID=$RID"
C1=$(curl -s -o /dev/null -w '%{http_code}' "$B/api/brain/runs/$ENC"); echo "before=$C1"
P=$(curl -s -X POST "$B/api/brain/spans" -H 'content-type: application/json' -H 'x-session-id: coding-workflow-runner' -d '{"run_id":"'"$RID"'","activity_id":"c0de0000-0000-4000-8000-000000000102","occurrence_key":"qa/spec/1","started_at":"2026-10-10T10:00:00.000Z","ended_at":"2026-10-10T10:00:05.000Z","executor_kind":"agent","outcome":"pass","tokens_in":100,"tokens_out":20,"cost_usd":0.125}'); echo "post=$P"
G=$(curl -s -w '\n%{http_code}' "$B/api/brain/runs/$ENC"); echo "get=$G"
[ "$C1" = 404 ]
echo "$P" | jq -e '.inserted == 1' >/dev/null
[ "$(echo "$G" | tail -n1)" = 200 ]
echo "$G" | sed '$d' | jq -e --arg r "$RID" '(["run_id","workflow_id","trigger_kind","started_at","ended_at","outcome","header_source","tokens_in","tokens_out","cost_usd"]|all(. as $k|$k as $kk|true)) and ([ "run_id","workflow_id","trigger_kind","started_at","ended_at","outcome","header_source","tokens_in","tokens_out","cost_usd"] - keys == []) and .run_id==$r and .trigger_kind=="external" and .header_source=="spans" and .outcome=="pass" and (.started_at|startswith("2026-10-10T10:00:00")) and (.ended_at|startswith("2026-10-10T10:00:05")) and (.cost_usd|tonumber)==0.125 and (.tokens_in|tonumber)==100 and (.tokens_out|tonumber)==20 and (has("spans")|not)' && echo ASSERT_OK
```
```output
RID=coding-workflow:f5ab1846-a35d-474e-90dd-e650bbe76dd5
before=404
post={"inserted":1,"skipped":0,"count":1,"ids":["c1eb478c-ffce-4af5-9b8c-1b1ed50fdbdf"]}
get={"id":"b57dd7ab-9ab3-40c9-8885-049ec0abc74a","run_id":"coding-workflow:f5ab1846-a35d-474e-90dd-e650bbe76dd5","workflow_id":null,"trigger_kind":"external","trigger_ref":null,"schedule_entry_id":null,"task_run_id":null,"executor_kind":null,"executor_id":null,"started_at":"2026-10-10T10:00:00.000Z","ended_at":"2026-10-10T10:00:05.000Z","duration_ms":5000,"outcome":"pass","error":null,"model":null,"tokens_in":"100","tokens_out":"20","cost_usd":"0.125000","detail":null,"header_source":"spans","created_at":"2026-10-11T04:07:10.034Z","updated_at":"2026-10-11T04:07:10.034Z","notion_id":null,"notion_synced_at":null,"notion_digest":null}
200
true
ASSERT_OK
```

### T-2
对应: Q-2
verdict: PASS
说明：路径里裸冒号（不编码）GET，200，run_id 原样、字段值与 T-1 同形一致。
```command
set -e
B=http://localhost:5301
RID="coding-workflow:$(uuidgen | tr A-Z a-z)"
echo "RID=$RID"
P=$(curl -s -X POST "$B/api/brain/spans" -H 'content-type: application/json' -H 'x-session-id: coding-workflow-runner' -d '{"run_id":"'"$RID"'","activity_id":"c0de0000-0000-4000-8000-000000000102","occurrence_key":"qa/spec/1","started_at":"2026-10-10T10:00:00.000Z","ended_at":"2026-10-10T10:00:05.000Z","executor_kind":"agent","outcome":"pass","tokens_in":100,"tokens_out":20,"cost_usd":0.125}'); echo "post=$P"
G=$(curl -s -w '\n%{http_code}' "$B/api/brain/runs/$RID"); echo "get_raw_colon=$G"
echo "$P" | jq -e '.inserted == 1' >/dev/null
[ "$(echo "$G" | tail -n1)" = 200 ]
echo "$G" | sed '$d' | jq -e --arg r "$RID" '.run_id==$r and .trigger_kind=="external" and .header_source=="spans" and .outcome=="pass" and (.cost_usd|tonumber)==0.125 and (.tokens_in|tonumber)==100 and (.tokens_out|tonumber)==20 and (has("spans")|not)' && echo ASSERT_OK
```
```output
RID=coding-workflow:2b08256f-4a68-4163-a792-534526306485
post={"inserted":1,"skipped":0,"count":1,"ids":["2d5aca1c-9b87-4ff0-995f-b6d5887c93e1"]}
get_raw_colon={"id":"fbfea068-08ae-4c50-bab6-931435e0f0ba","run_id":"coding-workflow:2b08256f-4a68-4163-a792-534526306485","workflow_id":null,"trigger_kind":"external","trigger_ref":null,"schedule_entry_id":null,"task_run_id":null,"executor_kind":null,"executor_id":null,"started_at":"2026-10-10T10:00:00.000Z","ended_at":"2026-10-10T10:00:05.000Z","duration_ms":5000,"outcome":"pass","error":null,"model":null,"tokens_in":"100","tokens_out":"20","cost_usd":"0.125000","detail":null,"header_source":"spans","created_at":"2026-10-11T04:07:16.769Z","updated_at":"2026-10-11T04:07:16.769Z","notion_id":null,"notion_synced_at":null,"notion_digest":null}
200
true
ASSERT_OK
```

### T-3
对应: Q-2
verdict: PASS
说明：预览未配 token、loopback 免鉴权，401 场景无法在预览构造，按规格改本机分支 Brain（5299，token=qa-local-token）。带 token 裸冒号 GET 200；不带 token、错 token 均 401 `UNAUTHORIZED`，body 不含 run_id/cost_usd。
```command
set -e
B=http://127.0.0.1:5299
RID="coding-workflow:$(uuidgen | tr A-Z a-z)"
ENC=$(python3 -c 'import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1],safe=""))' "$RID")
echo "RID=$RID"
P=$(curl -s -X POST "$B/api/brain/spans" -H 'content-type: application/json' -H 'x-session-id: coding-workflow-runner' -H "x-internal-token: qa-local-token" -d '{"run_id":"'"$RID"'","activity_id":"c0de0000-0000-4000-8000-000000000102","occurrence_key":"qa/spec/1","started_at":"2026-10-10T10:00:00.000Z","ended_at":"2026-10-10T10:00:05.000Z","executor_kind":"agent","outcome":"pass","tokens_in":100,"tokens_out":20,"cost_usd":0.125}'); echo "post=$P"
G0=$(curl -s -w '\n%{http_code}' -H "x-internal-token: qa-local-token" "$B/api/brain/runs/$RID"); echo "token_raw_colon=$(echo "$G0" | sed '$d' | jq -c '{run_id,outcome,cost_usd,header_source}') $(echo "$G0" | tail -n1)"
G1=$(curl -s -w '\n%{http_code}' "$B/api/brain/runs/$ENC"); echo "no_token=$G1"
G2=$(curl -s -w '\n%{http_code}' -H "x-internal-token: wrong" "$B/api/brain/runs/$ENC"); echo "wrong_token=$G2"
echo "$P" | jq -e '.inserted == 1' >/dev/null
[ "$(echo "$G0" | tail -n1)" = 200 ]
echo "$G0" | sed '$d' | jq -e --arg r "$RID" '.run_id==$r and .outcome=="pass" and (.cost_usd|tonumber)==0.125' >/dev/null
for g in "$G1" "$G2"; do [ "$(echo "$g" | tail -n1)" = 401 ]; echo "$g" | sed '$d' | jq -e '.error.code=="UNAUTHORIZED" and (has("run_id")|not) and (has("cost_usd")|not)' >/dev/null; done && echo ASSERT_OK
```
```output
RID=coding-workflow:42e35af1-1393-44e1-81a0-5ff7b44dde9b
post={"inserted":1,"skipped":0,"count":1,"ids":["0e7d009b-0ba3-4c57-83bf-971896d707f5"]}
token_raw_colon={"run_id":"coding-workflow:42e35af1-1393-44e1-81a0-5ff7b44dde9b","outcome":"pass","cost_usd":"0.125000","header_source":"spans"} 200
no_token={"success":false,"data":null,"error":{"code":"UNAUTHORIZED","message":"缺少 internal token（Authorization: Bearer <token> 或 X-Internal-Token）"}}
401
wrong_token={"success":false,"data":null,"error":{"code":"UNAUTHORIZED","message":"internal token 无效"}}
401
ASSERT_OK
```

### T-4
对应: Q-3
verdict: PASS
说明：乱序写入两条 span，`include=spans` 返回长度 2、按 started_at 升序（qa/a 在前），字段齐全、activity_id 正确、顶层 cost_usd=0.3；不带 include 与 `include=foo` 都没有 spans 键。
```command
set -e
B=http://localhost:5301
RID2="coding-workflow:$(uuidgen | tr A-Z a-z)"
ENC=$(python3 -c 'import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1],safe=""))' "$RID2")
echo "RID2=$RID2"
A='"activity_id":"c0de0000-0000-4000-8000-000000000102","executor_kind":"agent"'
P=$(curl -s -X POST "$B/api/brain/spans" -H 'content-type: application/json' -H 'x-session-id: coding-workflow-runner' -d '[{"run_id":"'"$RID2"'",'"$A"',"occurrence_key":"qa/b","started_at":"2026-10-10T11:00:10.000Z","ended_at":"2026-10-10T11:00:20.000Z","outcome":"pass","cost_usd":0.2},{"run_id":"'"$RID2"'",'"$A"',"occurrence_key":"qa/a","started_at":"2026-10-10T11:00:00.000Z","ended_at":"2026-10-10T11:00:05.000Z","outcome":"pass","cost_usd":0.1}]'); echo "post=$P"
G1=$(curl -s -w '\n%{http_code}' "$B/api/brain/runs/$ENC?include=spans"); echo "include_spans=$G1"
G2=$(curl -s -w '\n%{http_code}' "$B/api/brain/runs/$ENC"); echo "no_include=$G2"
G3=$(curl -s -w '\n%{http_code}' "$B/api/brain/runs/$ENC?include=foo"); echo "include_foo=$G3"
echo "$P" | jq -e '.inserted == 2' >/dev/null
for g in "$G1" "$G2" "$G3"; do [ "$(echo "$g" | tail -n1)" = 200 ]; done
echo "$G1" | sed '$d' | jq -e '(.spans|length)==2 and .spans[0].occurrence_key=="qa/a" and .spans[1].occurrence_key=="qa/b" and (.spans|all(has("occurrence_key") and has("activity_id") and has("outcome") and has("cost_usd") and has("started_at") and has("ended_at") and .activity_id=="c0de0000-0000-4000-8000-000000000102")) and ((.cost_usd|tonumber)*1000|round)==300' >/dev/null
echo "$G2" | sed '$d' | jq -e 'has("spans")|not' >/dev/null
echo "$G3" | sed '$d' | jq -e 'has("spans")|not' >/dev/null && echo ASSERT_OK
```
```output
RID2=coding-workflow:0170a676-8a0b-4e8f-ba77-4395060db276
post={"inserted":2,"skipped":0,"count":2,"ids":["bb948e65-db13-465c-9493-cd338b2a5797","856b8e34-e1ed-4fa1-8ad3-f000336621f9"]}
include_spans={"id":"055fdd80-7749-4fd8-84b5-5fd371b5def6","run_id":"coding-workflow:0170a676-8a0b-4e8f-ba77-4395060db276","workflow_id":null,"trigger_kind":"external","trigger_ref":null,"schedule_entry_id":null,"task_run_id":null,"executor_kind":null,"executor_id":null,"started_at":"2026-10-10T11:00:00.000Z","ended_at":"2026-10-10T11:00:20.000Z","duration_ms":20000,"outcome":"pass","error":null,"model":null,"tokens_in":null,"tokens_out":null,"cost_usd":"0.300000","detail":null,"header_source":"spans","created_at":"2026-10-11T04:07:23.386Z","updated_at":"2026-10-11T04:07:23.386Z","notion_id":null,"notion_synced_at":null,"notion_digest":null,"spans":[{"id":"856b8e34-e1ed-4fa1-8ad3-f000336621f9","run_id":"coding-workflow:0170a676-8a0b-4e8f-ba77-4395060db276","workflow_id":null,"activity_id":"c0de0000-0000-4000-8000-000000000102","step_id":null,"enabler_id":null,"started_at":"2026-10-10T11:00:00.000Z","ended_at":"2026-10-10T11:00:05.000Z","duration_ms":5000,"wait_ms":null,"executor_kind":"agent","executor_id":null,"model":null,"tokens_in":null,"tokens_out":null,"cost_usd":"0.100000","attempts":1,"fallback":false,"outcome":"pass","evidence":null,"created_at":"2026-10-11T04:07:23.386Z","occurrence_key":"qa/a","payload_sha256":"9c865c148db635ed3da72fecad64a989363ad2307e714511cf8975e91f5f65b4","identity_protocol":1,"run_binding_id":null,"reference_id":null,"workflow_definition_version_id":null,"activity_definition_version_id":null,"attempt_key":null,"enabler_call_id":null,"parent_span_id":null,"span_level":"activity"},{"id":"bb948e65-db13-465c-9493-cd338b2a5797","run_id":"coding-workflow:0170a676-8a0b-4e8f-ba77-4395060db276","workflow_id":null,"activity_id":"c0de0000-0000-4000-8000-000000000102","step_id":null,"enabler_id":null,"started_at":"2026-10-10T11:00:10.000Z","ended_at":"2026-10-10T11:00:20.000Z","duration_ms":10000,"wait_ms":null,"executor_kind":"agent","executor_id":null,"model":null,"tokens_in":null,"tokens_out":null,"cost_usd":"0.200000","attempts":1,"fallback":false,"outcome":"pass","evidence":null,"created_at":"2026-10-11T04:07:23.386Z","occurrence_key":"qa/b","payload_sha256":"1f711c8db1954d18a03823b1debfd6232f57220a2d699a66fd3f54029778e5ef","identity_protocol":1,"run_binding_id":null,"reference_id":null,"workflow_definition_version_id":null,"activity_definition_version_id":null,"attempt_key":null,"enabler_call_id":null,"parent_span_id":null,"span_level":"activity"}]}
200
no_include={"id":"055fdd80-7749-4fd8-84b5-5fd371b5def6","run_id":"coding-workflow:0170a676-8a0b-4e8f-ba77-4395060db276","workflow_id":null,"trigger_kind":"external","trigger_ref":null,"schedule_entry_id":null,"task_run_id":null,"executor_kind":null,"executor_id":null,"started_at":"2026-10-10T11:00:00.000Z","ended_at":"2026-10-10T11:00:20.000Z","duration_ms":20000,"outcome":"pass","error":null,"model":null,"tokens_in":null,"tokens_out":null,"cost_usd":"0.300000","detail":null,"header_source":"spans","created_at":"2026-10-11T04:07:23.386Z","updated_at":"2026-10-11T04:07:23.386Z","notion_id":null,"notion_synced_at":null,"notion_digest":null}
200
include_foo={"id":"055fdd80-7749-4fd8-84b5-5fd371b5def6","run_id":"coding-workflow:0170a676-8a0b-4e8f-ba77-4395060db276","workflow_id":null,"trigger_kind":"external","trigger_ref":null,"schedule_entry_id":null,"task_run_id":null,"executor_kind":null,"executor_id":null,"started_at":"2026-10-10T11:00:00.000Z","ended_at":"2026-10-10T11:00:20.000Z","duration_ms":20000,"outcome":"pass","error":null,"model":null,"tokens_in":null,"tokens_out":null,"cost_usd":"0.300000","detail":null,"header_source":"spans","created_at":"2026-10-11T04:07:23.386Z","updated_at":"2026-10-11T04:07:23.386Z","notion_id":null,"notion_synced_at":null,"notion_digest":null}
200
ASSERT_OK
```

### T-5
对应: Q-4
verdict: PASS
说明：第 1 次。每次 POST 后立即 GET：pass/0.1/spans → fail/0.15 → 终态 span 后 pass/0.16/owner → 重复上报 inserted=0，仍 pass/0.16。
```command
set -e
B=http://localhost:5301
RID3="coding-workflow:$(uuidgen | tr A-Z a-z)"
ENC=$(python3 -c 'import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1],safe=""))' "$RID3")
echo "RID3=$RID3"
post() { curl -s -X POST "$B/api/brain/spans" -H 'content-type: application/json' -H 'x-session-id: coding-workflow-runner' -d "$1"; }
get() { curl -s "$B/api/brain/runs/$ENC" | jq -c '{outcome,cost_usd,header_source}'; }
S='"run_id":"'"$RID3"'","activity_id":"c0de0000-0000-4000-8000-000000000102","executor_kind":"agent"'
P1=$(post '{'"$S"',"occurrence_key":"qa/1","started_at":"2026-10-10T11:50:00.000Z","ended_at":"2026-10-10T11:50:02.000Z","outcome":"pass","cost_usd":0.1}'); echo "post1=$P1"
G1=$(get); echo "get1=$G1"
SPAN2='{'"$S"',"occurrence_key":"qa/2","started_at":"2026-10-10T12:00:00.000Z","ended_at":"2026-10-10T12:00:03.000Z","outcome":"fail","cost_usd":0.05}'
P2=$(post "$SPAN2"); echo "post2=$P2"
G2=$(get); echo "get2=$G2"
P3=$(post '{'"$S"',"occurrence_key":"qa/3","started_at":"2026-10-10T12:10:00.000Z","ended_at":"2026-10-10T12:10:01.000Z","outcome":"pass","cost_usd":0.01,"evidence":{"run_terminal":true}}'); echo "post3=$P3"
G3=$(get); echo "get3=$G3"
P4=$(post "$SPAN2"); echo "post4_dup=$P4"
G4=$(get); echo "get4=$G4"
echo "$G1" | jq -e '.outcome=="pass" and ((.cost_usd|tonumber)*1000|round)==100 and .header_source=="spans"' >/dev/null
echo "$G2" | jq -e '.outcome=="fail" and ((.cost_usd|tonumber)*1000|round)==150' >/dev/null
echo "$G3" | jq -e '.outcome=="pass" and .header_source=="owner" and ((.cost_usd|tonumber)*1000|round)==160' >/dev/null
echo "$P4" | jq -e '.inserted==0' >/dev/null
echo "$G4" | jq -e '.outcome=="pass" and ((.cost_usd|tonumber)*1000|round)==160' >/dev/null && echo ASSERT_OK
```
```output
RID3=coding-workflow:92b6836d-7001-4f7b-899c-79e298a7dc7e
post1={"inserted":1,"skipped":0,"count":1,"ids":["06c7b323-08e4-4c2b-86e4-1b2b803173b4"]}
get1={"outcome":"pass","cost_usd":"0.100000","header_source":"spans"}
post2={"inserted":1,"skipped":0,"count":1,"ids":["e8828ddc-0810-4b85-88be-8fb1ec66952f"]}
get2={"outcome":"fail","cost_usd":"0.150000","header_source":"spans"}
post3={"inserted":1,"skipped":0,"count":1,"ids":["becfcc8b-ccca-42de-a8c1-ceea3839bd81"]}
get3={"outcome":"pass","cost_usd":"0.160000","header_source":"owner"}
post4_dup={"inserted":0,"skipped":1,"count":1,"ids":[]}
get4={"outcome":"pass","cost_usd":"0.160000","header_source":"owner"}
ASSERT_OK
```

### T-6
对应: Q-4
verdict: PASS
说明：第 2 次（写后立即读属时序相关，同一命令重跑），结果与 T-5 完全一致，非 FLAKY。
```command
set -e
B=http://localhost:5301
RID3="coding-workflow:$(uuidgen | tr A-Z a-z)"
ENC=$(python3 -c 'import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1],safe=""))' "$RID3")
echo "RID3=$RID3"
post() { curl -s -X POST "$B/api/brain/spans" -H 'content-type: application/json' -H 'x-session-id: coding-workflow-runner' -d "$1"; }
get() { curl -s "$B/api/brain/runs/$ENC" | jq -c '{outcome,cost_usd,header_source}'; }
S='"run_id":"'"$RID3"'","activity_id":"c0de0000-0000-4000-8000-000000000102","executor_kind":"agent"'
P1=$(post '{'"$S"',"occurrence_key":"qa/1","started_at":"2026-10-10T11:50:00.000Z","ended_at":"2026-10-10T11:50:02.000Z","outcome":"pass","cost_usd":0.1}'); echo "post1=$P1"
G1=$(get); echo "get1=$G1"
SPAN2='{'"$S"',"occurrence_key":"qa/2","started_at":"2026-10-10T12:00:00.000Z","ended_at":"2026-10-10T12:00:03.000Z","outcome":"fail","cost_usd":0.05}'
P2=$(post "$SPAN2"); echo "post2=$P2"
G2=$(get); echo "get2=$G2"
P3=$(post '{'"$S"',"occurrence_key":"qa/3","started_at":"2026-10-10T12:10:00.000Z","ended_at":"2026-10-10T12:10:01.000Z","outcome":"pass","cost_usd":0.01,"evidence":{"run_terminal":true}}'); echo "post3=$P3"
G3=$(get); echo "get3=$G3"
P4=$(post "$SPAN2"); echo "post4_dup=$P4"
G4=$(get); echo "get4=$G4"
echo "$G1" | jq -e '.outcome=="pass" and ((.cost_usd|tonumber)*1000|round)==100 and .header_source=="spans"' >/dev/null
echo "$G2" | jq -e '.outcome=="fail" and ((.cost_usd|tonumber)*1000|round)==150' >/dev/null
echo "$G3" | jq -e '.outcome=="pass" and .header_source=="owner" and ((.cost_usd|tonumber)*1000|round)==160' >/dev/null
echo "$P4" | jq -e '.inserted==0' >/dev/null
echo "$G4" | jq -e '.outcome=="pass" and ((.cost_usd|tonumber)*1000|round)==160' >/dev/null && echo ASSERT_OK
```
```output
RID3=coding-workflow:06913ecb-4e60-4967-b459-fb5d290cb782
post1={"inserted":1,"skipped":0,"count":1,"ids":["37d06abe-8d47-44c8-8475-deb5ca9c6e37"]}
get1={"outcome":"pass","cost_usd":"0.100000","header_source":"spans"}
post2={"inserted":1,"skipped":0,"count":1,"ids":["18e67bdf-5cb5-4da6-8d31-3f694fa342f3"]}
get2={"outcome":"fail","cost_usd":"0.150000","header_source":"spans"}
post3={"inserted":1,"skipped":0,"count":1,"ids":["6eb4f7ee-2027-4da3-b391-319ad83bf38e"]}
get3={"outcome":"pass","cost_usd":"0.160000","header_source":"owner"}
post4_dup={"inserted":0,"skipped":1,"count":1,"ids":[]}
get4={"outcome":"pass","cost_usd":"0.160000","header_source":"owner"}
ASSERT_OK
```

### T-7
对应: Q-5
verdict: PASS
说明：不存在的 run_id（带/不带 include=spans）与 SQL 注入式输入都 404，JSON `error` 含 `not found`，无 spans 键，没有 500。
```command
set -e
B=http://localhost:5301
NORID="coding-workflow:$(uuidgen | tr A-Z a-z)"
ENC=$(python3 -c 'import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1],safe=""))' "$NORID")
for u in "$B/api/brain/runs/$ENC" "$B/api/brain/runs/$ENC?include=spans" "$B/api/brain/runs/x%27%20OR%20%271%27%3D%271"; do
  R=$(curl -s -w '\n%{http_code}' "$u"); echo "$R"
  [ "$(echo "$R" | tail -n1)" = 404 ]
  echo "$R" | sed '$d' | jq -e '(.error|type)=="string" and (.error|test("not found")) and (has("spans")|not)' >/dev/null
done && echo ASSERT_OK
```
```output
{"error":"run not found: coding-workflow:48188d5d-912a-493f-8d19-d6cf90da8994"}
404
{"error":"run not found: coding-workflow:48188d5d-912a-493f-8d19-d6cf90da8994"}
404
{"error":"run not found: x' OR '1'='1"}
404
ASSERT_OK
```

### T-8
对应: Q-6
verdict: PASS
说明：空白、`/runs/`、`/runs`、201 字符、非法编码均 400 且错误说人话；恰好 200 字符为 404。无 500。
```command
set -e
B=http://localhost:5301
chk() { R=$(curl -s -w '\n%{http_code}' "$1"); echo "[$2] $R"; [ "$(echo "$R" | tail -n1)" = "$2" ] && echo "$R" | sed '$d' | jq -e '(.error|type)=="string" and (.error|length)>0' >/dev/null; }
chk "$B/api/brain/runs/%20%20" 400
chk "$B/api/brain/runs/" 400
chk "$B/api/brain/runs" 400
chk "$B/api/brain/runs/$(printf 'a%.0s' $(seq 1 201))" 400
chk "$B/api/brain/runs/$(printf 'a%.0s' $(seq 1 200))" 404
chk "$B/api/brain/runs/%E0%A4%A" 400
echo ASSERT_OK
```
```output
[400] {"error":"run_id is required"}
400
[400] {"error":"run_id is required"}
400
[400] {"error":"run_id is required"}
400
[400] {"error":"run_id must be at most 200 characters"}
400
[404] {"error":"run not found: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}
404
[400] {"error":"run_id is not valid URL encoding"}
400
ASSERT_OK
```

### T-9
对应: Q-7
verdict: PASS
说明：基线 = `git worktree add /tmp/qa-main-6275 origin/main`（d332cf3f4，无 runs-read.js）起在 5298；本分支起在 5299；两端同一组环境变量（`DB_NAME=cecelia_test`、`CECELIA_INTERNAL_TOKEN=qa-local-token`、`NODE_ENV=development` 等），均过就绪门（`port 5299 ready=1` / `port 5298 ready=1`）。6 组请求状态码与 `error.code` 两端逐一相同：不带 token 三个 401 UNAUTHORIZED；带 token definition 404 RUN_DEFINITION_UNKNOWN、reconciliation 200 含 evidence_status、POST definition 空 body 两端都是 422 RELEASE_INPUT_INVALID。新接口本分支 200，main 上 `Cannot GET`（404）。（注：此前一次同类脚本因 zsh 下 `set -- $req` 不分词，请求误打到根路径，属我方脚本错误，已改为显式参数重跑，下面为重跑的真实结果。）
```command
set -e
RID4="coding-workflow:$(uuidgen | tr A-Z a-z)"
ENC=$(python3 -c 'import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1],safe=""))' "$RID4")
echo "RID4=$RID4"
P=$(curl -s -X POST "http://127.0.0.1:5299/api/brain/spans" -H 'content-type: application/json' -H 'x-session-id: coding-workflow-runner' -H "x-internal-token: qa-local-token" -d '{"run_id":"'"$RID4"'","activity_id":"c0de0000-0000-4000-8000-000000000102","occurrence_key":"qa/spec/1","started_at":"2026-10-10T10:00:00.000Z","ended_at":"2026-10-10T10:00:05.000Z","executor_kind":"agent","outcome":"pass","cost_usd":0.125}'); echo "post=$P"
echo "$P" | jq -e '.inserted == 1' >/dev/null
sig() { # port tokenflag method subpath
  if [ "$2" = tok ]; then TH="x-internal-token: qa-local-token"; else TH="x-noop: 1"; fi
  if [ "$3" = POST ]; then R=$(curl -s -w '\n%{http_code}' -X POST -H 'content-type: application/json' -H "$TH" -d '{}' "http://127.0.0.1:$1/api/brain/runs/$ENC/$4"); else R=$(curl -s -w '\n%{http_code}' -H "$TH" "http://127.0.0.1:$1/api/brain/runs/$ENC/$4"); fi
  echo "$(echo "$R" | tail -n1) code=$(echo "$R" | sed '$d' | jq -r '.error.code? // "-"') evidence_status=$(echo "$R" | sed '$d' | jq -r 'has("evidence_status")')"
}
FAIL=0
cmp() { a=$(sig 5299 $1 $2 $3); b=$(sig 5298 $1 $2 $3); echo "$1 $2 $3: branch=[$a] main=[$b]"; [ "$a" = "$b" ] || FAIL=1; echo "$a" | grep -q "^$4" || FAIL=1; }
cmp notok GET definition '401 code=UNAUTHORIZED'
cmp notok GET reconciliation '401 code=UNAUTHORIZED'
cmp notok POST definition '401 code=UNAUTHORIZED'
cmp tok GET definition '404 code=RUN_DEFINITION_UNKNOWN'
cmp tok GET reconciliation '200 code=- evidence_status=true'
cmp tok POST definition ''
NB=$(curl -s -w '\n%{http_code}' -H "x-internal-token: qa-local-token" "http://127.0.0.1:5299/api/brain/runs/$ENC"); echo "branch_new_get=$(echo "$NB" | sed '$d' | jq -c '{run_id}') $(echo "$NB" | tail -n1)"
NM=$(curl -s -w '\n%{http_code}' -H "x-internal-token: qa-local-token" "http://127.0.0.1:5298/api/brain/runs/$ENC"); echo "main_new_get=$(echo "$NM" | grep -o 'Cannot GET[^<]*') $(echo "$NM" | tail -n1)"
[ "$(echo "$NB" | tail -n1)" = 200 ] || FAIL=1
echo "$NB" | sed '$d' | jq -e --arg r "$RID4" '.run_id==$r' >/dev/null || FAIL=1
if echo "$NM" | sed '$d' | jq -e --arg r "$RID4" '.run_id==$r' >/dev/null 2>&1; then FAIL=1; fi
[ $FAIL = 0 ] && echo ASSERT_OK
```
```output
RID4=coding-workflow:2ad0a5f6-7745-43c1-94fe-0fc2af04ff24
post={"inserted":1,"skipped":0,"count":1,"ids":["f285e26b-b5a1-4567-83c8-eb4c7ceeec0c"]}
notok GET definition: branch=[401 code=UNAUTHORIZED evidence_status=false] main=[401 code=UNAUTHORIZED evidence_status=false]
notok GET reconciliation: branch=[401 code=UNAUTHORIZED evidence_status=false] main=[401 code=UNAUTHORIZED evidence_status=false]
notok POST definition: branch=[401 code=UNAUTHORIZED evidence_status=false] main=[401 code=UNAUTHORIZED evidence_status=false]
tok GET definition: branch=[404 code=RUN_DEFINITION_UNKNOWN evidence_status=false] main=[404 code=RUN_DEFINITION_UNKNOWN evidence_status=false]
tok GET reconciliation: branch=[200 code=- evidence_status=true] main=[200 code=- evidence_status=true]
tok POST definition: branch=[422 code=RELEASE_INPUT_INVALID evidence_status=false] main=[422 code=RELEASE_INPUT_INVALID evidence_status=false]
branch_new_get={"run_id":"coding-workflow:2ad0a5f6-7745-43c1-94fe-0fc2af04ff24"} 200
main_new_get=Cannot GET /api/brain/runs/coding-workflow%3A2ad0a5f6-7745-43c1-94fe-0fc2af04ff24 404
ASSERT_OK
```

### X-1
对应: Q-3, I-2
verdict: PASS
场景: 用户把 include 写成重复参数（`include=a&include=spans`）或逗号加空格（`include=foo, spans`）都能拿到 spans；20 个并发带 include=spans 的读请求全部 200，无异常。
```command
set -e
B=http://localhost:5301
RID="coding-workflow:$(uuidgen | tr A-Z a-z)"
ENC=$(python3 -c 'import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1],safe=""))' "$RID")
P=$(curl -s -X POST "$B/api/brain/spans" -H 'content-type: application/json' -H 'x-session-id: coding-workflow-runner' -d '{"run_id":"'"$RID"'","activity_id":"c0de0000-0000-4000-8000-000000000102","occurrence_key":"qa/x","started_at":"2026-10-10T10:00:00.000Z","ended_at":"2026-10-10T10:00:05.000Z","executor_kind":"agent","outcome":"pass","cost_usd":0.125}'); echo "post=$P"
A=$(curl -s "$B/api/brain/runs/$ENC?include=a&include=spans" | jq -c '{has_spans:has("spans"),n:(.spans|length?)}'); echo "include_array=$A"
C=$(curl -s "$B/api/brain/runs/$ENC?include=foo,%20spans" | jq -c '{has_spans:has("spans"),n:(.spans|length?)}'); echo "include_csv_space=$C"
CODES=$(for i in $(seq 1 20); do curl -s -o /dev/null -w '%{http_code}\n' "$B/api/brain/runs/$ENC?include=spans" & done; wait); echo "concurrent20=$(echo "$CODES" | sort | uniq -c | tr -s ' ' | tr '\n' ';')"
echo "$P" | jq -e '.inserted==1' >/dev/null
echo "$A" | jq -e '.has_spans and .n==1' >/dev/null
echo "$C" | jq -e '.has_spans and .n==1' >/dev/null
[ "$(echo "$CODES" | grep -c '^200$')" = 20 ] && echo ASSERT_OK
```
```output
post={"inserted":1,"skipped":0,"count":1,"ids":["bbcdbb90-a379-47d2-b4be-265f52132336"]}
include_array={"has_spans":true,"n":1}
include_csv_space={"has_spans":true,"n":1}
concurrent20= 20 200;
ASSERT_OK
```

### X-2
对应: I-1, I-5
verdict: PASS
场景: run_id 含斜杠（`qa/slash:<uuid>`，编码为 `%2F`）时新接口仍按单段取到记录；预览环境上同一 run 的原有两段路由 `/reconciliation` 照常 200，未被新接口吞掉。
```command
set -e
B=http://localhost:5301
RID="qa/slash:$(uuidgen | tr A-Z a-z)"
ENC=$(python3 -c 'import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1],safe=""))' "$RID")
echo "ENC=$ENC"
P=$(curl -s -X POST "$B/api/brain/spans" -H 'content-type: application/json' -H 'x-session-id: coding-workflow-runner' -d '{"run_id":"'"$RID"'","activity_id":"c0de0000-0000-4000-8000-000000000102","occurrence_key":"qa/x","started_at":"2026-10-10T10:00:00.000Z","ended_at":"2026-10-10T10:00:05.000Z","executor_kind":"agent","outcome":"pass","cost_usd":0.125}'); echo "post=$P"
G=$(curl -s -w '\n%{http_code}' "$B/api/brain/runs/$ENC"); echo "slash_get=$(echo "$G" | sed '$d' | jq -c '{run_id}') $(echo "$G" | tail -n1)"
R=$(curl -s -w '\n%{http_code}' "$B/api/brain/runs/$ENC/reconciliation"); echo "preview_reconciliation=$(echo "$R" | sed '$d' | jq -c '{run_id,evidence_status}') $(echo "$R" | tail -n1)"
echo "$P" | jq -e '.inserted==1' >/dev/null
[ "$(echo "$G" | tail -n1)" = 200 ] && echo "$G" | sed '$d' | jq -e --arg r "$RID" '.run_id==$r' >/dev/null
[ "$(echo "$R" | tail -n1)" = 200 ] && echo "$R" | sed '$d' | jq -e 'has("evidence_status")' >/dev/null && echo ASSERT_OK
```
```output
ENC=qa%2Fslash%3A4b5df3a7-4cad-4b3b-83c2-16016110e1ba
post={"inserted":1,"skipped":0,"count":1,"ids":["fa7b30c4-cfbb-4b1c-9310-92f5a50d8ff4"]}
slash_get={"run_id":"qa/slash:4b5df3a7-4cad-4b3b-83c2-16016110e1ba"} 200
preview_reconciliation={"run_id":"qa/slash:4b5df3a7-4cad-4b3b-83c2-16016110e1ba","evidence_status":"unknown"} 200
ASSERT_OK
```
