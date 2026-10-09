---
task_id: 4ac5fa39-521e-48b8-8b1a-ae1b79bcba2d
step: evaluate
upstream: ["02-spec.md#Q-1", "02-spec.md#Q-2", "02-spec.md#Q-3", "02-spec.md#Q-4", "02-spec.md#Q-5", "02-spec.md#Q-6"]
---
# QA 报告（第 2 轮，环境 http://localhost:5301）

全部请求只打预览环境 http://localhost:5301，未访问生产。

### T-1
对应: Q-1
verdict: PASS
说明: 返回 400，error 文案说明 id 必须是 UUID；不含 `invalid input syntax` / `for type uuid`，也没有 `details` 字段。
```command
curl -s -w '\nHTTP=%{http_code}\n' http://localhost:5301/api/brain/tasks/not-a-uuid; echo ---; curl -s -w '\nHTTP=%{http_code}\n' http://localhost:5301/api/brain/tasks/%20; echo ---; for u in 123 4ac5fa39 4ac5fa39-521e-48b8-8b1a-ae1b79bcba2dXX "%27%20OR%201=1--"; do curl -s -w '\nHTTP=%{http_code}\n' "http://localhost:5301/api/brain/tasks/$u"; done; echo ---; curl -s -w '\nHTTP=%{http_code}\n' http://localhost:5301/api/brain/tasks/00000000-0000-4000-8000-000000000000
```
```output
{"error":"Invalid task id: must be a UUID"}
HTTP=400
---
```

### T-2
对应: Q-2
verdict: PASS
说明: id 为空格（%20）时返回 400，不含 `syntax`、`uuid:`，也没有 `details`。（命令同 T-1，这一段对应第二段输出）
```command
curl -s -w '\nHTTP=%{http_code}\n' http://localhost:5301/api/brain/tasks/not-a-uuid; echo ---; curl -s -w '\nHTTP=%{http_code}\n' http://localhost:5301/api/brain/tasks/%20; echo ---; for u in 123 4ac5fa39 4ac5fa39-521e-48b8-8b1a-ae1b79bcba2dXX "%27%20OR%201=1--"; do curl -s -w '\nHTTP=%{http_code}\n' "http://localhost:5301/api/brain/tasks/$u"; done; echo ---; curl -s -w '\nHTTP=%{http_code}\n' http://localhost:5301/api/brain/tasks/00000000-0000-4000-8000-000000000000
```
```output
---
{"error":"Invalid task id: must be a UUID"}
HTTP=400
---
```

### T-3
对应: Q-3
verdict: PASS
说明: 四种误传 id（`123`、短 id `4ac5fa39`、UUID 后多 `XX`、注入串 `' OR 1=1--`）都返回 400，不含数据库报错，也不回显注入串。（命令同 T-1，这一段对应第三段输出）
```command
curl -s -w '\nHTTP=%{http_code}\n' http://localhost:5301/api/brain/tasks/not-a-uuid; echo ---; curl -s -w '\nHTTP=%{http_code}\n' http://localhost:5301/api/brain/tasks/%20; echo ---; for u in 123 4ac5fa39 4ac5fa39-521e-48b8-8b1a-ae1b79bcba2dXX "%27%20OR%201=1--"; do curl -s -w '\nHTTP=%{http_code}\n' "http://localhost:5301/api/brain/tasks/$u"; done; echo ---; curl -s -w '\nHTTP=%{http_code}\n' http://localhost:5301/api/brain/tasks/00000000-0000-4000-8000-000000000000
```
```output
---
{"error":"Invalid task id: must be a UUID"}
HTTP=400
{"error":"Invalid task id: must be a UUID"}
HTTP=400
{"error":"Invalid task id: must be a UUID"}
HTTP=400
{"error":"Invalid task id: must be a UUID"}
HTTP=400
---
```

### T-4
对应: Q-4
verdict: PASS
说明: 先确认 `?limit=1` 能返回数据，服务正常（见 T-5 前提输出）；合法但不存在的 UUID 返回 404，响应体和期望一字不差。（命令同 T-1，这一段对应最后一段输出）
```command
curl -s -w '\nHTTP=%{http_code}\n' http://localhost:5301/api/brain/tasks/not-a-uuid; echo ---; curl -s -w '\nHTTP=%{http_code}\n' http://localhost:5301/api/brain/tasks/%20; echo ---; for u in 123 4ac5fa39 4ac5fa39-521e-48b8-8b1a-ae1b79bcba2dXX "%27%20OR%201=1--"; do curl -s -w '\nHTTP=%{http_code}\n' "http://localhost:5301/api/brain/tasks/$u"; done; echo ---; curl -s -w '\nHTTP=%{http_code}\n' http://localhost:5301/api/brain/tasks/00000000-0000-4000-8000-000000000000
```
```output
---
{"error":"Task not found","id":"00000000-0000-4000-8000-000000000000"}
HTTP=404
```

### T-5
对应: Q-5, Q-6
verdict: PASS
说明: 从 `?limit=1` 取到真实 id `eefb8b7b-…`。用小写和大写各请求一次，都是 200，`id` 都是小写原值，合法 id 没被误伤。对 `not-a-uuid` 连续请求 3 次，结果一致都是 400。之后请求真实 id 的 `/chain`，返回 200 和链路数据（`root` 节点），没有被新加的校验拦掉。
```command
P=http://localhost:5301
ID=$(curl -s "$P/api/brain/tasks?limit=1" | python3 -c 'import sys,json;print(json.load(sys.stdin)[0]["id"])'); echo ID=$ID
UP=$(echo $ID | tr a-f A-F); echo UP=$UP
curl -s -w '\nHTTP=%{http_code}\n' $P/api/brain/tasks/$ID | python3 -c 'import sys;d=sys.stdin.read();print(d[:120]);print(d.strip().splitlines()[-1])'
curl -s -w '\nHTTP=%{http_code}\n' $P/api/brain/tasks/$UP | python3 -c 'import sys;d=sys.stdin.read();print(d[:120]);print(d.strip().splitlines()[-1])'
for i in 1 2 3; do curl -s -w ' HTTP=%{http_code}\n' $P/api/brain/tasks/not-a-uuid; done
curl -s -w '\nHTTP=%{http_code}\n' $P/api/brain/tasks/$ID/chain | head -c 600; echo
curl -s -w '\nHTTP=%{http_code}\n' $P/api/brain/tasks/$ID/chain | tail -1
```
```output
ID=eefb8b7b-7f9c-450b-b4c8-f42c7e3b52c5
UP=EEFB8B7B-7F9C-450B-B4C8-F42C7E3B52C5
{"id":"eefb8b7b-7f9c-450b-b4c8-f42c7e3b52c5","goal_id":null,"project_id":null,"title":"Auto-Fix: PROBE_FAIL_EVOLUTION (R
HTTP=200
{"id":"eefb8b7b-7f9c-450b-b4c8-f42c7e3b52c5","goal_id":null,"project_id":null,"title":"Auto-Fix: PROBE_FAIL_EVOLUTION (R
HTTP=200
{"error":"Invalid task id: must be a UUID"} HTTP=400
{"error":"Invalid task id: must be a UUID"} HTTP=400
{"error":"Invalid task id: must be a UUID"} HTTP=400
{"root":{"id":"eefb8b7b-7f9c-450b-b4c8-f42c7e3b52c5","title":"Auto-Fix: PROBE_FAIL_EVOLUTION (RCA probe_evolution)",…
HTTP=200
```

### T-6
对应: Q-1
verdict: PASS
说明: 用户直接在浏览器打开非法 id 的地址，看到的是一行可读的 JSON 提示，没有数据库报错。截图：`qa-r2/invalid-id.png`（页面内容为 `{"error":"Invalid task id: must be a UUID"}`）。
```command
rm -f /Users/administrator/worktrees/cecelia-cw/qa-6139-2/node_modules/.qa-r2-shot.mjs; npx playwright screenshot http://localhost:5301/api/brain/tasks/not-a-uuid /Users/administrator/worktrees/cecelia-cw/qa-6139-2/sprints/10092117-cw-4ac5fa39/qa-r2/invalid-id.png 2>&1 | tail -3
```
```output
Navigating to http://localhost:5301/api/brain/tasks/not-a-uuid
Capturing screenshot into /Users/administrator/worktrees/cecelia-cw/qa-6139-2/sprints/10092117-cw-4ac5fa39/qa-r2/invalid-id.png
```

### X-1
对应: I-1, I-2, I-3
verdict: PASS
场景: 探索更多边界输入。`/chain` 子路由传非法 id 或空格返回 400；不存在的 UUID 查 `/chain` 返回 404；5000 字符超长 id、中文 id、带花括号的 UUID、去掉连字符的 UUID、`%00` 都返回 400，且都不透出数据库报错，没有出现 500。PATCH 非法 id 时先返回字段校验错误（400，提示说人话），也没有 500。
备注（不算缺陷）: 去掉连字符的 32 位 UUID PG 本身能识别，这里按规格的正则判为 400，行为和规格一致。
```command
P=http://localhost:5301
curl -s -w '\nHTTP=%{http_code}\n' $P/api/brain/tasks/not-a-uuid/chain
curl -s -w '\nHTTP=%{http_code}\n' $P/api/brain/tasks/%20/chain
curl -s -w '\nHTTP=%{http_code}\n' $P/api/brain/tasks/00000000-0000-4000-8000-000000000000/chain
curl -s -w '\nHTTP=%{http_code}\n' -X PATCH $P/api/brain/tasks/not-a-uuid -H 'content-type: application/json' -d '{"priority":"P2"}'
curl -s -w '\nHTTP=%{http_code}\n' $P/api/brain/tasks/$(python3 -c 'print("a"*5000)') | head -c 200; echo
curl -s -w '\nHTTP=%{http_code}\n' "$P/api/brain/tasks/%E4%BB%BB%E5%8A%A1"
curl -s -w '\nHTTP=%{http_code}\n' "$P/api/brain/tasks/%7Beefb8b7b-7f9c-450b-b4c8-f42c7e3b52c5%7D"
curl -s -w '\nHTTP=%{http_code}\n' "$P/api/brain/tasks/eefb8b7b7f9c450bb4c8f42c7e3b52c5"
curl -s -w '\nHTTP=%{http_code}\n' "$P/api/brain/tasks/%00"
```
```output
{"error":"Invalid task id: must be a UUID"}
HTTP=400
{"error":"Invalid task id: must be a UUID"}
HTTP=400
{"error":"Task not found","id":"00000000-0000-4000-8000-000000000000"}
HTTP=404
{"success":false,"error":"Missing required field: status or result","code":"MISSING_FIELD"}
HTTP=400
{"error":"Invalid task id: must be a UUID"}
HTTP=400

{"error":"Invalid task id: must be a UUID"}
HTTP=400
{"error":"Invalid task id: must be a UUID"}
HTTP=400
{"error":"Invalid task id: must be a UUID"}
HTTP=400
{"error":"Invalid task id: must be a UUID"}
HTTP=400
```
