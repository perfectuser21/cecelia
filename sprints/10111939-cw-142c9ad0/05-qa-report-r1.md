---
task_id: 142c9ad0-2150-4f03-978c-3dd30ab32ed1
step: evaluate
upstream: ["02-spec.md#Q-1","02-spec.md#Q-2","02-spec.md#Q-3","02-spec.md#Q-4","02-spec.md#Q-5","02-spec.md#Q-6","02-spec.md#Q-7","02-spec.md#Q-8"]
---
# QA 报告（第 1 轮，环境 http://localhost:5301）

本轮开始时间：2026-10-11T12:23:32Z。预览环境 git_sha=75bff476f（health 返回）。所有请求只打 http://localhost:5301，经本机 loopback 发出。

### T-1
对应: Q-1
verdict: PASS
```command
B=http://localhost:5301; for s in stats stages output publish-status; do R=$(curl -sS -w '\n%{http_code}' "$B/api/brain/runs/$s"); echo "$R"; C=$(echo "$R" | tail -1); BODY=$(echo "$R" | sed '$d'); [ "$C" = 404 ] || exit 1; echo "$BODY" | jq -e --arg s "$s" '.error == ("run not found: " + $s) and (has("pipeline_id")|not) and (has("platforms")|not) and (has("stages")|not)' >/dev/null || exit 1; echo "$BODY" | grep -q 'invalid input syntax' && exit 1; done; echo ALL_OK
```
```output
{"error":"run not found: stats"}
404
{"error":"run not found: stages"}
404
{"error":"run not found: output"}
404
{"error":"run not found: publish-status"}
404
ALL_OK
```

### T-2
对应: Q-2
verdict: CANNOT_VERIFY
原因: 环境前提不满足——预览环境 Brain 未配置 CECELIA_INTERNAL_TOKEN。按 `internal-auth.js` 的 `internalAuthOrLoopback`，配了 token 时无 token 请求必为 401；实际不带 token 的 loopback 请求直接拿到 runs 读路由的 404（走的是"未配 token + loopback 放行"分支），说明预览 Brain 没配 token，401 鉴权分支在本环境不可测。Q-2 本身写明"没配就跳过，注明未配 token，鉴权分支不可测"。附带可确认：请求确实落到了 runs 读路由（错误文案只有 runs 读路由会给），不是 500。
```command
B=http://localhost:5301; R=$(curl -sS -w '\n%{http_code}' "$B/api/brain/runs/stats"); echo "$R"; [ "$(echo "$R" | tail -1)" = 401 ] && echo "$R" | sed '$d' | jq -e '.error.code == "UNAUTHORIZED"'
```
```output
{"error":"run not found: stats"}
404
```

### T-3
对应: Q-3
verdict: PASS
```command
B=http://localhost:5301; LONG=$(printf 'a%.0s' $(seq 1 300)); for p in not-a-uuid/stats not-a-uuid/stages not-a-uuid/output not-a-uuid/publish-status "1%27%20OR%20%271%27%3D%271/stats" "$LONG/stats"; do R=$(curl -sS -w '\n%{http_code}' "$B/api/brain/pipelines/$p"); echo "${p:0:40} -> $(echo "$R" | tr '\n' ' ')"; [ "$(echo "$R" | tail -1)" = 400 ] || exit 1; BODY=$(echo "$R" | sed '$d'); echo "$BODY" | jq -e '. == {"error":"invalid pipeline id: must be a UUID"}' >/dev/null || exit 1; echo "$BODY" | grep -Eqi 'invalid input syntax|syntax|uuid:' && exit 1; done; echo ALL_OK
```
```output
not-a-uuid/stats -> {"error":"invalid pipeline id: must be a UUID"} 400 
not-a-uuid/stages -> {"error":"invalid pipeline id: must be a UUID"} 400 
not-a-uuid/output -> {"error":"invalid pipeline id: must be a UUID"} 400 
not-a-uuid/publish-status -> {"error":"invalid pipeline id: must be a UUID"} 400 
1%27%20OR%20%271%27%3D%271/stats -> {"error":"invalid pipeline id: must be a UUID"} 400 
aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa -> {"error":"invalid pipeline id: must be a UUID"} 400 
ALL_OK
```

### T-4
对应: Q-4, Q-5
verdict: PASS
说明：Q-4 造数据 → 四个子路由 → Q-5 随机 UUID / 大写 UUID / 软删除清理，一条命令内完成（$P 跨场景复用）。
```command
B=http://localhost:5301; set -o pipefail; T=$(curl -sS "$B/api/brain/content-types" | jq -r '.[0] | if type=="object" then (.content_type // .name // .id) else . end // empty'); if [ -z "$T" ]; then curl -sS -X POST "$B/api/brain/content-types/seed" >/dev/null; T=$(curl -sS "$B/api/brain/content-types" | jq -r '.[0] | if type=="object" then (.content_type // .name // .id) else . end // empty'); fi; echo "T=$T"; [ -n "$T" ] || exit 1; KW="qa-canary6-$(date +%s)"; R=$(curl -sS -w '\n%{http_code}' -X POST "$B/api/brain/pipelines" -H 'content-type: application/json' -d "{\"keyword\":\"$KW\",\"content_type\":\"$T\"}"); echo "$R" | tr '\n' ' '; echo; [ "$(echo "$R" | tail -1)" = 201 ] || exit 1; P=$(echo "$R" | sed '$d' | jq -r '.id'); echo "$P" | grep -Eq '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' || exit 1; ok=1; for s in stats stages output publish-status; do R=$(curl -sS -w '\n%{http_code}' "$B/api/brain/pipelines/$P/$s"); echo "$s -> $(echo "$R" | tr '\n' ' ' | cut -c1-300)"; [ "$(echo "$R" | tail -1)" = 200 ] || ok=0; BODY=$(echo "$R" | sed '$d'); case $s in stats) F='(.stats|type=="array")';; stages) F='(.stages|type=="object")';; output) F="(.output.keyword == \"$KW\")";; publish-status) F='(.platforms|type=="array")';; esac; echo "$BODY" | jq -e --arg p "$P" "(.pipeline_id == \$p) and $F" >/dev/null || ok=0; done; U=$(node -e "console.log(require('crypto').randomUUID())"); R=$(curl -sS -w '\n%{http_code}' "$B/api/brain/pipelines/$U/output"); echo "random/output -> $(echo "$R" | tr '\n' ' ')"; [ "$(echo "$R" | tail -1)" = 404 ] && echo "$R" | sed '$d' | jq -e '.error == "Pipeline 不存在"' >/dev/null || ok=0; PU=$(echo "$P" | tr a-f A-F); R=$(curl -sS -w '\n%{http_code}' "$B/api/brain/pipelines/$PU/stats"); echo "UPPER/stats -> $(echo "$R" | tr '\n' ' ')"; [ "$(echo "$R" | tail -1)" = 200 ] || ok=0; R=$(curl -sS -w '\n%{http_code}' -X DELETE "$B/api/brain/tasks/$P"); echo "DELETE -> $(echo "$R" | tr '\n' ' ' | cut -c1-200)"; [ "$(echo "$R" | tail -1)" = 200 ] && echo "$R" | sed '$d' | jq -e '.status == "cancelled"' >/dev/null || ok=0; G=$(curl -sS "$B/api/brain/tasks/$P"); echo "GET task status -> $(echo "$G" | jq -c '.status')"; echo "$G" | jq -e '.status == "cancelled"' >/dev/null || ok=0; [ $ok = 1 ] && echo ALL_OK
```
```output
T=ai-tools-review
{"id":"f8a6143a-11c1-47e2-b65a-c22297e0a34d","goal_id":null,"project_id":null,"title":"[内容工厂] qa-canary6-1791721441 (ai-tools-review)",…,"status":"queued","priority":"P1",…,"task_type":"content-pipeline",…,"kind":"workflow"} 201 
stats -> {"pipeline_id":"f8a6143a-11c1-47e2-b65a-c22297e0a34d","stats":[]} 200 
stages -> {"pipeline_id":"f8a6143a-11c1-47e2-b65a-c22297e0a34d","stages":{}} 200 
output -> {"pipeline_id":"f8a6143a-11c1-47e2-b65a-c22297e0a34d","output":{"keyword":"qa-canary6-1791721441","status":"queued","article_text":null,"cards_text":null,"image_urls":[],"export_path":null,"images":null}} 200 
publish-status -> {"pipeline_id":"f8a6143a-11c1-47e2-b65a-c22297e0a34d","platforms":[]} 200 
random/output -> {"error":"Pipeline 不存在"} 404 
UPPER/stats -> {"pipeline_id":"F8A6143A-11C1-47E2-B65A-C22297E0A34D","stats":[]} 200 
DELETE -> {"id":"f8a6143a-11c1-47e2-b65a-c22297e0a34d","goal_id":null,"project_id":null,"title":"[内容工厂] qa-canary6-1791721441 (ai-tools-review)","description":"内容工厂 Pipeline：关键词「qa-canary6-1791721441」，类型「ai-too
GET task status -> "cancelled"
ALL_OK
```

### T-5
对应: Q-6
verdict: PASS
说明：第一次执行时我的脚本用 `echo "$R"` 透传 body，zsh 的 echo 把 config JSON 里的 `\n` 转义展开成真实换行，导致 jq 解析失败（脚本问题，非产品问题；接口实际返回 200，见下方同一请求）。改用临时文件后重跑，以下为重跑命令与输出。
```command
B=http://localhost:5301; ok=1; F=$(mktemp); C=$(curl -sS -o $F -w '%{http_code}' "$B/api/brain/content-types"); echo "content-types -> $C $(head -c 200 $F)"; [ "$C" = 200 ] || ok=0; T=$(jq -r '.[0] | if type=="object" then (.content_type // .name // .id) else . end // empty' $F); jq -e --arg t "$T" 'type=="array" and length>0 and (map(if type=="object" then (.content_type // .name // .id) else . end) | index($t) != null)' $F >/dev/null || ok=0; C=$(curl -sS -o $F -w '%{http_code}' "$B/api/brain/content-types/$T/config"); echo "config -> $C $(jq -c '{content_type, source, type: type}' $F)"; [ "$C" = 200 ] && jq -e 'type=="object"' $F >/dev/null || ok=0; for u in "pipelines/daily-stats" "pipelines?limit=5"; do C=$(curl -sS -o $F -w '%{http_code}' "$B/api/brain/$u"); echo "$u -> $C $(head -c 150 $F)"; [ "$C" = 200 ] && jq -e '.' $F >/dev/null || ok=0; done; rm -f $F; [ $ok = 1 ] && echo ALL_OK
```
```output
content-types -> 200 ["ai-tools-review","ai-workflow-guide","data-analysis","long-form","promo-copy","short-form","solo-company-case","video-script"]
config -> 200 {"content_type":"ai-tools-review","source":"yaml","type":"object"}
pipelines/daily-stats -> 200 {"date":"2026-10-11","completed":0,"in_progress":0,"failed":0,"queued":0,"total":1}
pipelines?limit=5 -> 200 [{"id":"f8a6143a-11c1-47e2-b65a-c22297e0a34d","title":"[内容工厂] qa-canary6-1791721441 (ai-tools-review)","status":"cancelled","priority":"P1","p
ALL_OK
```

### T-6
对应: Q-7
verdict: PASS
```command
B=http://localhost:5301; ok=1; RID="coding-workflow:$(node -e "process.stdout.write(require('crypto').randomUUID())")"; ENC=$(node -e "process.stdout.write(encodeURIComponent(process.argv[1]))" "$RID"); echo "RID=$RID"; BODY="[{\"run_id\":\"$RID\",\"activity_id\":\"c0de0000-0000-4000-8000-000000000102\",\"occurrence_key\":\"qa/a\",\"started_at\":\"2026-10-11T10:00:00.000Z\",\"ended_at\":\"2026-10-11T10:00:05.000Z\",\"executor_kind\":\"agent\",\"outcome\":\"pass\"},{\"run_id\":\"$RID\",\"activity_id\":\"c0de0000-0000-4000-8000-000000000102\",\"occurrence_key\":\"qa/b\",\"started_at\":\"2026-10-11T10:00:10.000Z\",\"ended_at\":\"2026-10-11T10:00:20.000Z\",\"executor_kind\":\"agent\",\"outcome\":\"pass\"}]"; R=$(curl -sS -w '\n%{http_code}' -X POST "$B/api/brain/spans" -H 'content-type: application/json' -H 'x-session-id: coding-workflow-runner' -d "$BODY"); echo "POST spans -> $(echo "$R" | tr '\n' ' ')"; [ "$(echo "$R" | tail -1)" = 200 ] && echo "$R" | sed '$d' | jq -e '.inserted == 2' >/dev/null || ok=0; R=$(curl -sS -w '\n%{http_code}' "$B/api/brain/runs/$ENC"); echo "GET run -> $(echo "$R" | tr '\n' ' ' | cut -c1-300)"; [ "$(echo "$R" | tail -1)" = 200 ] && echo "$R" | sed '$d' | jq -e --arg r "$RID" '.run_id == $r and (has("spans")|not)' >/dev/null || ok=0; R=$(curl -sS -w '\n%{http_code}' "$B/api/brain/runs/$ENC?include=spans"); echo "GET run+spans -> $(echo "$R" | sed '$d' | jq -c '{run_id, keys: [.spans[].occurrence_key]}') $(echo "$R" | tail -1)"; [ "$(echo "$R" | tail -1)" = 200 ] && echo "$R" | sed '$d' | jq -e '[.spans[].occurrence_key] == ["qa/a","qa/b"]' >/dev/null || ok=0; NE=$(node -e "process.stdout.write(encodeURIComponent('coding-workflow:'+require('crypto').randomUUID()))"); R=$(curl -sS -w '\n%{http_code}' "$B/api/brain/runs/$NE"); echo "GET missing -> $(echo "$R" | tr '\n' ' ')"; [ "$(echo "$R" | tail -1)" = 404 ] && echo "$R" | sed '$d' | jq -e '.error | contains("not found")' >/dev/null || ok=0; [ $ok = 1 ] && echo ALL_OK
```
```output
RID=coding-workflow:3bc3518e-cb48-4cc7-a5a6-1d920212e252
POST spans -> {"inserted":2,"skipped":0,"count":2,"ids":["1e40dd9b-bb88-40bb-9d08-6af86d6c8467","0a890042-064a-4e89-b463-483360eb03b3"]} 200 
GET run -> {"id":"69612c03-2c30-4e14-85f6-21f2601065b9","run_id":"coding-workflow:3bc3518e-cb48-4cc7-a5a6-1d920212e252","workflow_id":null,"trigger_kind":"external","trigger_ref":null,"schedule_entry_id":null,"task_run_id":null,"executor_kind":null,"executor_id":null,"started_at":"2026-10-11T10:00:00.000Z","en
GET run+spans -> {"run_id":"coding-workflow:3bc3518e-cb48-4cc7-a5a6-1d920212e252","keys":["qa/a","qa/b"]} 200
GET missing -> {"error":"run not found: coding-workflow:b843b5d5-8599-4d39-a40a-93f35598b7ff"} 404 
ALL_OK
```

### T-7
对应: Q-8
verdict: PASS
```command
B=http://localhost:5301; A=$(seq 20 | xargs -P 10 -I{} curl -sS -w ' %{http_code}\n' "$B/api/brain/runs/stats" | sort | uniq -c); echo "$A"; P=$(seq 20 | xargs -P 10 -I{} curl -sS -w ' %{http_code}\n' "$B/api/brain/pipelines/not-a-uuid/stats" | sort | uniq -c); echo "$P"; H=$(curl -sS -o /dev/null -w '%{http_code}' "$B/api/brain/health"); echo "health=$H"; echo "$A" | grep -Eq '^ *20 \{"error":"run not found: stats"\} 404$' && echo "$P" | grep -Eq '^ *20 \{"error":"invalid pipeline id: must be a UUID"\} 400$' && [ "$H" = 200 ] && echo ALL_OK
```
```output
  20 {"error":"run not found: stats"} 404
  20 {"error":"invalid pipeline id: must be a UUID"} 400
health=200
ALL_OK
```

### X-1
对应: I-1, I-2, I-3
verdict: PASS
场景: 边界路径探索——别名挂载下未知段、尾斜杠、大写段名、空格 id、少一位的伪 UUID、别名挂载下合法 UUID。结果：未知段 `/api/brain/nonexistent-seg/stats` 不再被内容流水线吃掉，落到 Express 全局 404；`/runs/stats/` 与 `/runs/STATS` 都由 runs 读路由按 run_id 返回 404 可读错误；空格 id 和 35 位伪 UUID 在 `/pipelines` 下 400 固定文案、无 PG 错误；别名下合法 UUID `/api/brain/<uuid>/stages` 照旧 200（行为不变）。均符合规格。
```command
B=http://localhost:5301; for u in "api/brain/nonexistent-seg/stats" "api/brain/runs/stats/" "api/brain/pipelines/%20/stats" "api/brain/runs/STATS" "api/brain/pipelines/11111111-1111-4111-8111-11111111111/stats" "api/brain/f8a6143a-11c1-47e2-b65a-c22297e0a34d/stages"; do C=$(curl -sS -o /tmp/qa6x.json -w '%{http_code}' "$B/$u"); echo "$u -> $C $(head -c 160 /tmp/qa6x.json)"; done; C=$(curl -sS -o /tmp/qa6x.json -w '%{http_code}' -X POST "$B/api/brain/pipelines/not-a-uuid/run"); echo "POST pipelines/not-a-uuid/run -> $C $(head -c 200 /tmp/qa6x.json)"
```
```output
api/brain/nonexistent-seg/stats -> 404 <!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Error</title>
</head>
<body>
<pre>Cannot GET /api/brain/nonexistent-seg/stats</pre>
</body
api/brain/runs/stats/ -> 404 {"error":"run not found: stats"}
api/brain/pipelines/%20/stats -> 400 {"error":"invalid pipeline id: must be a UUID"}
api/brain/runs/STATS -> 404 {"error":"run not found: STATS"}
api/brain/pipelines/11111111-1111-4111-8111-11111111111/stats -> 400 {"error":"invalid pipeline id: must be a UUID"}
api/brain/f8a6143a-11c1-47e2-b65a-c22297e0a34d/stages -> 200 {"pipeline_id":"f8a6143a-11c1-47e2-b65a-c22297e0a34d","stages":{}}
POST pipelines/not-a-uuid/run -> 500 {"error":"invalid input syntax for type uuid: \"not-a-uuid\""}
```

### X-2
对应: I-2
严重度: 建议
场景: 调用方对内容流水线写路由 `POST /api/brain/pipelines/not-a-uuid/run` 传非 UUID id，仍返回 500 并把 PostgreSQL 原始错误 `invalid input syntax for type uuid` 回显给调用方（同 X-1 最后一行，同一次执行）。规格「未覆盖真实链路」已明确把 4 条 `/:id` 写路由排除在本次范围外、建议另立任务，因此不算本次验收失败；记录在案，建议后续统一处理非 UUID 写路由。
verdict: FAIL
```command
B=http://localhost:5301; for u in "api/brain/nonexistent-seg/stats" "api/brain/runs/stats/" "api/brain/pipelines/%20/stats" "api/brain/runs/STATS" "api/brain/pipelines/11111111-1111-4111-8111-11111111111/stats" "api/brain/f8a6143a-11c1-47e2-b65a-c22297e0a34d/stages"; do C=$(curl -sS -o /tmp/qa6x.json -w '%{http_code}' "$B/$u"); echo "$u -> $C $(head -c 160 /tmp/qa6x.json)"; done; C=$(curl -sS -o /tmp/qa6x.json -w '%{http_code}' -X POST "$B/api/brain/pipelines/not-a-uuid/run"); echo "POST pipelines/not-a-uuid/run -> $C $(head -c 200 /tmp/qa6x.json)"
```
```output
POST pipelines/not-a-uuid/run -> 500 {"error":"invalid input syntax for type uuid: \"not-a-uuid\""}
```
