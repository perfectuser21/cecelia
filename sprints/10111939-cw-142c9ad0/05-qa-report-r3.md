---
task_id: 142c9ad0-2150-4f03-978c-3dd30ab32ed1
step: evaluate
upstream: ["02-spec.md#Q-1", "02-spec.md#Q-2", "02-spec.md#Q-3", "02-spec.md#Q-4", "02-spec.md#Q-5", "02-spec.md#Q-6", "02-spec.md#Q-7", "02-spec.md#Q-8"]
---
# QA 报告（第 3 轮，环境 http://localhost:5301）

本轮开始时间：2026-10-11T13:56:36Z。全部请求只打预览环境 http://localhost:5301，没有访问生产。预览 Brain **没有配置 `CECELIA_INTERNAL_TOKEN`**（见 T-3：带错误 token 也放行），所以 runs 读路由走的是 loopback 放行分支。

### T-1
对应: Q-1
verdict: PASS
```command
B=http://localhost:5301; for s in stats stages output publish-status; do r=$(curl -sS -w '\n%{http_code}' "$B/api/brain/runs/$s"); echo "$r"; code=$(echo "$r" | tail -n1); body=$(echo "$r" | sed '$d'); [ "$code" = 404 ] || exit 1; echo "$body" | jq -e --arg s "$s" '.error == ("run not found: " + $s) and (has("pipeline_id")|not) and (has("platforms")|not) and (has("stages")|not)' || exit 1; echo "$body" | grep -q 'invalid input syntax' && exit 1; done; echo ALL_OK
```
```output
{"error":"run not found: stats"}
404
true
{"error":"run not found: stages"}
404
true
{"error":"run not found: output"}
404
true
{"error":"run not found: publish-status"}
404
true
ALL_OK
```
浏览器复核（全新 `browser.newContext()`），截图: qa-r3/q1-runs-stats.png
```command
cd /Users/administrator/worktrees/cecelia-cw/qa-6291-3 && sed -i '' "s#from 'playwright'#from '/Users/administrator/worktrees/cecelia-cw/qa-6291-3/node_modules/playwright/index.mjs'#" /tmp/qa-r3-pw.mjs && node /tmp/qa-r3-pw.mjs; echo exit=$?; ls sprints/10111939-cw-142c9ad0/qa-r3
```
```output
q1-runs-stats 404 {"error":"run not found: stats"} OK
q3-pipelines-not-uuid 400 {"error":"invalid pipeline id: must be a UUID"} OK
exit=0
q1-runs-stats.png
q3-pipelines-not-uuid.png
```

### T-2
对应: Q-2
verdict: PASS
说明：按第 2 次 commander 裁决后的 Q-2 执行。预览 Brain 未配 token → 走「loopback 放行」分支，期望 404 `run not found: stats`，实际一致；没有 500/400，也没有内容流水线字段。Q-2 操作 2（跑 vitest）属于单元测试，按 QA 规则不能当证据，本轮不执行；401 分支由 CI 中的 S-4 用例覆盖，QA 在预览环境无法触发（预览未配 token，见 T-3）。
```command
B=http://localhost:5301; r=$(curl -sS -w '\n%{http_code}' "$B/api/brain/runs/stats"); echo "$r"; code=$(echo "$r" | tail -n1); body=$(echo "$r" | sed '$d'); if [ "$code" = 401 ]; then echo "$body" | jq -e '.error.code == "UNAUTHORIZED"'; elif [ "$code" = 404 ]; then echo "$body" | jq -e '.error == "run not found: stats" and (has("stages")|not) and (has("publish_results")|not) and (has("pipeline_id")|not)'; else exit 1; fi
```
```output
{"error":"run not found: stats"}
404
true
```

### T-3
对应: Q-2
verdict: PASS
说明：确认预览环境的鉴权配置——带错误 token 仍然 404，说明预览 Brain 未配 `CECELIA_INTERNAL_TOKEN`，走的是 loopback 分支（不是被内容流水线接走：文案 `run not found:` 只有 runs 读路由会给）。
```command
B=http://localhost:5301; curl -sS -w '\n%{http_code}\n' -H 'x-internal-token: wrong-token-qa' "$B/api/brain/runs/stats"
```
```output
{"error":"run not found: stats"}
404
```

### T-4
对应: Q-3
verdict: PASS
截图（浏览器打开 `/api/brain/pipelines/not-a-uuid/stats`，全新上下文，见 T-1 的 Playwright 命令）: qa-r3/q3-pipelines-not-uuid.png
```command
B=http://localhost:5301; LONG=$(printf 'a%.0s' $(seq 1 300)); for p in not-a-uuid/stats not-a-uuid/stages not-a-uuid/output not-a-uuid/publish-status "1%27%20OR%20%271%27%3D%271/stats" "$LONG/stats"; do r=$(curl -sS -w '\n%{http_code}' "$B/api/brain/pipelines/$p"); echo "${p:0:40} => $(echo "$r" | tr '\n' ' ')"; code=$(echo "$r" | tail -n1); body=$(echo "$r" | sed '$d'); [ "$code" = 400 ] || exit 1; [ "$body" = '{"error":"invalid pipeline id: must be a UUID"}' ] || exit 1; echo "$body" | grep -Eqi 'invalid input syntax|syntax|uuid:' && exit 1; done; echo ALL_OK
```
```output
not-a-uuid/stats => {"error":"invalid pipeline id: must be a UUID"} 400 
not-a-uuid/stages => {"error":"invalid pipeline id: must be a UUID"} 400 
not-a-uuid/output => {"error":"invalid pipeline id: must be a UUID"} 400 
not-a-uuid/publish-status => {"error":"invalid pipeline id: must be a UUID"} 400 
1%27%20OR%20%271%27%3D%271/stats => {"error":"invalid pipeline id: must be a UUID"} 400 
aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa => {"error":"invalid pipeline id: must be a UUID"} 400 
ALL_OK
```

### T-5
对应: Q-4
verdict: PASS
说明：自造数据，创建后四个子路径都 200 且字段正确，末尾 DELETE 清理为 cancelled。
```command
B=http://localhost:5301; T=$(curl -sS "$B/api/brain/content-types" | jq -r '.[0] | if type=="object" then (.content_type // .type // .name // .id) else . end'); if [ -z "$T" ] || [ "$T" = null ]; then curl -sS -X POST "$B/api/brain/content-types/seed" >/dev/null; T=$(curl -sS "$B/api/brain/content-types" | jq -r '.[0] | if type=="object" then (.content_type // .type // .name // .id) else . end'); fi; echo "T=$T"; KW="qa-canary6-$(date +%s)"; r=$(curl -sS -w '\n%{http_code}' -X POST "$B/api/brain/pipelines" -H 'content-type: application/json' -d "{\"keyword\":\"$KW\",\"content_type\":\"$T\"}"); echo "$r"; [ "$(echo "$r" | tail -n1)" = 201 ] || exit 1; P=$(echo "$r" | sed '$d' | jq -r '.id'); echo "$P" | grep -Eqi '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' || exit 1; ok=1; for s in stats stages output publish-status; do r=$(curl -sS -w '\n%{http_code}' "$B/api/brain/pipelines/$P/$s"); code=$(echo "$r" | tail -n1); body=$(echo "$r" | sed '$d'); echo "$s $code $(echo "$body" | head -c 300)"; [ "$code" = 200 ] || ok=0; case $s in stats) f='.pipeline_id==$p and (.stats|type=="array")';; stages) f='.pipeline_id==$p and (.stages|type=="object")';; output) f='.pipeline_id==$p and .output.keyword==$k';; publish-status) f='.pipeline_id==$p and (.platforms|type=="array")';; esac; echo "$body" | jq -e --arg p "$P" --arg k "$KW" "$f" || ok=0; done; curl -sS -X DELETE "$B/api/brain/tasks/$P" | jq -c '{id,status}'; [ $ok = 1 ]
```
```output
T=ai-tools-review
{"id":"3fc64ed2-e8e3-446c-a275-ea101a14e272","goal_id":null,"project_id":null,"title":"[内容工厂] qa-canary6-1791727020 (ai-tools-review)",…,"status":"queued",…,"task_type":"content-pipeline",…,"kind":"workflow"}
201
stats 200 {"pipeline_id":"3fc64ed2-e8e3-446c-a275-ea101a14e272","stats":[]}
true
stages 200 {"pipeline_id":"3fc64ed2-e8e3-446c-a275-ea101a14e272","stages":{}}
true
output 200 {"pipeline_id":"3fc64ed2-e8e3-446c-a275-ea101a14e272","output":{"keyword":"qa-canary6-1791727020","status":"queued","article_text":null,"cards_text":null,"image_urls":[],"export_path":null,"images":null}}
true
publish-status 200 {"pipeline_id":"3fc64ed2-e8e3-446c-a275-ea101a14e272","platforms":[]}
true
{"id":"3fc64ed2-e8e3-446c-a275-ea101a14e272","status":"cancelled"}
```

### T-6
对应: Q-5
verdict: PASS
说明：为了命令自包含（可搬进 smoke），本条自己新建一条流水线作大写 UUID 测试对象，而不是复用 T-5 的 id；T-5 的 id 已在 T-5 末尾清理。
```command
B=http://localhost:5301; U=$(node -e "console.log(require('crypto').randomUUID())"); r=$(curl -sS -w '\n%{http_code}' "$B/api/brain/pipelines/$U/output"); echo "U=$U => $(echo "$r" | tr '\n' ' ')"; [ "$(echo "$r" | tail -n1)" = 404 ] || exit 1; echo "$r" | sed '$d' | jq -e '.error == "Pipeline 不存在"' || exit 1; T=$(curl -sS "$B/api/brain/content-types" | jq -r '.[0] | if type=="object" then (.content_type // .type // .name // .id) else . end'); P=$(curl -sS -X POST "$B/api/brain/pipelines" -H 'content-type: application/json' -d "{\"keyword\":\"qa-canary6-q5-$(date +%s)\",\"content_type\":\"$T\"}" | jq -r '.id'); PU=$(echo "$P" | tr 'a-f' 'A-F'); r=$(curl -sS -w '\n%{http_code}' "$B/api/brain/pipelines/$PU/stats"); echo "PU=$PU => $(echo "$r" | tr '\n' ' ')"; [ "$(echo "$r" | tail -n1)" = 200 ] || exit 1; r=$(curl -sS -w '\n%{http_code}' -X DELETE "$B/api/brain/tasks/$P"); echo "DELETE => $(echo "$r" | sed '$d' | jq -c '{id,status}') $(echo "$r" | tail -n1)"; [ "$(echo "$r" | tail -n1)" = 200 ] || exit 1; echo "$r" | sed '$d' | jq -e '.status == "cancelled"' || exit 1; curl -sS "$B/api/brain/tasks/$P" | jq -e -c 'select(.status == "cancelled") | {id,status}'
```
```output
U=494ab061-674e-43f6-9e31-588f5fad91cd => {"error":"Pipeline 不存在"} 404 
true
PU=52B5CAFE-C222-403B-BAF9-1A473F1CDB9D => {"pipeline_id":"52B5CAFE-C222-403B-BAF9-1A473F1CDB9D","stats":[]} 200 
DELETE => {"id":"52b5cafe-c222-403b-baf9-1a473f1cdb9d","status":"cancelled"} 200
true
{"id":"52b5cafe-c222-403b-baf9-1a473f1cdb9d","status":"cancelled"}
```

### T-7
对应: Q-6
verdict: PASS
说明：第一次尝试时用 `echo "$r"` 传 body，zsh 的 echo 会把 config 里的 `\n` 转成真换行，导致 jq 解析失败（命令本身的问题，不是产品问题，接口状态码已是 200）。改为写临时文件后重跑，结果如下。
```command
B=http://localhost:5301; TMP=$(mktemp); c=$(curl -sS -o $TMP -w '%{http_code}' "$B/api/brain/content-types"); [ "$c" = 200 ] || exit 1; T=$(jq -r '.[0] | if type=="object" then (.content_type // .type // .name // .id) else . end' $TMP); echo "content-types $c T=$T count=$(jq length $TMP)"; jq -e --arg t "$T" 'type=="array" and length>0 and (map(if type=="object" then (.content_type // .type // .name // .id) else . end) | index($t) != null)' $TMP || exit 1; c=$(curl -sS -o $TMP -w '%{http_code}' "$B/api/brain/content-types/$T/config"); echo "config $c $(jq -c '{content_type,source,keys:(.config|keys)}' $TMP)"; [ "$c" = 200 ] || exit 1; jq -e 'type=="object"' $TMP || exit 1; for u in "pipelines/daily-stats" "pipelines?limit=5"; do c=$(curl -sS -o $TMP -w '%{http_code}' "$B/api/brain/$u"); echo "$u $c $(jq -c 'if type=="array" then {array_len:length} else (keys) end' $TMP)"; [ "$c" = 200 ] || exit 1; jq -e 'type=="object" or type=="array"' $TMP || exit 1; done
```
```output
content-types 200 T=ai-tools-review count=8
true
config 200 {"content_type":"ai-tools-review","source":"yaml","keys":["content_type","copy_rules","description","images","outputs","review_rules","template","title","version"]}
true
pipelines/daily-stats 200 ["completed","date","failed","in_progress","queued","total"]
true
pipelines?limit=5 200 {"array_len":5}
true
```

### T-8
对应: Q-7
verdict: PASS
```command
B=http://localhost:5301; TMP=$(mktemp); RID="coding-workflow:$(node -e "process.stdout.write(require('crypto').randomUUID())")"; ENC=$(node -e "process.stdout.write(encodeURIComponent(process.argv[1]))" "$RID"); echo "RID=$RID"; BODY="[{\"run_id\":\"$RID\",\"activity_id\":\"c0de0000-0000-4000-8000-000000000102\",\"occurrence_key\":\"qa/a\",\"started_at\":\"2026-10-11T10:00:00.000Z\",\"ended_at\":\"2026-10-11T10:00:05.000Z\",\"executor_kind\":\"agent\",\"outcome\":\"pass\"},{\"run_id\":\"$RID\",\"activity_id\":\"c0de0000-0000-4000-8000-000000000102\",\"occurrence_key\":\"qa/b\",\"started_at\":\"2026-10-11T10:00:10.000Z\",\"ended_at\":\"2026-10-11T10:00:20.000Z\",\"executor_kind\":\"agent\",\"outcome\":\"pass\"}]"; c=$(curl -sS -o $TMP -w '%{http_code}' -X POST "$B/api/brain/spans" -H 'content-type: application/json' -H 'x-session-id: coding-workflow-runner' -d "$BODY"); echo "POST spans $c $(jq -c . $TMP)"; [ "$c" = 200 ] || exit 1; jq -e '.inserted == 2' $TMP || exit 1; c=$(curl -sS -o $TMP -w '%{http_code}' "$B/api/brain/runs/$ENC"); echo "GET run $c $(jq -c '{run_id,has_spans:has("spans")}' $TMP)"; [ "$c" = 200 ] || exit 1; jq -e --arg r "$RID" '.run_id == $r and (has("spans")|not)' $TMP || exit 1; c=$(curl -sS -o $TMP -w '%{http_code}' "$B/api/brain/runs/$ENC?include=spans"); echo "GET run+spans $c $(jq -c '[.spans[].occurrence_key]' $TMP)"; [ "$c" = 200 ] || exit 1; jq -e '[.spans[].occurrence_key] == ["qa/a","qa/b"]' $TMP || exit 1; ENC2=$(node -e "process.stdout.write(encodeURIComponent('coding-workflow:'+require('crypto').randomUUID()))"); c=$(curl -sS -o $TMP -w '%{http_code}' "$B/api/brain/runs/$ENC2"); echo "GET missing $c $(jq -c . $TMP)"; [ "$c" = 404 ] || exit 1; jq -e '.error | contains("not found")' $TMP
```
```output
RID=coding-workflow:b2a6d876-ee21-4215-9761-e1ef759f077d
POST spans 200 {"inserted":2,"skipped":0,"count":2,"ids":["12844875-0b86-477f-a1e7-0b4ec36499b5","c1856e89-ea23-4abc-b262-df87cc3cbcbf"]}
true
GET run 200 {"run_id":"coding-workflow:b2a6d876-ee21-4215-9761-e1ef759f077d","has_spans":false}
true
GET run+spans 200 ["qa/a","qa/b"]
true
GET missing 404 {"error":"run not found: coding-workflow:a6de27e0-53d9-48de-8e04-d0bebea5a2c2"}
true
```

### T-9
对应: Q-8
verdict: PASS
说明：并发场景，第 1 次。
```command
B=http://localhost:5301; A=$(seq 1 20 | xargs -P 10 -I{} curl -sS -w ' %{http_code}\n' "$B/api/brain/runs/stats" | sort | uniq -c); C=$(seq 1 20 | xargs -P 10 -I{} curl -sS -w ' %{http_code}\n' "$B/api/brain/pipelines/not-a-uuid/stats" | sort | uniq -c); printf '%s\n%s\n' "$A" "$C"; H=$(curl -sS -o /dev/null -w '%{http_code}' "$B/api/brain/health"); echo "health $H"; [ "$A" = '  20 {"error":"run not found: stats"} 404' ] && [ "$C" = '  20 {"error":"invalid pipeline id: must be a UUID"} 400' ] && [ "$H" = 200 ]
```
```output
  20 {"error":"run not found: stats"} 404
  20 {"error":"invalid pipeline id: must be a UUID"} 400
health 200
```

### T-10
对应: Q-8
verdict: PASS
说明：并发场景，第 2 次（同样命令复跑），结果与第 1 次一致，不 FLAKY。
```command
B=http://localhost:5301; A=$(seq 1 20 | xargs -P 10 -I{} curl -sS -w ' %{http_code}\n' "$B/api/brain/runs/stats" | sort | uniq -c); C=$(seq 1 20 | xargs -P 10 -I{} curl -sS -w ' %{http_code}\n' "$B/api/brain/pipelines/not-a-uuid/stats" | sort | uniq -c); printf '%s\n%s\n' "$A" "$C"; H=$(curl -sS -o /dev/null -w '%{http_code}' "$B/api/brain/health"); echo "health $H"; [ "$A" = '  20 {"error":"run not found: stats"} 404' ] && [ "$C" = '  20 {"error":"invalid pipeline id: must be a UUID"} 400' ] && [ "$H" = 200 ]
```
```output
  20 {"error":"run not found: stats"} 404
  20 {"error":"invalid pipeline id: must be a UUID"} 400
health 200
```

### X-1
对应: I-1, I-2
verdict: PASS
场景: 用户乱输路径——别名挂载下的任意非 uuid 段、多余段、大写、空格 id、空 id、只到 `/runs/`。都没有 500，也没有 PG 错误文本。`/api/brain/foo/stats` 等落到 Express 默认 404 HTML 页（规格 S-1 写明的预期行为）；`/pipelines/%20/stats` 照样 400；`/runs/` 返回可读的 `run_id is required`。
```command
B=http://localhost:5301; for u in "foo/stats" "runs/stats/extra" "runs/STATS" "runs/%20/stats" "pipelines//stats" "pipelines/%20/stats" "runs/" ; do printf '%s => ' "$u"; curl -sS -w ' [%{http_code}]\n' "$B/api/brain/$u" | head -c 300; echo; done
```
```output
foo/stats => <!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Error</title>
</head>
<body>
<pre>Cannot GET /api/brain/foo/stats</pre>
</body>
</html>
 [404]

runs/stats/extra => <!DOCTYPE html>
…
<pre>Cannot GET /api/brain/runs/stats/extra</pre>
…
 [404]

runs/STATS => {"error":"run not found: STATS"} [404]

runs/%20/stats => <!DOCTYPE html>
…
<pre>Cannot GET /api/brain/runs/%20/stats</pre>
…
 [404]

pipelines//stats => <!DOCTYPE html>
…
<pre>Cannot GET /api/brain/pipelines//stats</pre>
…
 [404]

pipelines/%20/stats => {"error":"invalid pipeline id: must be a UUID"} [400]

runs/ => {"error":"run_id is required"} [400]
```

### X-2
对应: I-3
verdict: PASS
场景: 别名挂载 `/api/brain/<合法 uuid>/{stats|stages|output|publish-status}`（库里不存在的随机 uuid）仍由内容流水线处理，行为与 `/pipelines/<uuid>` 一致（stats/stages/publish-status 200 空结果，output 404 `Pipeline 不存在`），没有被 guard 误拦。
```command
B=http://localhost:5301; U=$(node -e "console.log(require('crypto').randomUUID())"); for s in stats stages output publish-status; do printf '%s => ' $s; curl -sS -w ' [%{http_code}]\n' "$B/api/brain/$U/$s"; done; curl -sS -o /dev/null -w 'root %{http_code} %{content_type}\n' $B/
```
```output
stats => {"pipeline_id":"7a3ec42b-d124-4c1b-8a17-211b9d0509f6","stats":[]} [200]
stages => {"pipeline_id":"7a3ec42b-d124-4c1b-8a17-211b9d0509f6","stages":{}} [200]
output => {"error":"Pipeline 不存在"} [404]
publish-status => {"pipeline_id":"7a3ec42b-d124-4c1b-8a17-211b9d0509f6","platforms":[]} [200]
root 200 application/json; charset=utf-8
```

## 小结

| 场景 | 结论 |
|---|---|
| Q-1 /runs/<4段> 由 runs 读路由 404 | PASS（T-1，含截图） |
| Q-2 落到 runs 读路由鉴权中间件 | PASS（T-2/T-3；预览未配 token，走 loopback 404 分支；401 分支属单测范畴，QA 未执行） |
| Q-3 非 uuid 一律 400、无 PG 文本 | PASS（T-4，含截图） |
| Q-4 合法 uuid 四子路径 200 | PASS（T-5） |
| Q-5 不存在 uuid 404 / 大写 uuid 200 / 清理 | PASS（T-6） |
| Q-6 content-types 等非 :id 路由 | PASS（T-7） |
| Q-7 coding-workflow run_id 与 include=spans | PASS（T-8） |
| Q-8 并发 20+20、Brain 存活 | PASS（T-9/T-10 两次一致） |
| 探索 | 无阻断/重要问题（X-1、X-2） |
