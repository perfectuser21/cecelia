---
task_id: 05cfbcde-1108-4018-93d6-a48464324b11
step: evaluate
upstream: ["02-spec.md#Q-1", "02-spec.md#Q-2", "02-spec.md#Q-3", "02-spec.md#Q-4", "02-spec.md#Q-5", "02-spec.md#Q-6", "02-spec.md#Q-7"]
---
# QA 报告（第 3 轮，环境 http://localhost:5301）

环境说明：
- 本轮开始时间 2026-10-11T05:22:30Z（UTC）。所有 run_id 都是本轮现场用 uuidgen 生成的，不依赖库里已有数据。
- 预览环境探测（见 X-1）：`POST /api/brain/spans` 传 `[]` 返回 400（不是 401/503）。预览进程没有设置 `CECELIA_INTERNAL_TOKEN`，也没设 `NODE_ENV`，所以 QA 机器走 loopback 可以直接访问。Q-1、Q-3～Q-6 以及 Q-2 第 1 步都打的是预览环境 http://localhost:5301，请求不带 token。
- 预览没配 token，验不了鉴权，所以 Q-2 第 2 步（不带 token / 错 token 应 401）**改在本机分支 Brain 上做**（http://127.0.0.1:5299，`CECELIA_INTERNAL_TOKEN=qa-local-token`，库 `cecelia_test`，启动命令与规格约定一致）。Q-7 按规格要求，两端都在本机起：本分支在 5299，`origin/main`（d332cf3f4）的临时 worktree 在 5298，环境变量逐项相同，都过了就绪门。测完已停掉进程，删掉了临时 worktree。
- 全程没有访问 localhost:5221 或任何生产地址。本功能没有 UI，没用浏览器，所以没有截图。

### T-1
对应: Q-1
verdict: PASS
说明：异步/时序类场景，第 1 次。写入前 404 → POST span 返回 inserted=1 → 紧接着 GET 返回 200，字段齐全，值都对，且没有 spans 键。
```command
B=http://localhost:5301; RID="coding-workflow:$(uuidgen | tr A-Z a-z)"; ENC=$(python3 -c 'import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1],safe=""))' "$RID"); echo "RID=$RID"
S1=$(curl -s -o /dev/null -w '%{http_code}' "$B/api/brain/runs/$ENC"); echo "step1=$S1"
P=$(curl -s -w '\n%{http_code}' -X POST "$B/api/brain/spans" -H 'content-type: application/json' -H 'x-session-id: coding-workflow-runner' -d '{"run_id":"'"$RID"'","activity_id":"c0de0000-0000-4000-8000-000000000102","occurrence_key":"qa/spec/1","started_at":"2026-10-10T10:00:00.000Z","ended_at":"2026-10-10T10:00:05.000Z","executor_kind":"agent","outcome":"pass","tokens_in":100,"tokens_out":20,"cost_usd":0.125}'); echo "step2=$P"
G=$(curl -s -w '\n%{http_code}' "$B/api/brain/runs/$ENC"); echo "step3=$G"
[ "$S1" = 404 ] && [ "$(echo "$P" | tail -1)" = 200 ] && echo "$P" | head -1 | jq -e '.inserted==1' >/dev/null && [ "$(echo "$G" | tail -1)" = 200 ] && echo "$G" | head -1 | jq -e --arg r "$RID" '(["run_id","workflow_id","trigger_kind","started_at","ended_at","outcome","header_source","tokens_in","tokens_out","cost_usd"] - keys == []) and .run_id==$r and .trigger_kind=="external" and .header_source=="spans" and .outcome=="pass" and .started_at=="2026-10-10T10:00:00.000Z" and .ended_at=="2026-10-10T10:00:05.000Z" and (.cost_usd|tonumber)==0.125 and (.tokens_in|tonumber)==100 and (.tokens_out|tonumber)==20 and (has("spans")|not)'
```
```output
RID=coding-workflow:dde94758-fd40-4386-a0f2-3254367bc5a5
step1=404
step2={"inserted":1,"skipped":0,"count":1,"ids":["c879549e-821f-4cde-9bb3-4c406a89ec0f"]}
200
step3={"id":"3c144a33-d533-4557-bf33-551d290bb020","run_id":"coding-workflow:dde94758-fd40-4386-a0f2-3254367bc5a5","workflow_id":null,"trigger_kind":"external","trigger_ref":null,"schedule_entry_id":null,"task_run_id":null,"executor_kind":null,"executor_id":null,"started_at":"2026-10-10T10:00:00.000Z","ended_at":"2026-10-10T10:00:05.000Z","duration_ms":5000,"outcome":"pass","error":null,"model":null,"tokens_in":"100","tokens_out":"20","cost_usd":"0.125000","detail":null,"header_source":"spans","created_at":"2026-10-11T05:22:56.631Z","updated_at":"2026-10-11T05:22:56.631Z","notion_id":null,"notion_synced_at":null,"notion_digest":null}
200
true
```

### T-2
对应: Q-1
verdict: PASS
说明：同样的操作第 2 次（换一个新 run_id），结果和 T-1 一致，不是偶发（不 FLAKY）。
```command
B=http://localhost:5301; RID="coding-workflow:$(uuidgen | tr A-Z a-z)"; ENC=$(python3 -c 'import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1],safe=""))' "$RID"); echo "RID=$RID"
S1=$(curl -s -o /dev/null -w '%{http_code}' "$B/api/brain/runs/$ENC"); echo "step1=$S1"
P=$(curl -s -w '\n%{http_code}' -X POST "$B/api/brain/spans" -H 'content-type: application/json' -H 'x-session-id: coding-workflow-runner' -d '{"run_id":"'"$RID"'","activity_id":"c0de0000-0000-4000-8000-000000000102","occurrence_key":"qa/spec/1","started_at":"2026-10-10T10:00:00.000Z","ended_at":"2026-10-10T10:00:05.000Z","executor_kind":"agent","outcome":"pass","tokens_in":100,"tokens_out":20,"cost_usd":0.125}'); echo "step2=$P"
G=$(curl -s -w '\n%{http_code}' "$B/api/brain/runs/$ENC"); echo "step3=$G"
[ "$S1" = 404 ] && [ "$(echo "$P" | tail -1)" = 200 ] && echo "$P" | head -1 | jq -e '.inserted==1' >/dev/null && [ "$(echo "$G" | tail -1)" = 200 ] && echo "$G" | head -1 | jq -e --arg r "$RID" '(["run_id","workflow_id","trigger_kind","started_at","ended_at","outcome","header_source","tokens_in","tokens_out","cost_usd"] - keys == []) and .run_id==$r and .trigger_kind=="external" and .header_source=="spans" and .outcome=="pass" and .started_at=="2026-10-10T10:00:00.000Z" and .ended_at=="2026-10-10T10:00:05.000Z" and (.cost_usd|tonumber)==0.125 and (.tokens_in|tonumber)==100 and (.tokens_out|tonumber)==20 and (has("spans")|not)'
```
```output
RID=coding-workflow:d83f767a-59ac-4829-9378-4b3f0599c90a
step1=404
step2={"inserted":1,"skipped":0,"count":1,"ids":["b90df232-1f2a-446f-818b-de70db954958"]}
200
step3={"id":"39a5d7ff-f4d4-4e52-8bcb-43d76d0d9ded","run_id":"coding-workflow:d83f767a-59ac-4829-9378-4b3f0599c90a","workflow_id":null,"trigger_kind":"external","trigger_ref":null,"schedule_entry_id":null,"task_run_id":null,"executor_kind":null,"executor_id":null,"started_at":"2026-10-10T10:00:00.000Z","ended_at":"2026-10-10T10:00:05.000Z","duration_ms":5000,"outcome":"pass","error":null,"model":null,"tokens_in":"100","tokens_out":"20","cost_usd":"0.125000","detail":null,"header_source":"spans","created_at":"2026-10-11T05:23:01.865Z","updated_at":"2026-10-11T05:23:01.865Z","notion_id":null,"notion_synced_at":null,"notion_digest":null}
200
true
```

### T-3
对应: Q-2
verdict: PASS
说明：Q-2 第 1 步，在预览环境做。路径里直接用裸冒号（不编码）GET，返回 200，run_id 原样带冒号；返回体和编码地址拿到的完全相同。
```command
B=http://localhost:5301; RID="coding-workflow:$(uuidgen | tr A-Z a-z)"; ENC=$(python3 -c 'import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1],safe=""))' "$RID")
curl -s -o /dev/null -w 'post=%{http_code}\n' -X POST "$B/api/brain/spans" -H 'content-type: application/json' -H 'x-session-id: coding-workflow-runner' -d '{"run_id":"'"$RID"'","activity_id":"c0de0000-0000-4000-8000-000000000102","occurrence_key":"qa/spec/1","started_at":"2026-10-10T10:00:00.000Z","ended_at":"2026-10-10T10:00:05.000Z","executor_kind":"agent","outcome":"pass","tokens_in":100,"tokens_out":20,"cost_usd":0.125}'
RAW=$(curl -s -w '\n%{http_code}' "$B/api/brain/runs/$RID"); echo "bare=$RAW"
E=$(curl -s "$B/api/brain/runs/$ENC")
[ "$(echo "$RAW" | tail -1)" = 200 ] && echo "$RAW" | head -1 | jq -e --arg r "$RID" --argjson e "$E" '.run_id==$r and .=={}+$e' 
```
```output
post=200
bare={"id":"d0e45ff0-a560-4be5-9dac-1ade61553ccc","run_id":"coding-workflow:211104fd-2e96-4948-8ea2-08cbbdf524d2","workflow_id":null,"trigger_kind":"external","trigger_ref":null,"schedule_entry_id":null,"task_run_id":null,"executor_kind":null,"executor_id":null,"started_at":"2026-10-10T10:00:00.000Z","ended_at":"2026-10-10T10:00:05.000Z","duration_ms":5000,"outcome":"pass","error":null,"model":null,"tokens_in":"100","tokens_out":"20","cost_usd":"0.125000","detail":null,"header_source":"spans","created_at":"2026-10-11T05:23:07.080Z","updated_at":"2026-10-11T05:23:07.080Z","notion_id":null,"notion_synced_at":null,"notion_digest":null}
200
true
```

### T-4
对应: Q-2
verdict: PASS
说明：预览没配 token，所以 Q-2 的鉴权部分**改在本机分支 Brain（127.0.0.1:5299，token=qa-local-token）上做**，按规格约定的命令启动，就绪门已过。带 token 时裸冒号 GET 返回 200，字段值对；不带 token 和错 token 都返回 401，`error.code=UNAUTHORIZED`，body 里不带 run_id/cost_usd 这些记录字段，提示语是人能看懂的中文。（本条打的是本机地址，不是 PREVIEW_URL，不适合搬进预览 smoke。）
```command
B=http://127.0.0.1:5299; T=qa-local-token; RID="coding-workflow:$(uuidgen | tr A-Z a-z)"; ENC=$(python3 -c 'import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1],safe=""))' "$RID")
curl -s -o /dev/null -w 'post=%{http_code}\n' -X POST "$B/api/brain/spans" -H 'content-type: application/json' -H 'x-session-id: coding-workflow-runner' -H "x-internal-token: $T" -d '{"run_id":"'"$RID"'","activity_id":"c0de0000-0000-4000-8000-000000000102","occurrence_key":"qa/spec/1","started_at":"2026-10-10T10:00:00.000Z","ended_at":"2026-10-10T10:00:05.000Z","executor_kind":"agent","outcome":"pass","tokens_in":100,"tokens_out":20,"cost_usd":0.125}'
RAW=$(curl -s -w '\n%{http_code}' -H "x-internal-token: $T" "$B/api/brain/runs/$RID"); echo "bare=$(echo "$RAW" | tail -1) $(echo "$RAW" | head -1 | jq -c '{run_id,outcome,cost_usd,header_source}')"
NO=$(curl -s -w '\n%{http_code}' "$B/api/brain/runs/$ENC"); echo "notoken=$(echo "$NO" | tail -1) $(echo "$NO" | head -1)"
WR=$(curl -s -w '\n%{http_code}' -H 'x-internal-token: wrong' "$B/api/brain/runs/$ENC"); echo "wrong=$(echo "$WR" | tail -1) $(echo "$WR" | head -1)"
[ "$(echo "$RAW" | tail -1)" = 200 ] && echo "$RAW" | head -1 | jq -e --arg r "$RID" '.run_id==$r and .outcome=="pass" and (.cost_usd|tonumber)==0.125' >/dev/null && for X in "$NO" "$WR"; do [ "$(echo "$X" | tail -1)" = 401 ] && echo "$X" | head -1 | jq -e '.error.code=="UNAUTHORIZED" and (has("run_id")|not) and (has("cost_usd")|not)' >/dev/null || exit 1; done && echo ALL_OK
```
```output
post=200
bare=200 {"run_id":"coding-workflow:f5efd6d1-1a18-4fad-a753-e286d2549ae4","outcome":"pass","cost_usd":"0.125000","header_source":"spans"}
notoken=401 {"success":false,"data":null,"error":{"code":"UNAUTHORIZED","message":"缺少 internal token（Authorization: Bearer <token> 或 X-Internal-Token）"}}
wrong=401 {"success":false,"data":null,"error":{"code":"UNAUTHORIZED","message":"internal token 无效"}}
ALL_OK
```

### T-5
对应: Q-3
verdict: PASS
说明：一次 POST 两条 span，故意把晚的放前面。`include=spans` 返回 2 条，按 started_at 升序（qa/a 在前、qa/b 在后），每条字段齐全，activity_id 对，顶层 cost_usd=0.3。不带 include 和 `include=foo` 时都是 200，且没有 spans 键。
```command
B=http://localhost:5301; RID2="coding-workflow:$(uuidgen | tr A-Z a-z)"; ENC=$(python3 -c 'import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1],safe=""))' "$RID2"); A=c0de0000-0000-4000-8000-000000000102
curl -s -X POST "$B/api/brain/spans" -H 'content-type: application/json' -H 'x-session-id: coding-workflow-runner' -d '[{"run_id":"'"$RID2"'","activity_id":"'$A'","occurrence_key":"qa/b","started_at":"2026-10-10T11:00:10.000Z","ended_at":"2026-10-10T11:00:20.000Z","executor_kind":"agent","outcome":"pass","cost_usd":0.2},{"run_id":"'"$RID2"'","activity_id":"'$A'","occurrence_key":"qa/a","started_at":"2026-10-10T11:00:00.000Z","ended_at":"2026-10-10T11:00:05.000Z","executor_kind":"agent","outcome":"pass","cost_usd":0.1}]'; echo
W=$(curl -s -w '\n%{http_code}' "$B/api/brain/runs/$ENC?include=spans"); echo "with=$W"
N=$(curl -s -w '\n%{http_code}' "$B/api/brain/runs/$ENC"); echo "none=$(echo "$N" | tail -1) $(echo "$N" | head -1 | jq -c 'has("spans")')"
F=$(curl -s -w '\n%{http_code}' "$B/api/brain/runs/$ENC?include=foo"); echo "foo=$(echo "$F" | tail -1) $(echo "$F" | head -1 | jq -c 'has("spans")')"
[ "$(echo "$W" | tail -1)" = 200 ] && echo "$W" | head -1 | jq -e --arg a "$A" '(.spans|length)==2 and .spans[0].occurrence_key=="qa/a" and .spans[1].occurrence_key=="qa/b" and all(.spans[]; (["occurrence_key","activity_id","outcome","cost_usd","started_at","ended_at"]-keys==[]) and .activity_id==$a) and (.cost_usd|tonumber)==0.3' >/dev/null && [ "$(echo "$N" | tail -1)" = 200 ] && echo "$N" | head -1 | jq -e 'has("spans")|not' >/dev/null && [ "$(echo "$F" | tail -1)" = 200 ] && echo "$F" | head -1 | jq -e 'has("spans")|not'
```
```output
{"inserted":2,"skipped":0,"count":2,"ids":["63506c70-5dcd-4b23-bf18-db57cadc8397","5422d4b8-9dc5-4e66-99ee-e2810c67c206"]}
with={"id":"9008aad4-ed11-4b67-803d-fc4cc730a998","run_id":"coding-workflow:d1510c37-21f8-4ce4-9254-e87f5b9a83b8","workflow_id":null,"trigger_kind":"external",…,"cost_usd":"0.300000","detail":null,"header_source":"spans",…,"spans":[{"id":"5422d4b8-9dc5-4e66-99ee-e2810c67c206","run_id":"coding-workflow:d1510c37-21f8-4ce4-9254-e87f5b9a83b8","workflow_id":null,"activity_id":"c0de0000-0000-4000-8000-000000000102",…,"started_at":"2026-10-10T11:00:00.000Z","ended_at":"2026-10-10T11:00:05.000Z",…,"cost_usd":"0.100000","attempts":1,"fallback":false,"outcome":"pass","evidence":null,"created_at":"2026-10-11T05:23:13.778Z","occurrence_key":"qa/a",…},{"id":"63506c70-5dcd-4b23-bf18-db57cadc8397",…,"activity_id":"c0de0000-0000-4000-8000-000000000102",…,"started_at":"2026-10-10T11:00:10.000Z","ended_at":"2026-10-10T11:00:20.000Z",…,"cost_usd":"0.200000","attempts":1,"fallback":false,"outcome":"pass","evidence":null,"created_at":"2026-10-11T05:23:13.778Z","occurrence_key":"qa/b",…}]}
200
none=200 false
foo=200 false
true
```

### T-6
对应: Q-4
verdict: PASS
说明：异步/触发器时序类场景，第 1 次。每次 POST 后立刻 GET：pass/0.1/spans → fail/0.15 → 终态 span 之后变成 pass/0.16/owner → 同一条 span 重复上报返回 inserted=0，汇总值不变（没有重复计费）。
```command
B=http://localhost:5301; RID3="coding-workflow:$(uuidgen | tr A-Z a-z)"; ENC=$(python3 -c 'import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1],safe=""))' "$RID3"); A=c0de0000-0000-4000-8000-000000000102
post() { curl -s -X POST "$B/api/brain/spans" -H 'content-type: application/json' -H 'x-session-id: coding-workflow-runner' -d "$1"; }
S2='{"run_id":"'"$RID3"'","activity_id":"'$A'","occurrence_key":"qa/2","started_at":"2026-10-10T12:00:00.000Z","ended_at":"2026-10-10T12:00:03.000Z","executor_kind":"agent","outcome":"fail","cost_usd":0.05}'
P0=$(post '{"run_id":"'"$RID3"'","activity_id":"'$A'","occurrence_key":"qa/1","started_at":"2026-10-10T11:59:00.000Z","ended_at":"2026-10-10T11:59:05.000Z","executor_kind":"agent","outcome":"pass","cost_usd":0.1}')
G1=$(curl -s "$B/api/brain/runs/$ENC" | jq -c '{outcome,cost_usd,header_source}')
P2=$(post "$S2"); G2=$(curl -s "$B/api/brain/runs/$ENC" | jq -c '{outcome,cost_usd,header_source}')
P3=$(post '{"run_id":"'"$RID3"'","activity_id":"'$A'","occurrence_key":"qa/3","started_at":"2026-10-10T12:10:00.000Z","ended_at":"2026-10-10T12:10:01.000Z","executor_kind":"agent","outcome":"pass","cost_usd":0.01,"evidence":{"run_terminal":true}}')
G3=$(curl -s "$B/api/brain/runs/$ENC" | jq -c '{outcome,cost_usd,header_source}')
P4=$(post "$S2"); G4=$(curl -s "$B/api/brain/runs/$ENC" | jq -c '{outcome,cost_usd,header_source}')
printf 'p0=%s\ng1=%s\np2=%s\ng2=%s\np3=%s\ng3=%s\np4=%s\ng4=%s\n' "$P0" "$G1" "$P2" "$G2" "$P3" "$G3" "$P4" "$G4"
echo "$P0" | jq -e '.inserted==1' >/dev/null && echo "$G1" | jq -e '.outcome=="pass" and (.cost_usd|tonumber)==0.1 and .header_source=="spans"' >/dev/null && echo "$G2" | jq -e '.outcome=="fail" and (.cost_usd|tonumber)==0.15' >/dev/null && echo "$G3" | jq -e '.outcome=="pass" and .header_source=="owner" and (.cost_usd|tonumber)==0.16' >/dev/null && echo "$P4" | jq -e '.inserted==0' >/dev/null && echo "$G4" | jq -e '.outcome=="pass" and (.cost_usd|tonumber)==0.16'
```
```output
p0={"inserted":1,"skipped":0,"count":1,"ids":["46dd935d-69dd-4d4b-a601-3ba978c39e05"]}
g1={"outcome":"pass","cost_usd":"0.100000","header_source":"spans"}
p2={"inserted":1,"skipped":0,"count":1,"ids":["4dc6cec7-059b-4638-840b-6d8dd4306433"]}
g2={"outcome":"fail","cost_usd":"0.150000","header_source":"spans"}
p3={"inserted":1,"skipped":0,"count":1,"ids":["118c407e-7935-46c6-802b-649c595ec018"]}
g3={"outcome":"pass","cost_usd":"0.160000","header_source":"owner"}
p4={"inserted":0,"skipped":1,"count":1,"ids":[]}
g4={"outcome":"pass","cost_usd":"0.160000","header_source":"owner"}
true
```

### T-7
对应: Q-4
verdict: PASS
说明：同样的操作第 2 次（换一个新 run_id），每一步的结果都和 T-6 一致，不 FLAKY。
```command
B=http://localhost:5301; RID3="coding-workflow:$(uuidgen | tr A-Z a-z)"; ENC=$(python3 -c 'import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1],safe=""))' "$RID3"); A=c0de0000-0000-4000-8000-000000000102
post() { curl -s -X POST "$B/api/brain/spans" -H 'content-type: application/json' -H 'x-session-id: coding-workflow-runner' -d "$1"; }
S2='{"run_id":"'"$RID3"'","activity_id":"'$A'","occurrence_key":"qa/2","started_at":"2026-10-10T12:00:00.000Z","ended_at":"2026-10-10T12:00:03.000Z","executor_kind":"agent","outcome":"fail","cost_usd":0.05}'
P0=$(post '{"run_id":"'"$RID3"'","activity_id":"'$A'","occurrence_key":"qa/1","started_at":"2026-10-10T11:59:00.000Z","ended_at":"2026-10-10T11:59:05.000Z","executor_kind":"agent","outcome":"pass","cost_usd":0.1}')
G1=$(curl -s "$B/api/brain/runs/$ENC" | jq -c '{outcome,cost_usd,header_source}')
P2=$(post "$S2"); G2=$(curl -s "$B/api/brain/runs/$ENC" | jq -c '{outcome,cost_usd,header_source}')
P3=$(post '{"run_id":"'"$RID3"'","activity_id":"'$A'","occurrence_key":"qa/3","started_at":"2026-10-10T12:10:00.000Z","ended_at":"2026-10-10T12:10:01.000Z","executor_kind":"agent","outcome":"pass","cost_usd":0.01,"evidence":{"run_terminal":true}}')
G3=$(curl -s "$B/api/brain/runs/$ENC" | jq -c '{outcome,cost_usd,header_source}')
P4=$(post "$S2"); G4=$(curl -s "$B/api/brain/runs/$ENC" | jq -c '{outcome,cost_usd,header_source}')
printf 'p0=%s\ng1=%s\np2=%s\ng2=%s\np3=%s\ng3=%s\np4=%s\ng4=%s\n' "$P0" "$G1" "$P2" "$G2" "$P3" "$G3" "$P4" "$G4"
echo "$P0" | jq -e '.inserted==1' >/dev/null && echo "$G1" | jq -e '.outcome=="pass" and (.cost_usd|tonumber)==0.1 and .header_source=="spans"' >/dev/null && echo "$G2" | jq -e '.outcome=="fail" and (.cost_usd|tonumber)==0.15' >/dev/null && echo "$G3" | jq -e '.outcome=="pass" and .header_source=="owner" and (.cost_usd|tonumber)==0.16' >/dev/null && echo "$P4" | jq -e '.inserted==0' >/dev/null && echo "$G4" | jq -e '.outcome=="pass" and (.cost_usd|tonumber)==0.16'
```
```output
p0={"inserted":1,"skipped":0,"count":1,"ids":["2749a229-b18a-4b5a-875a-69b1d80c9649"]}
g1={"outcome":"pass","cost_usd":"0.100000","header_source":"spans"}
p2={"inserted":1,"skipped":0,"count":1,"ids":["1ddfb74d-ea98-4bee-aaa3-b438051799fa"]}
g2={"outcome":"fail","cost_usd":"0.150000","header_source":"spans"}
p3={"inserted":1,"skipped":0,"count":1,"ids":["4115b922-f3f1-4d1c-822f-185491e92c53"]}
g3={"outcome":"pass","cost_usd":"0.160000","header_source":"owner"}
p4={"inserted":0,"skipped":1,"count":1,"ids":[]}
g4={"outcome":"pass","cost_usd":"0.160000","header_source":"owner"}
true
```

### T-8
对应: Q-5
verdict: PASS
说明：不存在的 run_id、带 include=spans、SQL 注入式输入，三次都是 404 JSON，`error` 是可读的「run not found: …」，没有 spans 键。注入串按字面值查询，不是 500。
```command
B=http://localhost:5301; NORID="coding-workflow:$(uuidgen | tr A-Z a-z)"; ENC=$(python3 -c 'import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1],safe=""))' "$NORID"); rc=0
for u in "$B/api/brain/runs/$ENC" "$B/api/brain/runs/$ENC?include=spans" "$B/api/brain/runs/x%27%20OR%20%271%27%3D%271"; do R=$(curl -s -w '\n%{http_code}' "$u"); echo "$(echo "$R" | tail -1) $(echo "$R" | head -1)"; [ "$(echo "$R" | tail -1)" = 404 ] && echo "$R" | head -1 | jq -e '(.error|type=="string") and (.error|test("not found")) and (has("spans")|not)' >/dev/null || rc=1; done; exit $rc
```
```output
404 {"error":"run not found: coding-workflow:9de15baa-c3cb-41d4-a49e-def3ae472d5d"}
404 {"error":"run not found: coding-workflow:9de15baa-c3cb-41d4-a49e-def3ae472d5d"}
404 {"error":"run not found: x' OR '1'='1"}
```

### T-9
对应: Q-6
verdict: PASS
说明：空白、`/runs/`、`/runs`、201 字符、非法编码 `%E0%A4%A` 全部返回 400，并说明了原因（必填 / 超 200 字符 / 编码非法），没有一个是 500。恰好 200 字符返回 404。
```command
B=http://localhost:5301; rc=0
chk() { R=$(curl -s -w '\n%{http_code}' "$1"); C=$(echo "$R" | tail -1); echo "$C $(echo "$R" | head -1 | cut -c1-200)"; [ "$C" = "$2" ] && echo "$R" | head -1 | jq -e --arg p "$3" '(.error|type=="string") and (.error|test($p))' >/dev/null || rc=1; }
chk "$B/api/brain/runs/%20%20" 400 "required"
chk "$B/api/brain/runs/" 400 "required"
chk "$B/api/brain/runs" 400 "required"
chk "$B/api/brain/runs/$(printf 'a%.0s' $(seq 1 201))" 400 "200 characters"
chk "$B/api/brain/runs/$(printf 'a%.0s' $(seq 1 200))" 404 "not found"
chk "$B/api/brain/runs/%E0%A4%A" 400 "URL encoding"
exit $rc
```
```output
400 {"error":"run_id is required"}
400 {"error":"run_id is required"}
400 {"error":"run_id is required"}
400 {"error":"run_id must be at most 200 characters"}
404 {"error":"run not found: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
400 {"error":"run_id is not valid URL encoding"}
```

### T-10
对应: Q-7
verdict: PASS
说明：基线自己搭，没用预览环境或生产当基线。本分支 Brain 跑在 127.0.0.1:5299；`git worktree add --detach /tmp/qa-6275-main origin/main`（d332cf3f4）起的 main Brain 跑在 127.0.0.1:5298。两端同库 `cecelia_test`、同 token `qa-local-token`、同 `NODE_ENV=development`，启动命令与规格约定一致，就绪门两端都返回 `{"service":"cecelia-brain","status":"running",...}`。（第一次比对时脚本里 header 参数传错了，两端都打出 400，那次作废。下面是修正后的正式执行。）对比结果：两段旧路由在两端的状态码和 `error.code` 逐条完全相同——不带 token 三个都是 401 UNAUTHORIZED；带 token 时 GET definition 404 RUN_DEFINITION_UNKNOWN，GET reconciliation 200 且有 evidence_status，POST definition（空 body）两端都是 422 RELEASE_INPUT_INVALID。新接口在本分支 200，在 main 上是 404 HTML（没有 run_id），说明这是新增接口，也没有吞掉旧的两段路由。
```command
T=qa-local-token; RID4="coding-workflow:$(uuidgen | tr A-Z a-z)"; ENC=$(python3 -c 'import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1],safe=""))' "$RID4")
curl -s -o /dev/null -w 'post=%{http_code}\n' -X POST "http://127.0.0.1:5299/api/brain/spans" -H 'content-type: application/json' -H 'x-session-id: coding-workflow-runner' -H "x-internal-token: $T" -d '{"run_id":"'"$RID4"'","activity_id":"c0de0000-0000-4000-8000-000000000102","occurrence_key":"qa/spec/1","started_at":"2026-10-10T10:00:00.000Z","ended_at":"2026-10-10T10:00:05.000Z","executor_kind":"agent","outcome":"pass","tokens_in":100,"tokens_out":20,"cost_usd":0.125}'
probe() { B=$1; HDR=$2
  R=$(curl -s -w '\n%{http_code}' -H "$HDR" "$B/api/brain/runs/$ENC/definition"); echo "GET definition $(echo "$R" | tail -1) $(echo "$R" | head -1 | jq -c '[.error.code // null, has("evidence_status")]')"
  R=$(curl -s -w '\n%{http_code}' -H "$HDR" "$B/api/brain/runs/$ENC/reconciliation"); echo "GET reconciliation $(echo "$R" | tail -1) $(echo "$R" | head -1 | jq -c '[.error.code // null, has("evidence_status")]')"
  R=$(curl -s -w '\n%{http_code}' -X POST -H 'content-type: application/json' -H "$HDR" -d '{}' "$B/api/brain/runs/$ENC/definition"); echo "POST definition $(echo "$R" | tail -1) $(echo "$R" | head -1 | jq -c '[.error.code // null, has("evidence_status")]')"; }
for HDR in "x-qa: none" "x-internal-token: $T"; do A=$(probe http://127.0.0.1:5299 "$HDR"); M=$(probe http://127.0.0.1:5298 "$HDR"); echo "== ${HDR%%:*}"; echo "branch:"; echo "$A"; echo "main:"; echo "$M"; [ "$A" = "$M" ] || { echo DIFF; exit 1; }; done
NEWB=$(curl -s -w '\n%{http_code}' -H "x-internal-token: $T" "http://127.0.0.1:5299/api/brain/runs/$ENC"); NEWM=$(curl -s -w '\n%{http_code}' -H "x-internal-token: $T" "http://127.0.0.1:5298/api/brain/runs/$ENC")
echo "new-branch=$(echo "$NEWB" | tail -1) $(echo "$NEWB" | head -1 | jq -c '{run_id}')"; echo "new-main=$(echo "$NEWM" | tail -1) $(echo "$NEWM" | head -1 | cut -c1-80)"
A0=$(probe http://127.0.0.1:5299 "x-qa: none"); A1=$(probe http://127.0.0.1:5299 "x-internal-token: $T")
[ "$(echo "$A0" | grep -c ' 401 \["UNAUTHORIZED",false\]')" = 3 ] && echo "$A1" | grep -q '^GET definition 404 \["RUN_DEFINITION_UNKNOWN",false\]$' && echo "$A1" | grep -q '^GET reconciliation 200 \[null,true\]$' && [ "$(echo "$NEWB" | tail -1)" = 200 ] && echo "$NEWB" | head -1 | jq -e --arg r "$RID4" '.run_id==$r' >/dev/null && ! echo "$NEWM" | head -1 | jq -e 'has("run_id")' >/dev/null 2>&1 && echo ALL_OK
```
```output
post=200
== x-qa
branch:
GET definition 401 ["UNAUTHORIZED",false]
GET reconciliation 401 ["UNAUTHORIZED",false]
POST definition 401 ["UNAUTHORIZED",false]
main:
GET definition 401 ["UNAUTHORIZED",false]
GET reconciliation 401 ["UNAUTHORIZED",false]
POST definition 401 ["UNAUTHORIZED",false]
== x-internal-token
branch:
GET definition 404 ["RUN_DEFINITION_UNKNOWN",false]
GET reconciliation 200 [null,true]
POST definition 422 ["RELEASE_INPUT_INVALID",false]
main:
GET definition 404 ["RUN_DEFINITION_UNKNOWN",false]
GET reconciliation 200 [null,true]
POST definition 422 ["RELEASE_INPUT_INVALID",false]
new-branch=200 {"run_id":"coding-workflow:b52c4d12-865a-44d1-8e35-e3b047d096a4"}
new-main=404 <!DOCTYPE html>
ALL_OK
```

### X-1
对应: Q-1, Q-2
verdict: PASS
场景：开测前先按规格约定探测预览环境的鉴权配置。POST /spans 传 `[]` 返回 400（不是 401/503），说明预览走 loopback 可以直接写入。查预览进程（/tmp/preview-6275.pid=83297）的环境变量，只有 DB_NAME/PORT，没有 CECELIA_INTERNAL_TOKEN 和 NODE_ENV，所以拿不到 token，鉴权部分改在本机分支 Brain 上做（见 T-4）。
```command
date -u +%FT%TZ; curl -s -o /dev/null -w '%{http_code}\n' -X POST "http://localhost:5301/api/brain/spans" -H 'content-type: application/json' -d '[]'; curl -s http://localhost:5301/ | head -c 300; echo; ls /tmp/preview-*.pid; cat /tmp/preview-*.pid
```
```output
2026-10-11T05:22:30Z
400
{"service":"cecelia-brain","status":"running","port":"5301"}
/tmp/preview-6101.pid
/tmp/preview-6105.pid
/tmp/preview-6117.pid
/tmp/preview-6275.pid
55478
3247
12058
83297
```

### X-2
对应: I-3
verdict: PASS
场景：用户传入带控制字符的 run_id（`%00`、`%1F`、`%7F`、`%0A`，这是上一轮裁判发现会 500 的输入），都返回 400，说明是控制字符的问题，没有回显数据库原始错误。多字节字符按字符数算长度：201 个汉字返回 400，恰好 200 个汉字返回 404，没有被按字节数误判成超长。
```command
B=http://localhost:5301; rc=0
for p in "a%00b" "a%1Fb" "a%7Fb" "a%0Ab"; do R=$(curl -s -w '\n%{http_code}' "$B/api/brain/runs/$p"); echo "$p -> $(echo "$R" | tail -1) $(echo "$R" | head -1)"; [ "$(echo "$R" | tail -1)" = 400 ] && echo "$R" | head -1 | jq -e '.error=="run_id must not contain control characters"' >/dev/null || rc=1; done
R=$(curl -s -w '\n%{http_code}' "$B/api/brain/runs/$(python3 -c 'print("%E4%B8%AD"*201)')"); echo "201xU+4E2D -> $(echo "$R" | tail -1) $(echo "$R" | head -1)"; [ "$(echo "$R" | tail -1)" = 400 ] || rc=1
R=$(curl -s -w '\n%{http_code}' "$B/api/brain/runs/$(python3 -c 'print("%E4%B8%AD"*200)')"); echo "200xU+4E2D -> $(echo "$R" | tail -1) $(echo "$R" | head -1 | cut -c1-40)"; [ "$(echo "$R" | tail -1)" = 404 ] || rc=1
exit $rc
```
```output
a%00b -> 400 {"error":"run_id must not contain control characters"}
a%1Fb -> 400 {"error":"run_id must not contain control characters"}
a%7Fb -> 400 {"error":"run_id must not contain control characters"}
a%0Ab -> 400 {"error":"run_id must not contain control characters"}
201xU+4E2D -> 400 {"error":"run_id must be at most 200 characters"}
200xU+4E2D -> 404 {"error":"run not found: 中中中中中中中中中中中中中中中
```

### X-3
对应: I-2, I-4
verdict: PASS
场景：一个用户连续快速并发查同一个 run（20 个并发 GET 带 include=spans），20 次结果完全一致。include 的几种写法：`include=foo&include=spans` 合并判断，返回了 spans；`include=foo, spans `（逗号加空格）逐项 trim 后也返回了 spans。run_id 前后带空格（`%20…%20`）时会 trim 后取到正确记录。
```command
B=http://localhost:5301; RID="coding-workflow:$(uuidgen | tr A-Z a-z)"; ENC=$(python3 -c 'import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1],safe=""))' "$RID")
curl -s -o /dev/null -w 'post=%{http_code}\n' -X POST "$B/api/brain/spans" -H 'content-type: application/json' -H 'x-session-id: coding-workflow-runner' -d '{"run_id":"'"$RID"'","activity_id":"c0de0000-0000-4000-8000-000000000102","occurrence_key":"qa/x/1","started_at":"2026-10-10T10:00:00.000Z","ended_at":"2026-10-10T10:00:05.000Z","executor_kind":"agent","outcome":"pass","cost_usd":0.125}'
seq 1 20 | xargs -P 20 -I{} curl -s "$B/api/brain/runs/$ENC?include=spans" | jq -c '{run_id,cost_usd,n:(.spans|length)}' | sort | uniq -c
I1=$(curl -s "$B/api/brain/runs/$ENC?include=foo&include=spans" | jq -c '(.spans|length)'); I2=$(curl -s "$B/api/brain/runs/$ENC?include=foo,%20spans%20" | jq -c '(.spans|length)'); TR=$(curl -s "$B/api/brain/runs/%20$ENC%20" | jq -r '.run_id')
echo "array=$I1 comma_ws=$I2 trimmed=$TR"
[ "$(seq 1 20 | xargs -P 20 -I{} curl -s "$B/api/brain/runs/$ENC?include=spans" | jq -c '{run_id,cost_usd,n:(.spans|length)}' | sort -u | wc -l | tr -d ' ')" = 1 ] && [ "$I1" = 1 ] && [ "$I2" = 1 ] && [ "$TR" = "$RID" ] && echo ALL_OK
```
```output
post=200
  20 {"run_id":"coding-workflow:25d51b0d-d2f3-4c6f-89a9-2521322dd55d","cost_usd":"0.125000","n":1}
array=1 comma_ws=1 trimmed=coding-workflow:25d51b0d-d2f3-4c6f-89a9-2521322dd55d
ALL_OK
```
