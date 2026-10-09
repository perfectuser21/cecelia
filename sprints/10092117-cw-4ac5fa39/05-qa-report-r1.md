---
task_id: 4ac5fa39-521e-48b8-8b1a-ae1b79bcba2d
step: evaluate
upstream: ["02-spec.md#Q-1", "02-spec.md#Q-2", "02-spec.md#Q-3", "02-spec.md#Q-4", "02-spec.md#Q-5", "02-spec.md#Q-6"]
---
# QA 报告（第 1 轮，环境 http://localhost:5301）

说明：Q-n 里写的 `localhost:5221` 是生产地址，本轮全部换成预览环境 `localhost:5301` 执行。

### T-1
对应: Q-1
verdict: PASS
返回 400，error 说明必须是 UUID；不含 `invalid input syntax` / `for type uuid`，也没有 `details` 字段。
```command
curl -s -w '\nHTTP=%{http_code}\n' http://localhost:5301/api/brain/tasks/not-a-uuid
```
```output
{"error":"Invalid task id: must be a UUID"}
HTTP=400
```

### T-2
对应: Q-2
verdict: PASS
id 为空格时返回 400；没有 PG 报错字样（`syntax`、`uuid:`），也没有 `details`。
```command
curl -s -w '\nHTTP=%{http_code}\n' http://localhost:5301/api/brain/tasks/%20
```
```output
{"error":"Invalid task id: must be a UUID"}
HTTP=400
```

### T-3
对应: Q-3
verdict: PASS
4 种误传的 id 都返回 400，都没有数据库报错，注入串也没有被回显。
```command
curl -s -w '\nHTTP=%{http_code}\n' http://localhost:5301/api/brain/tasks/123
curl -s -w '\nHTTP=%{http_code}\n' http://localhost:5301/api/brain/tasks/4ac5fa39
curl -s -w '\nHTTP=%{http_code}\n' http://localhost:5301/api/brain/tasks/4ac5fa39-521e-48b8-8b1a-ae1b79bcba2dXX
curl -s -w '\nHTTP=%{http_code}\n' "http://localhost:5301/api/brain/tasks/%27%20OR%201=1--"
```
```output
{"error":"Invalid task id: must be a UUID"}
HTTP=400
{"error":"Invalid task id: must be a UUID"}
HTTP=400
{"error":"Invalid task id: must be a UUID"}
HTTP=400
{"error":"Invalid task id: must be a UUID"}
HTTP=400
```

### T-4
对应: Q-4
verdict: PASS
先确认列表接口能正常返回数据，再请求一个不存在的合法 UUID：返回 404，响应体和期望完全一致。
```command
curl -s 'http://localhost:5301/api/brain/tasks?limit=1' | grep -oE '^\[\{"id":"[^"]*"'
curl -s -w '\nHTTP=%{http_code}\n' http://localhost:5301/api/brain/tasks/00000000-0000-4000-8000-000000000000
```
```output
[{"id":"eefb8b7b-7f9c-450b-b4c8-f42c7e3b52c5"
{"error":"Task not found","id":"00000000-0000-4000-8000-000000000000"}
HTTP=404
```

### T-5
对应: Q-5
verdict: PASS
用小写和大写的真实 id 各请求一次，都返回 200，且 `id` 都是小写的同一个任务 id。合法 id 没有被误伤。
```command
curl -s -w '\nHTTP=%{http_code}\n' http://localhost:5301/api/brain/tasks/eefb8b7b-7f9c-450b-b4c8-f42c7e3b52c5 | grep -oE '^\{"id":"[^"]*"|HTTP=.*'
curl -s -w '\nHTTP=%{http_code}\n' http://localhost:5301/api/brain/tasks/EEFB8B7B-7F9C-450B-B4C8-F42C7E3B52C5 | grep -oE '^\{"id":"[^"]*"|HTTP=.*'
```
```output
{"id":"eefb8b7b-7f9c-450b-b4c8-f42c7e3b52c5"
HTTP=200
{"id":"eefb8b7b-7f9c-450b-b4c8-f42c7e3b52c5"
HTTP=200
```

### T-6
对应: Q-6
verdict: PASS
用同一个非法 id 连续请求 3 次，3 次结果一致，都是 400。（这是 Q-6 的前半部分；`/chain` 子路由见 T-7。）
```command
for i in 1 2 3; do curl -s -w '\nHTTP=%{http_code}\n' $P/api/brain/tasks/not-a-uuid; done
```
```output
{"error":"Invalid task id: must be a UUID"}
HTTP=400
{"error":"Invalid task id: must be a UUID"}
HTTP=400
{"error":"Invalid task id: must be a UUID"}
HTTP=400
```
（执行时 `P=http://localhost:5301`）

### T-7
对应: Q-6
verdict: FAIL
期望 `/chain` 返回 200 和链路数据，实际返回 500，并把数据库报错放在 `details` 里透给调用方：`column "parent_task_id" does not exist`。新加的 UUID 校验并没有拦截 `/chain`：请求确实进了 chain 的处理函数，没有返回 400。这个 PR 的 diff 只在 `task-tasks.js` 里加了 4 行 GET `/:id` 校验，没有改 chain 的 SQL。所以这大概率是之前就有的问题：预览库的 tasks 表缺 `parent_task_id` 列，和这个 PR 不是同一个原因。但按 Q-6 的期望，结果就是不符合，所以判 FAIL。另外抽查了 5 个真实任务，`/chain` 全部是 500。
```command
curl -s -w '\nHTTP=%{http_code}\n' http://localhost:5301/api/brain/tasks/eefb8b7b-7f9c-450b-b4c8-f42c7e3b52c5/chain
```
```output
{"error":"Failed to get chain","details":"column \"parent_task_id\" does not exist"}
HTTP=500
```

### X-1
对应: I-1, I-2
verdict: PASS
探索：传一个超长 id（5000 个字符 a），返回 400，没有 500，也没有回显。传全 0 的 UUID（版本位不合规，但格式合法），照常查库，返回 404，没有被误判成 400。
```command
P=http://localhost:5301
curl -s -w '\nHTTP=%{http_code}\n' "$P/api/brain/tasks/$(python3 -c 'print("a"*5000)')"
curl -s -w '\nHTTP=%{http_code}\n' $P/api/brain/tasks/00000000-0000-0000-0000-000000000000
```
```output
{"error":"Invalid task id: must be a UUID"}
HTTP=400
{"error":"Task not found","id":"00000000-0000-0000-0000-000000000000"}
HTTP=404
```

### X-2
对应: I-1
严重度: 建议
场景: 用户请求 `/api/brain/tasks/not-a-uuid/chain`，没有得到"id 格式不对"的 400 提示，而是 500 加数据库报错 `column "parent_task_id" does not exist`。这和本需求"不透出数据库报错"的精神一致，但不在本次改动范围内（spec S-1 第 4 条明确不改 `/:id/chain`），也和 T-7 是同一个根因，所以只记为建议。
verdict: FAIL
```command
curl -s -w '\nHTTP=%{http_code}\n' $P/api/brain/tasks/not-a-uuid/chain
```
```output
{"error":"Failed to get chain","details":"column \"parent_task_id\" does not exist"}
HTTP=500
```
（执行时 `P=http://localhost:5301`）

### X-3
对应: I-1, I-3
verdict: PASS
用真实浏览器（Playwright Chromium）打开非法 id 和不存在 id 两个地址，看用户实际看到的内容：一个是 400 + 说人话的提示，一个是 404 + Task not found。截图：`sprints/10092117-cw-4ac5fa39/qa-r1/invalid.png`、`sprints/10092117-cw-4ac5fa39/qa-r1/notfound.png`。
```command
cd /Users/administrator/worktrees/cecelia-cw/qa-6139-1 && cp /tmp/qa6139.cjs ./node_modules/.qa6139.cjs && node ./node_modules/.qa6139.cjs; rm -f ./node_modules/.qa6139.cjs
```
```output
invalid 400 {"error":"Invalid task id: must be a UUID"}
notfound 404 {"error":"Task not found","id":"00000000-0000-4000-8000-000000000000"}
```
