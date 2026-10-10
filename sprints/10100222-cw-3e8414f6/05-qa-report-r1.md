---
task_id: 3e8414f6-19a4-415a-9b27-8e6353e9c6e2
step: evaluate
upstream: ["02-spec.md#Q-1", "02-spec.md#Q-2", "02-spec.md#Q-3", "02-spec.md#Q-4", "02-spec.md#Q-5", "02-spec.md#Q-6", "02-spec.md#Q-7", "02-spec.md#Q-8"]
---
# QA 报告（第 1 轮，环境 http://localhost:5301）

环境说明：
- 被测：预览环境 `http://localhost:5301`（PR 版本 Brain，`/api/brain/health` 显示 `runtime.isolated:true`、`background_automation:false`，进程环境 `CECELIA_TICK_ENABLED=false`，库 `cecelia_preview_6160`，tasks 表 738 行，其中 queued 27 条、task_type=dev 16 条——前提数据充足，无需另建任务）。
- 基线（Q-7 用）：`git worktree add --detach /tmp/qa6160-base origin/main`（main @ 937905ee3），用 `pg_dump` 把预览库完整复制为 `cecelia_qa6160_base`（复制后两库 tasks 均为 738 行），在 5298 端口以 `CECELIA_TICK_HARD_OFF=1` 启动，日志出现 `[tick-loop] CECELIA_TICK_HARD_OFF=1 — env 硬关（staging 隔离），跳过 tick loop/watchdog 启动`。未访问生产（5221）。测完已停服务、删临时库、移除 worktree。
- 本报告中 Q 场景里的 `5299` 端口一律替换为预览环境 `5301`。

### T-1
对应: Q-1
verdict: PASS
HTTP 400，`error=invalid_status`，`allowed` 含 queued / in_progress / completed，无 `details`、无 Postgres 报错文本。
```command
curl -s -w '\nHTTP %{http_code}\n' 'http://localhost:5301/api/brain/tasks?status=bogus'
```
```output
{"error":"invalid_status","message":"status 取值非法：bogus","allowed":["pending","queued","in_progress","blocked","quota_exhausted","paused","quarantined","canceled","cancelled","dep_failed","pending_postdeploy","completed","completed_no_pr","failed","archived"]}
HTTP 400
```

### T-2
对应: Q-2
verdict: PASS
`Queued`、`queue`、仅空格三次均 400 并带 `allowed`，没有静默返回 `[]`。
```command
for s in Queued queue %20; do curl -s -w '\nHTTP %{http_code}\n' "http://localhost:5301/api/brain/tasks?status=$s"; done
```
```output
{"error":"invalid_status","message":"status 取值非法：Queued","allowed":["pending","queued","in_progress","blocked","quota_exhausted","paused","quarantined","canceled","cancelled","dep_failed","pending_postdeploy","completed","completed_no_pr","failed","archived"]}
HTTP 400
{"error":"invalid_status","message":"status 取值非法：queue","allowed":["pending","queued","in_progress","blocked","quota_exhausted","paused","quarantined","canceled","cancelled","dep_failed","pending_postdeploy","completed","completed_no_pr","failed","archived"]}
HTTP 400
{"error":"invalid_status","message":"status 取值非法： ","allowed":["pending","queued","in_progress","blocked","quota_exhausted","paused","quarantined","canceled","cancelled","dep_failed","pending_postdeploy","completed","completed_no_pr","failed","archived"]}
HTTP 400
```

### T-3
对应: Q-3
verdict: PASS
五种非法 limit 均 400、`error=invalid_limit`、message 为「limit 必须是 1~1000 的正整数」；`-1` 和超大值不再 500，无 `details`、无 "LIMIT must not be negative" / "bigint out of range"。
```command
for q in 'limit=abc' 'limit=-1' 'limit=0' 'limit=1.5' 'status=queued&limit=99999999999999999999'; do echo "== $q"; curl -s -w '\nHTTP %{http_code}\n' "http://localhost:5301/api/brain/tasks?$q"; done
```
```output
== limit=abc
{"error":"invalid_limit","message":"limit 必须是 1~1000 的正整数","got":"abc"}
HTTP 400
== limit=-1
{"error":"invalid_limit","message":"limit 必须是 1~1000 的正整数","got":"-1"}
HTTP 400
== limit=0
{"error":"invalid_limit","message":"limit 必须是 1~1000 的正整数","got":"0"}
HTTP 400
== limit=1.5
{"error":"invalid_limit","message":"limit 必须是 1~1000 的正整数","got":"1.5"}
HTTP 400
== status=queued&limit=99999999999999999999
{"error":"invalid_limit","message":"limit 必须是 1~1000 的正整数","got":"99999999999999999999"}
HTTP 400
```

### T-4
对应: Q-4
verdict: PASS
两参数同时非法 → 400，返回 `invalid_status` 的明确说明。
```command
curl -s -w '\nHTTP %{http_code}\n' 'http://localhost:5301/api/brain/tasks?status=bogus&limit=abc'
```
```output
{"error":"invalid_status","message":"status 取值非法：bogus","allowed":["pending","queued","in_progress","blocked","quota_exhausted","paused","quarantined","canceled","cancelled","dep_failed","pending_postdeploy","completed","completed_no_pr","failed","archived"]}
HTTP 400
```

### T-5
对应: Q-5
verdict: PASS
库中 queued 27 条（>5），返回 200、恰 5 条、status 去重后只有 `queued`。
```command
curl -s -w '\nHTTP %{http_code}\n' -o /tmp/qa6160-q5.json 'http://localhost:5301/api/brain/tasks?status=queued&limit=5'; jq -c 'length, ([.[].status] | unique)' /tmp/qa6160-q5.json
```
```output
HTTP 200
5
["queued"]
```

### T-6
对应: Q-6
verdict: PASS
合法但无数据的状态返回 200 `[]`，未误报 400。
```command
curl -s -w '\nHTTP %{http_code}\n' 'http://localhost:5301/api/brain/tasks?status=quarantined&limit=3'
```
```output
[]
HTTP 200
```

### T-7
对应: Q-7
verdict: PASS
main 基线（5298，同数据库副本、tick 硬关）与本分支（5301）无参请求均 200、JSON 数组、各 100 条（≤100）；id 列表与顺序 diff 无输出（diff 退出码 0）。
```command
grep -iE 'tick' /tmp/qa6160-base.log | head -5; for p in 5298 5301; do echo "== $p"; curl -s -w '\nHTTP %{http_code}\n' "http://localhost:$p/api/brain/tasks" | head -c 300; echo; curl -s "http://localhost:$p/api/brain/tasks" | jq -c '{type: type, len: length}'; done; diff <(curl -s localhost:5298/api/brain/tasks | jq '[.[].id]') <(curl -s localhost:5301/api/brain/tasks | jq '[.[].id]'); echo "diff_rc=$?"
```
```output
[SKIP] 003_feature_tick_system.sql (already applied)
[08:24:36] [tick-loop] CECELIA_TICK_HARD_OFF=1 — env 硬关（staging 隔离），跳过 tick loop/watchdog 启动
[nightly-tick] Next run in 275 minutes
[nightly-tick] Scheduler started (daily at 22:00)
== 5298
[{"id":"eefb8b7b-7f9c-450b-b4c8-f42c7e3b52c5","title":"Auto-Fix: PROBE_FAIL_EVOLUTION (RCA probe_evolution)",…
{"type":"array","len":100}
== 5301
[{"id":"eefb8b7b-7f9c-450b-b4c8-f42c7e3b52c5","title":"Auto-Fix: PROBE_FAIL_EVOLUTION (RCA probe_evolution)",…
{"type":"array","len":100}
diff_rc=0
```
上面 `head -c 300` 截掉了状态码行，状态码与改动前后对照另行实测如下（同时证明基线确实复现了原 bug：bogus→200 空、abc 被忽略、-1→500 透出库报错；本分支已修复且合法请求行为一致）：
```command
for p in 5298 5301; do for q in '' '?status=bogus' '?limit=abc' '?limit=-1' '?limit=5'; do printf '%s %-14s ' $p "$q"; curl -s -o /tmp/qa6160-r.json -w 'HTTP %{http_code} ' "http://localhost:$p/api/brain/tasks$q"; jq -c 'if type=="array" then {len: length, task_types: ([.[].task_type]|unique)} else . end' /tmp/qa6160-r.json | head -c 160; echo; done; done
```
```output
5298                HTTP 200 {"len":100,"task_types":[null]}

5298 ?status=bogus  HTTP 200 {"len":0,"task_types":[]}

5298 ?limit=abc     HTTP 200 {"len":100,"task_types":[null]}

5298 ?limit=-1      HTTP 500 {"error":"Failed to get tasks","details":"LIMIT must not be negative"}

5298 ?limit=5       HTTP 200 {"len":5,"task_types":[null]}

5301                HTTP 200 {"len":100,"task_types":[null]}

5301 ?status=bogus  HTTP 400 {"error":"invalid_status","message":"status 取值非法：bogus","allowed":["pending","queued","in_progress","blocked","quota_exhausted","paused","quarantined"
5301 ?limit=abc     HTTP 400 {"error":"invalid_limit","message":"limit 必须是 1~1000 的正整数","got":"abc"}

5301 ?limit=-1      HTTP 400 {"error":"invalid_limit","message":"limit 必须是 1~1000 的正整数","got":"-1"}

5301 ?limit=5       HTTP 200 {"len":5,"task_types":[null]}
```

### T-8
对应: Q-8
verdict: PASS
`task_type=dev&limit=2` → 200 数组 2 条且全为 dev；`limit=5` → 200 数组 5 条。（无筛选时元素 `task_type` 为 null 是 getTopTasks 返回形态，main 基线同样如此，见 T-7，非本次回归。）
```command
for q in 'task_type=dev&limit=2' 'limit=5'; do echo "== $q"; curl -s -w '\nHTTP %{http_code}\n' -o /tmp/qa6160-q8.json "http://localhost:5301/api/brain/tasks?$q"; jq -c '{type: type, len: length, task_types: ([.[].task_type]|unique)}' /tmp/qa6160-q8.json; done
```
```output
== task_type=dev&limit=2

HTTP 200
{"type":"array","len":2,"task_types":["dev"]}
== limit=5

HTTP 200
{"type":"array","len":5,"task_types":[null]}
```

### X-1
对应: I-1、I-2
verdict: PASS
探索：边界与怪异输入。上限 1000 合法、1001 拒绝；前导零/加号/科学计数/前置空格/空串/重复参数/逗号列表/全大写均 400 且说人话；`status=` 空串视为不筛选（200）。无任何 500 或库报错外泄。
```command
for q in 'limit=1000' 'limit=1001' 'limit=' 'status=' 'status=&limit=' 'limit=05' 'limit=%2B5' 'limit=1e3' 'limit=%205' 'status=queued&status=failed' 'limit=5&limit=6' 'status=queued,failed' 'task_type=dev&status=nope' 'status=QUEUED'; do printf '%-30s ' "$q"; curl -s -o /tmp/qa6160-r.json -w 'HTTP %{http_code} ' "http://localhost:5301/api/brain/tasks?$q"; jq -c 'if type=="array" then {len: length, statuses: ([.[].status]|unique)} else del(.allowed) end' /tmp/qa6160-r.json; done
```
```output
limit=1000                     HTTP 200 {"len":738,"statuses":["canceled","failed","paused","queued"]}
limit=1001                     HTTP 400 {"error":"invalid_limit","message":"limit 必须是 1~1000 的正整数","got":"1001"}
limit=                         HTTP 400 {"error":"invalid_limit","message":"limit 必须是 1~1000 的正整数","got":""}
status=                        HTTP 200 {"len":100,"statuses":["failed","paused","queued"]}
status=&limit=                 HTTP 400 {"error":"invalid_limit","message":"limit 必须是 1~1000 的正整数","got":""}
limit=05                       HTTP 400 {"error":"invalid_limit","message":"limit 必须是 1~1000 的正整数","got":"05"}
limit=%2B5                     HTTP 400 {"error":"invalid_limit","message":"limit 必须是 1~1000 的正整数","got":"+5"}
limit=1e3                      HTTP 400 {"error":"invalid_limit","message":"limit 必须是 1~1000 的正整数","got":"1e3"}
limit=%205                     HTTP 400 {"error":"invalid_limit","message":"limit 必须是 1~1000 的正整数","got":" 5"}
status=queued&status=failed    HTTP 400 {"error":"invalid_status","message":"status 取值非法：queued,failed"}
limit=5&limit=6                HTTP 400 {"error":"invalid_limit","message":"limit 必须是 1~1000 的正整数","got":["5","6"]}
status=queued,failed           HTTP 400 {"error":"invalid_status","message":"status 取值非法：queued,failed"}
task_type=dev&status=nope      HTTP 400 {"error":"invalid_status","message":"status 取值非法：nope"}
status=QUEUED                  HTTP 400 {"error":"invalid_status","message":"status 取值非法：QUEUED"}
```
备注（不判 FAIL，属规格约定）：`status=` 空串被当作「不筛选」，而 `limit=` 空串被拒为 400，两者处理不对称；规格 S-1 明确如此约定，且 `limit=05` 被拒对人略严格，记为观察项。

### X-2
对应: I-3、I-4
verdict: PASS
探索：真实用户界面不受影响。Playwright 打开 Dashboard「主理人指挥舱」（/workbench/overview），页面发出的三个 tasks 列表请求（status=in_progress/blocked/queued + limit）全部 200，页面正常显示作战板 10 个 queued 任务、「队列健康 10」；同一浏览器直接打开 `?status=bogus` 看到可读的 400 说明。截图：`sprints/10100222-cw-3e8414f6/qa-r1/workbench-overview.png`、`sprints/10100222-cw-3e8414f6/qa-r1/api-status-bogus.png`。另静态核对仓库内调用方（Dashboard/脚本）使用的 status/limit 取值全部落在新合法范围内（`/api/brain/tasks/projects?limit=2000` 是另一条路由，实测 200 不受影响）。
```command
cd /Users/administrator/worktrees/cecelia-cw/qa-6160-1 && NODE_PATH=$PWD/node_modules node --input-type=module -e "$(sed "s#from 'playwright'#from '$PWD/node_modules/playwright/index.mjs'#" /tmp/qa6160-pw.mjs)"
```
```output
title: Perfect21 url: http://localhost:5301/workbench/overview
200 /api/brain/tasks?status=in_progress&limit=20
200 /api/brain/tasks?status=blocked&limit=5
200 /api/brain/tasks?status=queued&limit=10
bogus page text: {"error":"invalid_status","message":"status 取值非法：bogus","allowed":["pending","qu
```

### X-3
对应: I-1、I-3
verdict: PASS
探索：并发连续快速提交 20 次非法请求全部稳定 400，随后合法请求仍 200，服务无异常。
```command
for i in $(seq 1 20); do curl -s -o /dev/null -w '%{http_code}\n' 'http://localhost:5301/api/brain/tasks?status=bogus' & done; wait; curl -s -o /dev/null -w 'after-burst valid: HTTP %{http_code}\n' 'http://localhost:5301/api/brain/tasks?status=queued&limit=5'
```
```output
400
400
400
400
400
400
400
400
400
400
400
400
400
400
400
400
400
400
400
400
after-burst valid: HTTP 200
```
