---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: codex relay 有头 tmux 派发最小验证片

**范围**: packages/brain/src/harness-skill-relay.js（mode=headed 分支）+ harness-relay-watchdog.js（headed tmux 存活检测 + 收窗幂等）+ routes/tasks.js（mode 白名单 + claude+headed→400）+ initiative_runs（tmux_killed_at 字段）
**大小**: M

---

## ARTIFACT 条目

- [ ] [ARTIFACT] harness-skill-relay.js 含 mode=headed 分支逻辑（ssh+tmux，不走 docker）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/harness-skill-relay.js','utf8');if(!c.includes('headed'))process.exit(1);if(!c.includes('tmux'))process.exit(1);console.log('OK')"

- [ ] [ARTIFACT] harness-relay-watchdog.js 含 headed tmux has-session 检测 + fail-open + 收窗幂等
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/harness-relay-watchdog.js','utf8');if(!c.includes('tmux has-session'))process.exit(1);if(!c.includes('tmux_killed_at'))process.exit(1);console.log('OK')"

- [ ] [ARTIFACT] routes/tasks.js 含 mode 白名单校验（含 claude+headed→400 拒绝逻辑）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/tasks.js','utf8');if(!c.includes('headed'))process.exit(1);if(!c.includes('claude'))process.exit(1);console.log('OK')"

- [ ] [ARTIFACT] tests/headed-dispatch.test.js 存在且含 headed/headless/claude+headed 三类测试
  Test: node -e "const c=require('fs').readFileSync('sprints/07071654-codex-headed-dispatch/tests/headed-dispatch.test.js','utf8');if(!c.includes('headed'))process.exit(1);if(!c.includes('claude'))process.exit(1);console.log('OK')"

- [ ] [ARTIFACT] tests/headed-watchdog.test.js 存在且含 fail-open 和 幂等 测试
  Test: node -e "const c=require('fs').readFileSync('sprints/07071654-codex-headed-dispatch/tests/headed-watchdog.test.js','utf8');if(!c.includes('fail-open')||!c.includes('幂等'))process.exit(1);console.log('OK')"

---

## BEHAVIOR 条目（内嵌可执行 manual:bash 命令，journey_type=autonomous）

### BEHAVIOR 1: mode=headed+codex 任务创建成功，claude+headed 返 400

- [ ] [BEHAVIOR] POST tasks(executor=codex, mode=headed) → HTTP 200 + 返回 id 字段
  Test: manual:bash -c 'RESP=$(curl -sf -X POST http://localhost:5221/api/brain/tasks -H "Content-Type: application/json" -d "{\"task_type\":\"harness_initiative\",\"title\":\"dod-headed-smoke\",\"payload\":{\"orchestrator\":\"skill-relay\",\"executor\":\"codex\",\"mode\":\"headed\"}}"); echo "$RESP" | jq -e ".id | type == \"string\"" || { echo "FAIL: 任务创建失败"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] POST tasks(executor=claude, mode=headed) → HTTP 400 拒绝（claude 不支持有头模式）
  Test: manual:bash -c 'CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:5221/api/brain/tasks -H "Content-Type: application/json" -d "{\"task_type\":\"harness_initiative\",\"title\":\"bad-combo\",\"payload\":{\"orchestrator\":\"skill-relay\",\"executor\":\"claude\",\"mode\":\"headed\"}}"); [ "$CODE" = "400" ] || { echo "FAIL: claude+headed 应 400，实际 $CODE"; exit 1; }; echo OK'
  期望: OK

### BEHAVIOR 2: headed spawn 走 ssh+tmux 路径，initiative_runs 落行 orchestrator_host='skill-relay-codex-headed'

- [ ] [BEHAVIOR] headed 任务被 tick 处理后，initiative_runs 写入 orchestrator_host='skill-relay-codex-headed'（带时间窗防造假）
  Test: manual:bash -c 'DB="${DB:-postgresql://localhost/cecelia}"; RESP=$(curl -sf -X POST http://localhost:5221/api/brain/tasks -H "Content-Type: application/json" -d "{\"task_type\":\"harness_initiative\",\"title\":\"dod-runs-check\",\"payload\":{\"orchestrator\":\"skill-relay\",\"executor\":\"codex\",\"mode\":\"headed\"}}"); TASK_ID=$(echo "$RESP" | jq -r ".id"); for i in $(seq 1 30); do ROW=$(psql "$DB" -t -c "SELECT orchestrator_host FROM initiative_runs WHERE initiative_id='"'"'${TASK_ID}'"'"' AND orchestrator_version='"'"'v2'"'"' AND created_at > NOW() - interval '"'"'5 minutes'"'"'" | tr -d " "); [ -n "$ROW" ] && break; sleep 1; done; [ "$ROW" = "skill-relay-codex-headed" ] || { echo "FAIL: orchestrator_host=$ROW"; exit 1; }; echo OK'
  期望: OK

### BEHAVIOR 3: headless/缺省路径零回归（不走 headed 分支）

- [ ] [BEHAVIOR] POST tasks(executor=codex, 无 mode 字段) → initiative_runs.orchestrator_host ≠ 'skill-relay-codex-headed'（现有 docker 路径不受影响）
  Test: manual:bash -c 'DB="${DB:-postgresql://localhost/cecelia}"; RESP=$(curl -sf -X POST http://localhost:5221/api/brain/tasks -H "Content-Type: application/json" -d "{\"task_type\":\"harness_initiative\",\"title\":\"headless-regression\",\"payload\":{\"orchestrator\":\"skill-relay\",\"executor\":\"codex\"}}"); TASK_ID=$(echo "$RESP" | jq -r ".id"); for i in $(seq 1 30); do ROW=$(psql "$DB" -t -c "SELECT orchestrator_host FROM initiative_runs WHERE initiative_id='"'"'${TASK_ID}'"'"' AND orchestrator_version='"'"'v2'"'"' AND created_at > NOW() - interval '"'"'5 minutes'"'"'" | tr -d " "); [ -n "$ROW" ] && break; [ "$i" = "30" ] && break; sleep 1; done; [ "$ROW" = "skill-relay-codex-headed" ] && { echo "FAIL: 缺省路径误走 headed 分支"; exit 1; }; echo "headless 零回归 OK orchestrator_host=${ROW:-<未落行>}"'
  期望: headless 零回归 OK

### BEHAVIOR 4: watchdog headed 分支 ssh 失败时 fail-open（不触发重点火）

- [ ] [BEHAVIOR] watchdog 对 headed run 执行 ssh tmux has-session 时，若 ssh 命令本身报错，fail-open 不重点火（initiative_runs phase 不变为 A_planning）
  Test: manual:bash -c 'DB="${DB:-postgresql://localhost/cecelia}"; PHASE=$(psql "$DB" -t -c "SELECT phase FROM initiative_runs WHERE orchestrator_host='"'"'skill-relay-codex-headed'"'"' AND orchestrator_version='"'"'v2'"'"' ORDER BY started_at DESC LIMIT 1" | tr -d " "); echo "最新 headed run phase=$PHASE"; [ "$PHASE" = "failed" ] && echo "注意: phase=failed（可能因 ssh 不可达）"; [ -z "$PHASE" ] && echo "WARN: 无 headed runs（首轮可忽略）"; echo OK'
  期望: OK（phase 值不因 ssh 失败被错误修改；具体 fail-open 逻辑由单测 headed-watchdog.test.js 覆盖）

### BEHAVIOR 5: 收窗幂等 — run 终态后 tmux_killed_at 写入，二次 watchdog 不重复 kill

- [ ] [BEHAVIOR] initiative_runs phase=done 且 completed_at > 30min 后，watchdog 写入 tmux_killed_at（带 5 分钟时间窗，防历史数据冒充）；再次执行 watchdog 不产生第二条 tmux_kill 记录
  Test: manual:bash -c 'DB="${DB:-postgresql://localhost/cecelia}"; RESP=$(curl -sf -X POST http://localhost:5221/api/brain/tasks -H "Content-Type: application/json" -d "{\"task_type\":\"harness_initiative\",\"title\":\"kill-idempotent-test\",\"payload\":{\"orchestrator\":\"skill-relay\",\"executor\":\"codex\",\"mode\":\"headed\"}}"); TASK_ID=$(echo "$RESP" | jq -r ".id"); sleep 2; psql "$DB" -c "UPDATE initiative_runs SET phase='"'"'done'"'"', completed_at=NOW() - interval '"'"'31 minutes'"'"' WHERE initiative_id='"'"'${TASK_ID}'"'"' AND orchestrator_version='"'"'v2'"'"'"; curl -sf -X POST http://localhost:5221/api/brain/tick/watchdog 2>/dev/null || true; sleep 5; CNT=$(psql "$DB" -t -c "SELECT COUNT(*) FROM initiative_runs WHERE initiative_id='"'"'${TASK_ID}'"'"' AND tmux_killed_at IS NOT NULL AND tmux_killed_at > NOW() - interval '"'"'5 minutes'"'"'" | tr -d " "); [ "${CNT}" -ge 1 ] || { echo "FAIL: tmux_killed_at 未写入"; exit 1; }; curl -sf -X POST http://localhost:5221/api/brain/tick/watchdog 2>/dev/null || true; sleep 2; CNT2=$(psql "$DB" -t -c "SELECT COUNT(*) FROM initiative_runs WHERE initiative_id='"'"'${TASK_ID}'"'"' AND tmux_killed_at IS NOT NULL" | tr -d " "); [ "${CNT2}" -le "1" ] || { echo "FAIL: 幂等失败，kill_count=$CNT2"; exit 1; }; echo OK'
  期望: OK

### BEHAVIOR 6: MAX=1 并发守门 — headed run 计入同一上限，防双 spawn

- [ ] [BEHAVIOR] 若已有活跃 headed run（initiative_runs phase=A_planning orchestrator_host=skill-relay-codex-headed），新 headed 任务 tick 时不重复 spawn（skip 或 defer）
  Test: manual:bash -c 'DB="${DB:-postgresql://localhost/cecelia}"; CNT=$(psql "$DB" -t -c "SELECT COUNT(*) FROM initiative_runs WHERE phase='"'"'A_planning'"'"' AND orchestrator_host='"'"'skill-relay-codex-headed'"'"'" | tr -d " "); echo "活跃 headed run 数=$CNT（期望 <=1）"; [ "${CNT}" -le "1" ] || { echo "FAIL: 并发守门失效，active_headed=$CNT"; exit 1; }; echo OK'
  期望: OK

---

## 接缝清单（真目标验证点）

| 接缝 | 真实世界碰触点 | 验证方式 | 状态 |
|---|---|---|---|
| ssh 逃逸到宿主 | `ssh <host> tmux new-session` 真实 SSH 命令 | 宿主上 `tmux has-session` exit 0 | logic-done-pending（需真机验证）|
| watchdog ssh fail-open | `ssh <host> tmux has-session` 命令 ssh 本身失败 | 单测注入 ssh 失败验 fail-open 路径 | 单测覆盖（可 CI 绿）|
| 收窗幂等 tmux kill | `ssh <host> tmux kill-session` + tmux_killed_at | 触发两次 watchdog 确认只 kill 一次 | logic-done-pending（tmux_killed_at DB 字段需 migration）|
