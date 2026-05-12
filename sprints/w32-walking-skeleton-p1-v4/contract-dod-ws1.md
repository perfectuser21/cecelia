---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Workstream 1: W32 Walking Skeleton P1 终验脚本 + 报告生成器

**范围**: 在 `sprints/w32-walking-skeleton-p1-v4/` 产出 `verify-p1.sh` 和（由它生成的）`p1-final-acceptance.md`；脚本依次完成 POST 创建 Initiative / 错误反向 / 轮询收敛 / 5 API + 2 SQL oracle 采集 / 报告渲染 8 个阶段；不改 `packages/brain/**`。
**大小**: M
**依赖**: 无（B1-B10 已 merge 进 main）

## ARTIFACT 条目

- [ ] [ARTIFACT] `sprints/w32-walking-skeleton-p1-v4/verify-p1.sh` 文件存在且 chmod +x
  Test: node -e "const fs=require('fs');const st=fs.statSync('sprints/w32-walking-skeleton-p1-v4/verify-p1.sh');if(!(st.mode & 0o111))process.exit(1)"

- [ ] [ARTIFACT] `verify-p1.sh` 内含 `curl -fs -X POST localhost:5221/api/brain/tasks` 创建 harness_initiative 的代码段
  Test: node -e "const c=require('fs').readFileSync('sprints/w32-walking-skeleton-p1-v4/verify-p1.sh','utf8');if(!/curl[^\n]+-X\s+POST[^\n]+\/api\/brain\/tasks/.test(c))process.exit(1);if(!/harness_initiative/.test(c))process.exit(1)"

- [ ] [ARTIFACT] `verify-p1.sh` 内含 `dispatch/recent?initiative_id=` query 字面（不使用 iid/task/root_id/n 等禁用名）
  Test: node -e "const c=require('fs').readFileSync('sprints/w32-walking-skeleton-p1-v4/verify-p1.sh','utf8');if(!/dispatch\/recent\?initiative_id=/.test(c))process.exit(1);for(const k of ['?iid=','?task=','?root_id=','?n=','?max=']){if(c.includes('dispatch/recent'+k)){console.error('forbidden query '+k);process.exit(1)}}"

- [ ] [ARTIFACT] `verify-p1.sh` 内含 `/api/brain/fleet/slots` 调用 + `in_use == in_progress_task_count` 不变量断言
  Test: node -e "const c=require('fs').readFileSync('sprints/w32-walking-skeleton-p1-v4/verify-p1.sh','utf8');if(!/\/api\/brain\/fleet\/slots/.test(c))process.exit(1);if(!/in_use[^\n]*in_progress_task_count/.test(c))process.exit(1)"

- [ ] [ARTIFACT] `verify-p1.sh` 内含 SQL `count(DISTINCT thread_id)` 检查 thread 连续性的代码段
  Test: node -e "const c=require('fs').readFileSync('sprints/w32-walking-skeleton-p1-v4/verify-p1.sh','utf8');if(!/count\(DISTINCT\s+thread_id\)/i.test(c))process.exit(1)"

- [ ] [ARTIFACT] `verify-p1.sh` 内含 SQL `last_heartbeat_at < NOW\(\) - interval '60 minutes'` zombie 反向检查（B8 60min 阈值）
  Test: node -e "const c=require('fs').readFileSync('sprints/w32-walking-skeleton-p1-v4/verify-p1.sh','utf8');if(!/last_heartbeat_at\s*<\s*NOW\(\)\s*-\s*interval\s*'60 minutes'/.test(c))process.exit(1)"

- [ ] [ARTIFACT] `verify-p1.sh` 渲染 `p1-final-acceptance.md` 含 `## Verdict: PASS|FAIL` 字面 + `## Oracle a-g 实测` + `## Anomaly` 三段
  Test: node -e "const c=require('fs').readFileSync('sprints/w32-walking-skeleton-p1-v4/verify-p1.sh','utf8');for(const seg of ['## Verdict:','## Oracle a-g 实测','## Anomaly']){if(!c.includes(seg)){console.error('script missing render of: '+seg);process.exit(1)}}"

- [ ] [ARTIFACT] `verify-p1.sh` 不含对 `packages/brain/**` 任何文件的写操作（编辑/sed/cp 输出到 brain 路径）
  Test: node -e "const c=require('fs').readFileSync('sprints/w32-walking-skeleton-p1-v4/verify-p1.sh','utf8');for(const pat of [/>\s*packages\/brain/,/sed\s+-i[^\n]*packages\/brain/,/cp\s+[^\n]+\s+packages\/brain/]){if(pat.test(c)){console.error('script writes into packages/brain');process.exit(1)}}"

- [ ] [ARTIFACT] `verify-p1.sh` 响应字段名严格字面引用 PRD（含 `status`/`thread_id`/`event_type`/`in_use`/`in_progress_task_count`，不引入禁用同义名）
  Test: node -e "const c=require('fs').readFileSync('sprints/w32-walking-skeleton-p1-v4/verify-p1.sh','utf8');for(const k of ['.status','.thread_id','.event_type','.in_use','.in_progress_task_count']){if(!c.includes(k)){console.error('missing literal field '+k);process.exit(1)}}for(const k of ['.state','.task_state','.phase','.stage','.used','.busy','.running_count']){if(c.includes('jq -e \\''+k) || c.includes('jq -e \"'+k)){console.error('forbidden field literal in jq -e: '+k);process.exit(1)}}"

- [ ] [ARTIFACT] **R2 新增 — Reviewer R1 修复**：`verify-p1.sh` 含 `tasks/{id}` 响应 `keys | sort == ["id","last_heartbeat_at","parent_task_id","result","status","task_type","thread_id"]` 严等校验字面（捕获 generator 加新字段 / alias 漂移，跟 dispatch/recent 的 `keys == ["count","events"]` 严等同构）
  Test: node -e "const c=require('fs').readFileSync('sprints/w32-walking-skeleton-p1-v4/verify-p1.sh','utf8');const need=`keys | sort == [\"id\",\"last_heartbeat_at\",\"parent_task_id\",\"result\",\"status\",\"task_type\",\"thread_id\"]`;if(!c.includes(need)){console.error('verify-p1.sh missing tasks/{id} keys|sort strict equality literal');process.exit(1)}"

- [ ] [ARTIFACT] **R2 新增**：`verify-p1.sh` 在 B5 HOL primary check 失败时含 secondary 并发触发逻辑（PRD oracle f 明示路径：未观察到 skipped→dispatched 时主动制造并发场景再测）
  Test: node -e "const c=require('fs').readFileSync('sprints/w32-walking-skeleton-p1-v4/verify-p1.sh','utf8');if(!/HOL_OK/.test(c)){console.error('missing HOL_OK variable');process.exit(1)}if(!/skipped[^\n]+dispatched/.test(c)){console.error('missing skipped/dispatched sequence check');process.exit(1)}"

## BEHAVIOR 条目（内嵌可执行 manual:bash 命令；evaluator v1.1 直接跑，不读 vitest）

- [ ] [BEHAVIOR] `POST /api/brain/tasks {task_type:"harness_initiative",prd:"...",priority:5}` 返 HTTP 201 + body schema = `{id,task_type:"harness_initiative",status:"pending"}` 字面，禁用 `state`/`task_state`/`phase`/`stage` 反向不存在
  Test: manual:bash -c 'curl -fs localhost:5221/api/brain/context > /dev/null || { echo "SKIP: Brain 不可达"; exit 1; }; TS=$(date +%s); RESP=$(curl -fs -X POST localhost:5221/api/brain/tasks -H "Content-Type: application/json" -d "{\"task_type\":\"harness_initiative\",\"prd\":\"W32 BEHAVIOR probe ${TS}\",\"priority\":5}"); echo "$RESP" | jq -e ".task_type == \"harness_initiative\" and .status == \"pending\" and (.id | type == \"string\")" || exit 1; for k in state task_state phase stage; do echo "$RESP" | jq -e "has(\"$k\") | not" > /dev/null || exit 1; done; echo OK'
  期望: stdout 含 OK 且 exit 0

- [ ] [BEHAVIOR] `POST /api/brain/tasks` 缺 `task_type` → HTTP 400 + 顶层 keys 字面 `["error"]`，`.error` 是 string，禁用 `message`/`msg`/`reason`/`detail` 反向不存在
  Test: manual:bash -c 'curl -fs localhost:5221/api/brain/context > /dev/null || { echo "SKIP"; exit 1; }; CODE=$(curl -s -o /tmp/w32-bhv-err.json -w "%{http_code}" -X POST localhost:5221/api/brain/tasks -H "Content-Type: application/json" -d "{\"prd\":\"no task_type\"}"); [ "$CODE" = "400" ] || exit 1; jq -e ".error | type == \"string\"" /tmp/w32-bhv-err.json || exit 1; for k in message msg reason detail; do jq -e "has(\"$k\") | not" /tmp/w32-bhv-err.json > /dev/null || exit 1; done; echo OK'
  期望: stdout 含 OK 且 exit 0

- [ ] [BEHAVIOR] `GET /api/brain/dispatch/recent?initiative_id=<uuid>&limit=50` 返 schema 完整性 = `keys == ["count","events"]` 字面严等，`events` 是数组，`event_type` 字面 ∈ `{dispatched,skipped,completed,failed,reaped}`
  Test: manual:bash -c 'curl -fs localhost:5221/api/brain/context > /dev/null || { echo "SKIP"; exit 1; }; PROBE_ID=$(curl -fs -X POST localhost:5221/api/brain/tasks -H "Content-Type: application/json" -d "{\"task_type\":\"harness_initiative\",\"prd\":\"W32 schema probe\",\"priority\":1}" | jq -re .id); RESP=$(curl -fs "localhost:5221/api/brain/dispatch/recent?initiative_id=${PROBE_ID}&limit=50"); echo "$RESP" | jq -e "keys == [\"count\",\"events\"]" || exit 1; echo "$RESP" | jq -e ".events | type == \"array\"" || exit 1; echo "$RESP" | jq -e ".events | all(.event_type as \$t | [\"dispatched\",\"skipped\",\"completed\",\"failed\",\"reaped\"] | index(\$t) != null)" || exit 1; echo OK'
  期望: stdout 含 OK 且 exit 0

- [ ] [BEHAVIOR] `GET /api/brain/fleet/slots` 字段字面完整 = `{total_slots,in_use,in_progress_task_count}`，禁用 `used`/`busy`/`active`/`running_count`/`task_count` 反向不存在，且不变量 `.in_use == .in_progress_task_count` 恒等
  Test: manual:bash -c 'curl -fs localhost:5221/api/brain/context > /dev/null || { echo "SKIP"; exit 1; }; RESP=$(curl -fs localhost:5221/api/brain/fleet/slots); for k in total_slots in_use in_progress_task_count; do echo "$RESP" | jq -e "has(\"$k\")" > /dev/null || exit 1; done; for k in used busy active running_count task_count; do echo "$RESP" | jq -e "has(\"$k\") | not" > /dev/null || exit 1; done; echo "$RESP" | jq -e ".in_use == .in_progress_task_count" || exit 1; echo OK'
  期望: stdout 含 OK 且 exit 0

- [ ] [BEHAVIOR] **R2 修订 — Reviewer R1 issue 1 修复**：`GET /api/brain/tasks/<刚创建的初始任务 uuid>` 返 schema 必填 7 字段字面（`id`/`task_type`/`status`/`thread_id`/`parent_task_id`/`result`/`last_heartbeat_at`）全存在 **且顶层 `keys | sort` 严等 7 字段集合（schema 完整性 oracle，捕获 generator 加新字段或 alias 漂移；与 dispatch/recent 的 `keys == ["count","events"]` 严等同构）**，`.status` 字面 ∈ `{pending,in_progress,completed,failed,skipped}` 枚举，禁用 `state`/`task_state`/`phase`/`stage` 反向不出现
  Test: manual:bash -c 'curl -fs localhost:5221/api/brain/context > /dev/null || { echo "SKIP"; exit 1; }; PID=$(curl -fs -X POST localhost:5221/api/brain/tasks -H "Content-Type: application/json" -d "{\"task_type\":\"harness_initiative\",\"prd\":\"W32 task schema probe\",\"priority\":1}" | jq -re .id); RESP=$(curl -fs "localhost:5221/api/brain/tasks/${PID}"); for k in id task_type status thread_id parent_task_id result last_heartbeat_at; do echo "$RESP" | jq -e "has(\"$k\")" > /dev/null || exit 1; done; echo "$RESP" | jq -e "keys | sort == [\"id\",\"last_heartbeat_at\",\"parent_task_id\",\"result\",\"status\",\"task_type\",\"thread_id\"]" || { echo "FAIL: keys|sort 严等不通过"; exit 1; }; echo "$RESP" | jq -e ".status as \$s | [\"pending\",\"in_progress\",\"completed\",\"failed\",\"skipped\"] | index(\$s) != null" || exit 1; for k in state task_state phase stage; do echo "$RESP" | jq -e "has(\"$k\") | not" > /dev/null || exit 1; done; echo OK'
  期望: stdout 含 OK 且 exit 0

- [ ] [BEHAVIOR] **R2 新增 — schema 完整性反向**：`POST /api/brain/tasks` 成功响应顶层 `keys | sort == ["id","status","task_type"]` 严等（仅 3 字段，不漏不多 — generator 不许擅自加 `priority`/`prd`/`created_at` 等无关字段到 201 响应里）
  Test: manual:bash -c 'curl -fs localhost:5221/api/brain/context > /dev/null || { echo "SKIP"; exit 1; }; RESP=$(curl -fs -X POST localhost:5221/api/brain/tasks -H "Content-Type: application/json" -d "{\"task_type\":\"harness_initiative\",\"prd\":\"W32 R2 schema strict\",\"priority\":1}"); echo "$RESP" | jq -e "keys | sort == [\"id\",\"status\",\"task_type\"]" || { echo "FAIL: POST 201 keys|sort != [id,status,task_type]，实际 $(echo $RESP | jq -c "keys|sort")"; exit 1; }; echo OK'
  期望: stdout 含 OK 且 exit 0

- [ ] [BEHAVIOR] 运行 `bash sprints/w32-walking-skeleton-p1-v4/verify-p1.sh` 后，`sprints/w32-walking-skeleton-p1-v4/p1-final-acceptance.md` 文件存在，含字面 `## Verdict: PASS` 或 `## Verdict: FAIL` 行 + `## Oracle a-g 实测` + `## Anomaly` 三段
  Test: manual:bash -c 'curl -fs localhost:5221/api/brain/context > /dev/null || { echo "SKIP"; exit 1; }; bash sprints/w32-walking-skeleton-p1-v4/verify-p1.sh || true; REPORT=sprints/w32-walking-skeleton-p1-v4/p1-final-acceptance.md; [ -f "$REPORT" ] || exit 1; grep -qE "^## Verdict: (PASS|FAIL)$" "$REPORT" || exit 1; grep -q "^## Oracle a-g 实测" "$REPORT" || exit 1; grep -q "^## Anomaly" "$REPORT" || exit 1; echo OK'
  期望: stdout 含 OK 且 exit 0

- [ ] [BEHAVIOR] `p1-final-acceptance.md` 报告 7 oracle 表格中字面字母 `a`/`b`/`c`/`d`/`e`/`f`/`g` 各占一行（无遗漏；无 `oracle1`/`oracle_a` 等禁用同义名）
  Test: manual:bash -c 'curl -fs localhost:5221/api/brain/context > /dev/null || { echo "SKIP"; exit 1; }; bash sprints/w32-walking-skeleton-p1-v4/verify-p1.sh || true; REPORT=sprints/w32-walking-skeleton-p1-v4/p1-final-acceptance.md; for o in a b c d e f g; do grep -qE "^\| ${o} \|" "$REPORT" || { echo "missing row $o"; exit 1; }; done; for n in oracle1 oracle2 oracle_a oracle_b; do grep -q "$n" "$REPORT" && { echo "forbidden name $n"; exit 1; }; done; echo OK'
  期望: stdout 含 OK 且 exit 0
