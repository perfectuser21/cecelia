---
task_id: 142c9ad0-2150-4f03-978c-3dd30ab32ed1
step: evaluate
upstream: ["02-spec.md#Q-1", "02-spec.md#Q-2", "02-spec.md#Q-3", "02-spec.md#Q-4", "02-spec.md#Q-5", "02-spec.md#Q-6", "02-spec.md#Q-7", "02-spec.md#Q-8"]
---
# QA 报告（第 2 轮，环境 http://localhost:5301）

本轮开始时间：2026-10-11T12:58:15Z。预览 Brain git_sha=55695d6dd1ecae86bb344c92d3cd0f065cc4ccfa。全部请求只打 http://localhost:5301，没有访问 localhost:5221。本 PR 只涉及接口，QA 场景里没有页面类场景，所以本轮没开浏览器，也没有截图。

### T-1
对应: Q-1
verdict: PASS
```command
B=http://localhost:5301; for s in stats stages output publish-status; do r=$(curl -sS -w '\n%{http_code}' "$B/api/brain/runs/$s"); echo "$s => $r"; code=$(printf '%s' "$r" | tail -1); body=$(printf '%s' "$r" | sed '$d'); [ "$code" = 404 ] || exit 1; printf '%s' "$body" | jq -e --arg s "$s" '.error == ("run not found: " + $s) and (has("pipeline_id")|not) and (has("platforms")|not) and (has("stages")|not)' >/dev/null || exit 1; printf '%s' "$body" | grep -q 'invalid input syntax' && exit 1; done; echo ALL_OK
```
```output
stats => {"error":"run not found: stats"}
404
stages => {"error":"run not found: stages"}
404
output => {"error":"run not found: output"}
404
publish-status => {"error":"run not found: publish-status"}
404
ALL_OK
```

### T-2
对应: Q-2
verdict: CANNOT_VERIFY
原因: 环境前提不满足：预览 Brain 进程（PID 69565）没有配置 `CECELIA_INTERNAL_TOKEN`，runs 读路由对 loopback 请求直接放行，所以不带 token 的请求拿不到 401，鉴权分支在预览环境里测不到。Q-2 原文和 commander 第 1 次裁决都写明了：这种情况记 CANNOT_VERIFY，由 S-4 单元测试兜底。同一个请求确实落到了 runs 读路由（返回 `run not found: stats`），没有被内容流水线接走，也没有 500。
```command
B=http://localhost:5301; r=$(curl -sS -w '\n%{http_code}' "$B/api/brain/runs/stats"); echo "$r"; code=$(printf '%s' "$r" | tail -1); [ "$code" = 401 ] && printf '%s' "$r" | sed '$d' | jq -e '.error.code == "UNAUTHORIZED"'
```
```output
{"error":"run not found: stats"}
404
```
确认预览进程的环境变量里没有 token（结果计数为 0）：
```command
lsof -nP -iTCP:5301 -sTCP:LISTEN; PID=$(lsof -tiTCP:5301 -sTCP:LISTEN | head -1); ps -o pid,command -p $PID; ps eww -p $PID | tr ' ' '\n' | grep -c '^CECELIA_INTERNAL_TOKEN=' 
```
```output
COMMAND   PID          USER   FD   TYPE             DEVICE SIZE/OFF NODE NAME
node    69565 administrator   17u  IPv6 0xaace573dffc7c29e      0t0  TCP *:5301 (LISTEN)
  PID COMMAND
69565 node /Users/administrator/worktrees/cecelia-previews/preview-6291/packages/brain/server.js
0
```

### T-3
对应: Q-3
verdict: PASS
```command
B=http://localhost:5301; LONG=$(printf 'a%.0s' $(seq 1 300)); for p in not-a-uuid/stats not-a-uuid/stages not-a-uuid/output not-a-uuid/publish-status "1%27%20OR%20%271%27%3D%271/stats" "$LONG/stats"; do r=$(curl -sS -w '\n%{http_code}' "$B/api/brain/pipelines/$p"); echo "${p:0:40} => $(echo $r)"; code=$(printf '%s' "$r" | tail -1); body=$(printf '%s' "$r" | sed '$d'); [ "$code" = 400 ] || exit 1; [ "$body" = '{"error":"invalid pipeline id: must be a UUID"}' ] || exit 1; printf '%s' "$body" | grep -qiE 'invalid input syntax|syntax|uuid:' && exit 1; done; echo ALL_OK
```
```output
not-a-uuid/stats => {"error":"invalid pipeline id: must be a UUID"}
400
not-a-uuid/stages => {"error":"invalid pipeline id: must be a UUID"}
400
not-a-uuid/output => {"error":"invalid pipeline id: must be a UUID"}
400
not-a-uuid/publish-status => {"error":"invalid pipeline id: must be a UUID"}
400
1%27%20OR%20%271%27%3D%271/stats => {"error":"invalid pipeline id: must be a UUID"}
400
aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa => {"error":"invalid pipeline id: must be a UUID"}
400
ALL_OK
```

### T-4
对应: Q-4
verdict: PASS
（命令自己取类型、造流水线，断言四个子路径都是 200 且字段正确，最后按 Q-5 的两步清理掉，清理结果也一起断言。）
```command
B=http://localhost:5301; set -o pipefail; CT=$(curl -sS "$B/api/brain/content-types"); [ "$(printf '%s' "$CT" | jq 'length')" -gt 0 ] || { curl -sS -X POST "$B/api/brain/content-types/seed" >/dev/null; CT=$(curl -sS "$B/api/brain/content-types"); }; T=$(printf '%s' "$CT" | jq -r 'if (.[0]|type)=="string" then .[0] else (.[0].content_type // .[0].name // .[0].id) end'); echo "T=$T"; KW="qa-canary6-$(date +%s)"; R=$(curl -sS -w '\n%{http_code}' -X POST "$B/api/brain/pipelines" -H 'content-type: application/json' -d "{\"keyword\":\"$KW\",\"content_type\":\"$T\"}"); echo "create => $(echo $R | head -c 300)"; [ "$(printf '%s' "$R" | tail -1)" = 201 ] || exit 1; P=$(printf '%s' "$R" | sed '$d' | jq -r '.id'); echo "P=$P"; [[ "$P" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]] || exit 1; ok=1; for s in stats stages output publish-status; do r=$(curl -sS -w '\n%{http_code}' "$B/api/brain/pipelines/$P/$s"); code=$(printf '%s' "$r" | tail -1); body=$(printf '%s' "$r" | sed '$d'); echo "$s => $code $(printf '%s' "$body" | head -c 250)"; [ "$code" = 200 ] || ok=0; case $s in stats) f='(.stats|type)=="array" and (.stats|length)==0';; stages) f='(.stages|type)=="object"';; output) f="(.output.keyword==\"$KW\")";; publish-status) f='(.platforms|type)=="array"';; esac; printf '%s' "$body" | jq -e --arg p "$P" "(.pipeline_id==\$p) and $f" >/dev/null || ok=0; done; D=$(curl -sS -X DELETE "$B/api/brain/tasks/$P" | jq -r .status); G=$(curl -sS "$B/api/brain/tasks/$P" | jq -r .status); echo "cleanup delete=$D get=$G"; [ "$ok" = 1 ] && [ "$D" = cancelled ] && [ "$G" = cancelled ]
```
```output
T=ai-tools-review
create => {"id":"5926be27-d03e-4198-827b-6a005b89c167","goal_id":null,"project_id":null,"title":"[内容工厂] qa-canary6-1791723520 (ai-tools-review)","description":"内容工厂 Pipeline：关键词「qa-canary6-1791723520」，类型「ai-tools-review」。将由 tick 自动编排 content-research → con
P=5926be27-d03e-4198-827b-6a005b89c167
stats => 200 {"pipeline_id":"5926be27-d03e-4198-827b-6a005b89c167","stats":[]}
stages => 200 {"pipeline_id":"5926be27-d03e-4198-827b-6a005b89c167","stages":{}}
output => 200 {"pipeline_id":"5926be27-d03e-4198-827b-6a005b89c167","output":{"keyword":"qa-canary6-1791723520","status":"queued","article_text":null,"cards_text":null,"image_urls":[],"export_path":null,"images":null}}
publish-status => 200 {"pipeline_id":"5926be27-d03e-4198-827b-6a005b89c167","platforms":[]}
cleanup delete=cancelled get=cancelled
```

### T-5
对应: Q-5
verdict: PASS
（为了让命令能单独跑，这里自己新建一条流水线拿来测大写 UUID，没有复用 T-4 的 `$P`；清理两步也一起断言。）
```command
B=http://localhost:5301; U=$(node -e "console.log(require('crypto').randomUUID())"); r=$(curl -sS -w '\n%{http_code}' "$B/api/brain/pipelines/$U/output"); echo "U/output => $(echo $r)"; [ "$(printf '%s' "$r" | tail -1)" = 404 ] && printf '%s' "$r" | sed '$d' | jq -e '.error == "Pipeline 不存在"' >/dev/null || exit 1; T=$(curl -sS "$B/api/brain/content-types" | jq -r 'if (.[0]|type)=="string" then .[0] else (.[0].content_type // .[0].name // .[0].id) end'); P=$(curl -sS -X POST "$B/api/brain/pipelines" -H 'content-type: application/json' -d "{\"keyword\":\"qa-canary6-up-$(date +%s)\",\"content_type\":\"$T\"}" | jq -r .id); PU=$(printf '%s' "$P" | tr a-f A-F); echo "PU=$PU"; r2=$(curl -sS -w '\n%{http_code}' "$B/api/brain/pipelines/$PU/stats"); echo "upper/stats => $(echo $r2)"; D=$(curl -sS -w ' %{http_code}' -X DELETE "$B/api/brain/tasks/$P"); echo "delete => $(printf '%s' "$D" | tail -c 120)"; G=$(curl -sS "$B/api/brain/tasks/$P" | jq -r .status); echo "get status => $G"; [ "$(printf '%s' "$r2" | tail -1)" = 200 ] && [ "${D##* }" = 200 ] && printf '%s' "${D% *}" | jq -e '.status=="cancelled"' >/dev/null && [ "$G" = cancelled ]
```
```output
U/output => {"error":"Pipeline 不存在"}
404
PU=EEA9B538-DC15-4FCF-B95B-269D35806FCA
upper/stats => {"pipeline_id":"EEA9B538-DC15-4FCF-B95B-269D35806FCA","stats":[]}
200
delete => {},"executor_kind":null,"row_version":0,"parent_task_id":null,"sequence_no":null,"tenant_id":null,"kind":"workflow"} 200
get status => cancelled
```

### T-6
对应: Q-6
verdict: PASS
```command
B=http://localhost:5301; CT=$(curl -sS -w '\n%{http_code}' "$B/api/brain/content-types"); [ "$(printf '%s' "$CT" | tail -1)" = 200 ] || exit 1; T=$(printf '%s' "$CT" | sed '$d' | jq -r 'if (.[0]|type)=="string" then .[0] else (.[0].content_type // .[0].name // .[0].id) end'); printf '%s' "$CT" | sed '$d' | jq -e --arg t "$T" 'type=="array" and length>0 and (map(if type=="string" then . else (.content_type // .name // .id) end) | index($t) != null)' || exit 1; echo "T=$T"; c=$(curl -sS -w '\n%{http_code}' "$B/api/brain/content-types/$T/config"); echo "config => $(printf '%s' "$c" | tail -1) $(printf '%s' "$c" | sed '$d' | head -c 150)"; [ "$(printf '%s' "$c" | tail -1)" = 200 ] && printf '%s' "$c" | sed '$d' | jq -e 'type=="object"' >/dev/null || exit 1; for u in "pipelines/daily-stats" "pipelines?limit=5"; do x=$(curl -sS -w '\n%{http_code}' "$B/api/brain/$u"); echo "$u => $(printf '%s' "$x" | tail -1) $(printf '%s' "$x" | sed '$d' | head -c 150)"; [ "$(printf '%s' "$x" | tail -1)" = 200 ] && printf '%s' "$x" | sed '$d' | jq -e . >/dev/null || exit 1; done; echo ALL_OK
```
```output
true
T=ai-tools-review
config => 200 {"content_type":"ai-tools-review","source":"yaml","config":{"content_type":"ai-tools-review","title":"AI工具评测（一人公司视角）","version
pipelines/daily-stats => 200 {"date":"2026-10-11","completed":0,"in_progress":0,"failed":0,"queued":0,"total":2}
pipelines?limit=5 => 200 [{"id":"eea9b538-dc15-4fcf-b95b-269d35806fca","title":"[内容工厂] qa-canary6-up-1791723527 (ai-tools-review)","status":"cancelled","priority":"P1"
ALL_OK
```

### T-7
对应: Q-7
verdict: PASS
（第 1 次。要先写入再读，所以按规定跑两次。）
```command
B=http://localhost:5301; RID="coding-workflow:$(node -e "process.stdout.write(require('crypto').randomUUID())")"; ENC=$(node -e "process.stdout.write(encodeURIComponent(process.argv[1]))" "$RID"); echo "RID=$RID"; W=$(curl -sS -w '\n%{http_code}' -X POST "$B/api/brain/spans" -H 'content-type: application/json' -H 'x-session-id: coding-workflow-runner' -d "[{\"run_id\":\"$RID\",\"activity_id\":\"c0de0000-0000-4000-8000-000000000102\",\"occurrence_key\":\"qa/a\",\"started_at\":\"2026-10-11T10:00:00.000Z\",\"ended_at\":\"2026-10-11T10:00:05.000Z\",\"executor_kind\":\"agent\",\"outcome\":\"pass\"},{\"run_id\":\"$RID\",\"activity_id\":\"c0de0000-0000-4000-8000-000000000102\",\"occurrence_key\":\"qa/b\",\"started_at\":\"2026-10-11T10:00:10.000Z\",\"ended_at\":\"2026-10-11T10:00:20.000Z\",\"executor_kind\":\"agent\",\"outcome\":\"pass\"}]"); echo "post => $(echo $W)"; [ "$(printf '%s' "$W" | tail -1)" = 200 ] && printf '%s' "$W" | sed '$d' | jq -e '.inserted==2' >/dev/null || exit 1; G1=$(curl -sS -w '\n%{http_code}' "$B/api/brain/runs/$ENC"); echo "get => $(echo $G1 | head -c 300)"; [ "$(printf '%s' "$G1" | tail -1)" = 200 ] && printf '%s' "$G1" | sed '$d' | jq -e --arg r "$RID" '.run_id==$r and (has("spans")|not)' >/dev/null || exit 1; G2=$(curl -sS -w '\n%{http_code}' "$B/api/brain/runs/$ENC?include=spans"); echo "spans => $(printf '%s' "$G2" | tail -1) $(printf '%s' "$G2" | sed '$d' | jq -c '[.spans[].occurrence_key]')"; [ "$(printf '%s' "$G2" | tail -1)" = 200 ] && printf '%s' "$G2" | sed '$d' | jq -e '[.spans[].occurrence_key]==["qa/a","qa/b"]' >/dev/null || exit 1; NE=$(node -e "process.stdout.write(encodeURIComponent('coding-workflow:'+require('crypto').randomUUID()))"); G3=$(curl -sS -w '\n%{http_code}' "$B/api/brain/runs/$NE"); echo "missing => $(echo $G3)"; [ "$(printf '%s' "$G3" | tail -1)" = 404 ] && printf '%s' "$G3" | sed '$d' | jq -e '.error|contains("not found")'
```
```output
RID=coding-workflow:0aa06f24-6ade-416a-9886-c429f6968886
post => {"inserted":2,"skipped":0,"count":2,"ids":["5f7a26c6-082c-4ad3-9c83-f4c9fdbb3a8b","bff7d44c-2948-4df3-86c5-f6eb0f23cae1"]}
200
get => {"id":"bfdfd365-5676-42a3-b4d3-ddd718756e8a","run_id":"coding-workflow:0aa06f24-6ade-416a-9886-c429f6968886","workflow_id":null,"trigger_kind":"external","trigger_ref":null,"schedule_entry_id":null,"task_run_id":null,"executor_kind":null,"executor_id":null,"started_at":"2026-10-11T10:00:00.000Z","en
spans => 200 ["qa/a","qa/b"]
missing => {"error":"run not found: coding-workflow:a4fcff96-0380-4f5f-ad92-b394560e94af"}
404
true
```

### T-8
对应: Q-7
verdict: PASS
（第 2 次，命令与 T-7 完全相同，每次生成新的 run_id。两次结果一致，不 FLAKY。）
```command
B=http://localhost:5301; RID="coding-workflow:$(node -e "process.stdout.write(require('crypto').randomUUID())")"; ENC=$(node -e "process.stdout.write(encodeURIComponent(process.argv[1]))" "$RID"); echo "RID=$RID"; W=$(curl -sS -w '\n%{http_code}' -X POST "$B/api/brain/spans" -H 'content-type: application/json' -H 'x-session-id: coding-workflow-runner' -d "[{\"run_id\":\"$RID\",\"activity_id\":\"c0de0000-0000-4000-8000-000000000102\",\"occurrence_key\":\"qa/a\",\"started_at\":\"2026-10-11T10:00:00.000Z\",\"ended_at\":\"2026-10-11T10:00:05.000Z\",\"executor_kind\":\"agent\",\"outcome\":\"pass\"},{\"run_id\":\"$RID\",\"activity_id\":\"c0de0000-0000-4000-8000-000000000102\",\"occurrence_key\":\"qa/b\",\"started_at\":\"2026-10-11T10:00:10.000Z\",\"ended_at\":\"2026-10-11T10:00:20.000Z\",\"executor_kind\":\"agent\",\"outcome\":\"pass\"}]"); echo "post => $(echo $W)"; [ "$(printf '%s' "$W" | tail -1)" = 200 ] && printf '%s' "$W" | sed '$d' | jq -e '.inserted==2' >/dev/null || exit 1; G1=$(curl -sS -w '\n%{http_code}' "$B/api/brain/runs/$ENC"); echo "get => $(echo $G1 | head -c 300)"; [ "$(printf '%s' "$G1" | tail -1)" = 200 ] && printf '%s' "$G1" | sed '$d' | jq -e --arg r "$RID" '.run_id==$r and (has("spans")|not)' >/dev/null || exit 1; G2=$(curl -sS -w '\n%{http_code}' "$B/api/brain/runs/$ENC?include=spans"); echo "spans => $(printf '%s' "$G2" | tail -1) $(printf '%s' "$G2" | sed '$d' | jq -c '[.spans[].occurrence_key]')"; [ "$(printf '%s' "$G2" | tail -1)" = 200 ] && printf '%s' "$G2" | sed '$d' | jq -e '[.spans[].occurrence_key]==["qa/a","qa/b"]' >/dev/null || exit 1; NE=$(node -e "process.stdout.write(encodeURIComponent('coding-workflow:'+require('crypto').randomUUID()))"); G3=$(curl -sS -w '\n%{http_code}' "$B/api/brain/runs/$NE"); echo "missing => $(echo $G3)"; [ "$(printf '%s' "$G3" | tail -1)" = 404 ] && printf '%s' "$G3" | sed '$d' | jq -e '.error|contains("not found")'
```
```output
RID=coding-workflow:029a1bf1-095b-48a2-a25c-e6833600a176
post => {"inserted":2,"skipped":0,"count":2,"ids":["15d7629c-d2d7-4785-bd7a-a2c68d4ae521","cd38a116-6daa-4181-a29b-841820fc4cca"]}
200
get => {"id":"851e93b3-85e3-4800-9c02-558c0f5a2574","run_id":"coding-workflow:029a1bf1-095b-48a2-a25c-e6833600a176","workflow_id":null,"trigger_kind":"external","trigger_ref":null,"schedule_entry_id":null,"task_run_id":null,"executor_kind":null,"executor_id":null,"started_at":"2026-10-11T10:00:00.000Z","en
spans => 200 ["qa/a","qa/b"]
missing => {"error":"run not found: coding-workflow:8efa54c2-1224-49f0-bf83-663676a7990b"}
404
true
```

### T-9
对应: Q-8
verdict: PASS
（第 1 次：两组各 20 次，每组用 `xargs -P 10` 并发。）
```command
B=http://localhost:5301; A=$(seq 1 20 | xargs -P 10 -I{} curl -sS -w ' %{http_code}\n' "$B/api/brain/runs/stats" | sort | uniq -c); P=$(seq 1 20 | xargs -P 10 -I{} curl -sS -w ' %{http_code}\n' "$B/api/brain/pipelines/not-a-uuid/stats" | sort | uniq -c); echo "runs: $A"; echo "pipelines: $P"; H=$(curl -sS -o /dev/null -w '%{http_code}' "$B/api/brain/health"); echo "health=$H"; [ "$(echo "$A" | awk '{print $1}')" = 20 ] && echo "$A" | grep -q '{"error":"run not found: stats"} 404' && [ "$(echo "$P" | awk '{print $1}')" = 20 ] && echo "$P" | grep -q '{"error":"invalid pipeline id: must be a UUID"} 400' && [ "$H" = 200 ]
```
```output
runs:   20 {"error":"run not found: stats"} 404
pipelines:   20 {"error":"invalid pipeline id: must be a UUID"} 400
health=200
```

### T-10
对应: Q-8
verdict: PASS
（第 2 次：两组 40 次请求交错放进同一个 `xargs -P 10` 里真正同时发，结果与 T-9 一致，没有 500，Brain 还活着。）
```command
B=http://localhost:5301; OUT=$( (for i in $(seq 1 20); do echo "runs/stats"; echo "pipelines/not-a-uuid/stats"; done) | xargs -P 10 -I{} curl -sS -w ' %{http_code} {}\n' "$B/api/brain/{}" | sort | uniq -c); echo "$OUT"; H=$(curl -sS -o /dev/null -w '%{http_code}' "$B/api/brain/health"); echo "health=$H"; [ "$(echo "$OUT" | wc -l | tr -d ' ')" = 2 ] && echo "$OUT" | grep -q '20 {"error":"run not found: stats"} 404 runs/stats' && echo "$OUT" | grep -q '20 {"error":"invalid pipeline id: must be a UUID"} 400 pipelines/not-a-uuid/stats' && [ "$H" = 200 ]
```
```output
  20 {"error":"invalid pipeline id: must be a UUID"} 400 pipelines/not-a-uuid/stats
  20 {"error":"run not found: stats"} 404 runs/stats
health=200
```

### X-1
对应: I-1, I-2
verdict: PASS
场景: 试各种边界路径：末尾带斜杠、大写段名、别名挂载下的非 UUID 段、空格 id、差一位的伪 UUID、空 id、编码的斜杠。都没有 500，也没有出现 PG 错误文本；`/runs/*` 都由 runs 读路由按 run_id 回 404；别名挂载下的非 UUID 段落到 Express 全局 404（符合 S-1 失败语义）。
```command
B=http://localhost:5301; for u in "runs/stats/" "runs/STATS" "foo/stats" "not-a-uuid/publish-status" "pipelines/%20/stats" "pipelines/00000000-0000-0000-0000-00000000000g/stats" "pipelines//stats" "runs/%2Fstats"; do echo "GET /api/brain/$u => $(curl -sS -w ' %{http_code}' "$B/api/brain/$u" | head -c 200)"; done
```
```output
GET /api/brain/runs/stats/ => {"error":"run not found: stats"} 404
GET /api/brain/runs/STATS => {"error":"run not found: STATS"} 404
GET /api/brain/foo/stats => <!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Error</title>
</head>
<body>
<pre>Cannot GET /api/brain/foo/stats</pre>
</body>
</html>
 404
GET /api/brain/not-a-uuid/publish-status => <!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Error</title>
</head>
<body>
<pre>Cannot GET /api/brain/not-a-uuid/publish-status</pre>
</body>
</html>
 404
GET /api/brain/pipelines/%20/stats => {"error":"invalid pipeline id: must be a UUID"} 400
GET /api/brain/pipelines/00000000-0000-0000-0000-00000000000g/stats => {"error":"invalid pipeline id: must be a UUID"} 400
GET /api/brain/pipelines//stats => <!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Error</title>
</head>
<body>
<pre>Cannot GET /api/brain/pipelines//stats</pre>
</body>
</html>
 404
GET /api/brain/runs/%2Fstats => {"error":"run not found: /stats"} 404
```

### X-2
对应: I-3
verdict: PASS
场景: 在别名挂载 `/api/brain/<合法uuid>/<子路径>` 下请求自己新建的流水线，四个子路径照旧由内容流水线返回 200，`pipeline_id` 正确（guard 只放行非 UUID，合法 UUID 的行为没变）；最后软删除清理。
```command
B=http://localhost:5301; T=$(curl -sS "$B/api/brain/content-types" | jq -r 'if (.[0]|type)=="string" then .[0] else (.[0].content_type // .[0].name // .[0].id) end'); P=$(curl -sS -X POST "$B/api/brain/pipelines" -H 'content-type: application/json' -d "{\"keyword\":\"qa-canary6-alias-$(date +%s)\",\"content_type\":\"$T\"}" | jq -r .id); echo "P=$P"; ok=1; for s in stats stages output publish-status; do r=$(curl -sS -w '\n%{http_code}' "$B/api/brain/$P/$s"); echo "alias $s => $(printf '%s' "$r" | tail -1) $(printf '%s' "$r" | sed '$d' | head -c 120)"; [ "$(printf '%s' "$r" | tail -1)" = 200 ] && printf '%s' "$r" | sed '$d' | jq -e --arg p "$P" '.pipeline_id==$p' >/dev/null || ok=0; done; G=$(curl -sS -X DELETE "$B/api/brain/tasks/$P" | jq -r .status); echo "cleanup=$G"; [ "$ok" = 1 ] && [ "$G" = cancelled ]
```
```output
P=86974187-b507-4abe-964f-b1b548482846
alias stats => 200 {"pipeline_id":"86974187-b507-4abe-964f-b1b548482846","stats":[]}
alias stages => 200 {"pipeline_id":"86974187-b507-4abe-964f-b1b548482846","stages":{}}
alias output => 200 {"pipeline_id":"86974187-b507-4abe-964f-b1b548482846","output":{"keyword":"qa-canary6-alias-1791723570","status":"queued
alias publish-status => 200 {"pipeline_id":"86974187-b507-4abe-964f-b1b548482846","platforms":[]}
cleanup=cancelled
```

### X-3
对应: I-2
严重度: 建议
场景: 调用方对内容流水线的写路由传非 UUID id（`POST /pipelines/not-a-uuid/run`、`PATCH /pipelines/not-a-uuid`），仍然拿到 500，body 里直接回显 PostgreSQL 原始错误 `invalid input syntax for type uuid`。这两条路由不在 I-2 的范围内（I-2 只要求 stats/stages/output/publish-status），规格「未覆盖真实链路」也已经登记为存量问题、建议另立任务，所以只记为建议，不影响本次需求的验收。
verdict: FAIL
```command
B=http://localhost:5301; curl -sS -w ' %{http_code}\n' -X POST "$B/api/brain/pipelines/not-a-uuid/run" -H 'content-type: application/json' -d '{}'; curl -sS -w ' %{http_code}\n' -X PATCH "$B/api/brain/pipelines/not-a-uuid" -H 'content-type: application/json' -d '{}'
```
```output
{"error":"invalid input syntax for type uuid: \"not-a-uuid\""} 500
{"error":"invalid input syntax for type uuid: \"not-a-uuid\""} 500
```
